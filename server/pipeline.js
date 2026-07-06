// 자동발행 파이프라인:
//   주제 선정 → 마스터 원고 생성 → 정책 검사 → 계정별(플랫폼별) 리라이팅
//   → 발행 모드에 따라 승인 대기(confirm) 또는 시간 분산 예약(auto)
// HTTP 요청과 분리되어 백그라운드로 실행되며 진행 상황은 contents.status와 activity_log로 추적한다.

const { db, getSetting, log } = require('./db');
const { MEDIA_PLATFORMS } = require('./catalog');
const llm = require('./llm');
const { checkPolicy } = require('./policy');
const adapters = require('./adapters');
const images = require('./images');
const cardnews = require('./cardnews');
const dedup = require('./topic-dedup');

function nowISO() {
  return new Date().toISOString();
}

function touchContent(id, fields) {
  const sets = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE contents SET ${sets}, updated_at = datetime('now','localtime') WHERE id = ?`)
    .run(...Object.values(fields), id);
}

/** 파이프라인 실시간 진행 상황을 contents.progress(JSON)에 병합 기록 — UI 스테퍼가 폴링한다. */
function setProgress(contentId, patch) {
  const row = db.prepare('SELECT progress FROM contents WHERE id = ?').get(contentId);
  let cur = {};
  try { cur = JSON.parse(row?.progress || '{}'); } catch { /* 손상 시 초기화 */ }
  const next = { ...cur, ...patch, updated_at: new Date().toISOString() };
  db.prepare(`UPDATE contents SET progress = ? WHERE id = ?`).run(JSON.stringify(next), contentId);
}

/** 계정에 매칭된 광고 플랫폼 목록 — 리라이팅 프롬프트에 광고 맥락으로 주입된다. */
function matchedAdsOf(mediaAccountId) {
  return db.prepare(
    `SELECT a.platform, a.name FROM matchings mt JOIN ad_accounts a ON a.id = mt.ad_account_id
     WHERE mt.media_account_id = ?`,
  ).all(mediaAccountId);
}

function publishedTodayCount(mediaAccountId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM variants
     WHERE media_account_id = ? AND status = 'published' AND date(published_at) = date('now','localtime')`,
  ).get(mediaAccountId);
  return row.n;
}

/** 예약 시간을 계정별로 분산 배치한다(동시 대량 발행으로 인한 스팸 판정 방지). */
function scheduleSlots(count) {
  const gapMin = Number(getSetting('publish_gap_min') || 25);
  const base = Date.now() + 2 * 60 * 1000; // 2분 뒤부터
  const slots = [];
  for (let i = 0; i < count; i++) {
    const jitter = Math.floor(Math.random() * 8 * 60 * 1000); // 0~8분 지터
    slots.push(new Date(base + i * gapMin * 60 * 1000 + jitter).toISOString());
  }
  return slots;
}

/**
 * 파이프라인 실행. topicId가 없으면 풀에서 꺼내고, 풀도 비었으면 LLM으로 주제를 생성한다.
 * @returns {Promise<number>} content id
 */
async function runPipeline({ categoryId, topicId = null, accountIds = null, mode = null, photos = null, photoTopic = null }) {
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  if (!category) throw new Error('카테고리를 찾을 수 없습니다.');
  const photoMode = Array.isArray(photos) && photos.length > 0;

  // 대상 계정: 카테고리에 연결된 활성 미디어 계정
  let accounts = db.prepare('SELECT * FROM media_accounts WHERE category_id = ? AND active = 1').all(categoryId);
  if (accountIds && accountIds.length) {
    const set = new Set(accountIds.map(Number));
    accounts = accounts.filter((a) => set.has(a.id));
  }
  if (!accounts.length) throw new Error(`'${category.name}' 카테고리에 연결된 활성 미디어 계정이 없습니다. 계정 관리에서 계정을 등록하고 카테고리를 지정하세요.`);

  // 1) 주제 선정 — 포토 모드는 사용자가 준 제목으로 즉석 주제를 만든다(풀에서 꺼내지 않음).
  let topic = null;
  if (photoMode) {
    if (!photoTopic || !photoTopic.title) throw new Error('포토 블로깅에는 제목(주제)이 필요합니다.');
    const r = db.prepare('INSERT INTO topics(category_id, title, keywords, angle, source) VALUES(?,?,?,?,?)')
      .run(categoryId, photoTopic.title, photoTopic.keywords || '', photoTopic.angle || '', 'photo');
    topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(Number(r.lastInsertRowid));
  } else if (topicId) {
    topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
  } else {
    topic = db.prepare(`SELECT * FROM topics WHERE category_id = ? AND status = 'pool' ORDER BY id LIMIT 1`).get(categoryId);
  }
  if (!topic) {
    // 기발행·기존 주제를 제외 목록으로 넘겨 같은 주제의 재발행을 막는다.
    const generated = await llm.generateTopics(category, 3, { exclude: dedup.recentTitles(categoryId) });
    const { kept, skipped } = dedup.filterNew(generated);
    if (skipped.length) {
      log('warn', `중복 주제 ${skipped.length}건 제외: ${skipped.map((s) => `"${s.title}"`).join(', ')}`, { categoryId });
    }
    if (!kept.length) throw new Error('AI가 제안한 주제가 모두 기존 주제와 중복됩니다. 주제 풀에 새 주제를 직접 추가하거나 다시 시도하세요.');
    const insert = db.prepare('INSERT INTO topics(category_id, title, keywords, angle, source) VALUES(?,?,?,?,?)');
    let firstId = null;
    for (const t of kept) {
      const r = insert.run(categoryId, t.title, t.keywords, t.angle, 'llm');
      if (firstId === null) firstId = Number(r.lastInsertRowid);
    }
    topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(firstId);
    log('pipeline', `주제 풀이 비어 있어 새 주제 ${kept.length}건을 생성했습니다.`, { categoryId });
  }

  // 2) 콘텐츠 레코드 생성
  const contentId = Number(db.prepare(
    'INSERT INTO contents(topic_id, category_id, title, status) VALUES(?,?,?,?)',
  ).run(topic.id, categoryId, topic.title, 'generating').lastInsertRowid);
  db.prepare(`UPDATE topics SET status = 'used' WHERE id = ?`).run(topic.id);
  log('pipeline', `파이프라인 시작: "${topic.title}" (${category.name}, 대상 계정 ${accounts.length}개)`, { contentId });
  setProgress(contentId, { stage: 'draft', rewrite_total: accounts.length, rewrite_done: 0, current: '' });

  // 이후 단계는 비동기 진행 — 호출자는 contentId로 진행 상황을 폴링한다.
  (async () => {
    try {
      // 3) 마스터 원고 생성 (포토 모드는 사진+설명으로 방문 후기 생성)
      const master = photoMode
        ? await llm.generateMasterFromPhotos(topic, category, photos)
        : await llm.generateMaster(topic, category);
      setProgress(contentId, { stage: 'policy' });
      const policy = checkPolicy(`${master.title}\n${master.body}`);
      touchContent(contentId, {
        title: master.title,
        summary: master.summary,
        body: master.body,
        tags: (master.tags || []).join(', '),
        policy_report: JSON.stringify(policy),
        status: 'rewriting',
      });
      setProgress(contentId, { stage: 'rewrite', policy_level: policy.level });

      // 4) 플랫폼별 리라이팅
      let publishMode = mode || getSetting('publish_mode');
      // 정책 위험(높음)이면 완전 자동이라도 강제로 컨펌 모드 — 수정 없이 나가는 것을 막는다.
      if (policy.level === 'high' && publishMode === 'auto') {
        publishMode = 'confirm';
        log('warn', `정책 위험(높음) 감지: "${master.title}" — 자동 발행을 중단하고 승인 대기로 전환했습니다. 발행 큐에서 지적 표현을 수정 후 발행하세요.`, { contentId, hits: policy.hits.length });
      } else if (policy.level === 'high') {
        log('warn', `정책 위험(높음) 감지: "${master.title}" — 발행 전 수정 권장`, { contentId, hits: policy.hits.length });
      }
      const slots = scheduleSlots(accounts.length);
      const insertVariant = db.prepare(
        `INSERT INTO variants(content_id, media_account_id, platform, title, body, extra, status, scheduled_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      );

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const def = MEDIA_PLATFORMS[account.platform];
        if (!def) continue;
        setProgress(contentId, { rewrite_done: i, current: `${def.name} · ${account.name}` });
        try {
          const rw = await llm.rewriteForPlatform(master, account.platform, def, account, {
            ads: matchedAdsOf(account.id),
            photos: photoMode ? photos : null,
          });
          const vPolicy = checkPolicy(`${rw.title}\n${rw.body}`);
          const extraObj = {
            hashtags: rw.hashtags || [], caption: rw.caption || '', notes: rw.notes || '',
            cta: rw.cta || '', pinned_comment: rw.pinned_comment || '', ad_snippet: rw.ad_snippet || '',
            policy: vPolicy, demo: Boolean(rw._demo),
          };

          if (photoMode) {
            // 포토 모드: 사용자가 올린 실제 사진을 본문 [[PHOTO]] 자리에 순서대로 배치(Gemini 생성 안 함)
            if (def.kind === 'blog') {
              const applied = images.applyPhotos(rw.body, photos);
              rw.body = applied.body;
              extraObj.images = applied.images;
              log('pipeline', `첨부 사진 ${applied.images.length}장 배치 — ${def.name}/${account.name}`, { contentId });
            } else {
              rw.body = String(rw.body || '').replace(/\[\[\s*photo\s*\]\]/ig, '').trim();
              if (account.platform === 'instagram') extraObj.cards = photos.map((ph) => ph.file); // 캐러셀 = 실제 사진
            }
          } else {
            // 블로그: [이미지: …] 마커 위치에 넣을 삽화를 Gemini로 생성 (키 없으면 건너뜀)
            if (def.kind === 'blog' && images.enabled()) {
              try {
                const prep = await images.prepareBodyImages(rw.body, `c${contentId}a${account.id}`);
                if (prep.images.length) {
                  extraObj.images = prep.images;
                  log('pipeline', `본문 삽화 ${prep.images.length}장 생성 — ${def.name}/${account.name}`, { contentId });
                }
              } catch (e) {
                log('warn', `삽화 생성 실패(${account.name}): ${e.message} — 이미지 없이 진행`, { contentId });
              }
            }

            // 인스타그램: 카드뉴스 이미지 자동 렌더링 (1080×1080 캐러셀)
            if (account.platform === 'instagram' && getSetting('cardnews_enabled') === '1') {
              try {
                extraObj.cards = await cardnews.buildForVariant(
                  { title: rw.title, body: rw.body },
                  { accent: category.color || '#3987e5', tag: `c${contentId}a${account.id}` },
                );
                log('pipeline', `카드뉴스 ${extraObj.cards.length}장 렌더링 — ${account.name}`, { contentId });
              } catch (e) {
                log('warn', `카드뉴스 렌더링 실패(${account.name}): ${e.message} — 텍스트만 진행`, { contentId });
              }
            }
          }

          const extra = JSON.stringify(extraObj);
          const status = publishMode === 'auto' ? 'scheduled' : 'ready';
          const scheduledAt = publishMode === 'auto' ? slots[i] : null;
          insertVariant.run(contentId, account.id, account.platform, rw.title, rw.body, extra, status, scheduledAt);
        } catch (e) {
          insertVariant.run(contentId, account.id, account.platform, master.title, '', JSON.stringify({}), 'failed', null);
          db.prepare(`UPDATE variants SET error = ? WHERE content_id = ? AND media_account_id = ?`)
            .run(String(e.message || e), contentId, account.id);
          log('error', `리라이팅 실패(${def.name}/${account.name}): ${e.message}`, { contentId });
        }
      }

      touchContent(contentId, { status: publishMode === 'auto' ? 'publishing' : 'ready' });
      setProgress(contentId, { stage: publishMode === 'auto' ? 'publish' : 'ready', rewrite_done: accounts.length, current: '' });
      log('pipeline',
        publishMode === 'auto'
          ? `리라이팅 완료 — ${accounts.length}건을 ${getSetting('publish_gap_min')}분 간격으로 분산 예약했습니다.`
          : `리라이팅 완료 — ${accounts.length}건이 승인 대기 중입니다. 발행 큐에서 확인 후 발행하세요.`,
        { contentId });
    } catch (e) {
      touchContent(contentId, { status: 'failed', error: String(e.message || e) });
      setProgress(contentId, { stage: 'failed', error: String(e.message || e) });
      log('error', `파이프라인 실패: ${e.message}`, { contentId });
    }
  })();

  return contentId;
}

/** 단일 variant 발행 (스케줄러·즉시발행·승인발행 공용) */
async function publishVariant(variantId) {
  const v = db.prepare('SELECT * FROM variants WHERE id = ?').get(variantId);
  if (!v) throw new Error('발행 대상을 찾을 수 없습니다.');
  const account = db.prepare('SELECT * FROM media_accounts WHERE id = ?').get(v.media_account_id);
  if (!account) throw new Error('연결된 미디어 계정이 없습니다.');
  const def = MEDIA_PLATFORMS[account.platform];

  const limit = Number(getSetting('daily_limit_per_account') || 3);
  if (publishedTodayCount(account.id) >= limit) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0 + Math.floor(Math.random() * 90), 0, 0);
    db.prepare(`UPDATE variants SET status = 'scheduled', scheduled_at = ? WHERE id = ?`)
      .run(tomorrow.toISOString(), variantId);
    log('warn', `일일 발행 상한(${limit}건) 도달 — "${v.title}" 발행을 내일로 미뤘습니다. (${account.name})`, { variantId });
    return { deferred: true };
  }

  try {
    const result = await adapters.publish(account.platform, account, v);
    if (result.mode === 'manual') {
      // 수동 폴백 사유를 variant에 기록 — 발행 큐에서 "왜 수동인지" 바로 보이게 한다.
      db.prepare(`UPDATE variants SET status = 'manual', error = ? WHERE id = ?`)
        .run(result.reason || '', variantId);
      log('publish', `수동 발행 대기: ${def.name}/${account.name} — ${result.reason}`, { variantId });
      return { manual: true, reason: result.reason };
    }
    db.prepare(
      `UPDATE variants SET status = 'published', published_at = datetime('now','localtime'),
       published_url = ?, simulated = ?, error = '' WHERE id = ?`,
    ).run(result.url || '', result.simulated ? 1 : 0, variantId);
    log('publish',
      `${result.simulated ? '[시뮬레이션] ' : ''}발행 완료: ${def.name}/${account.name} — "${v.title}"`,
      { variantId, url: result.url });

    // 콘텐츠의 모든 variant가 종결 상태면 콘텐츠도 published 처리
    const open = db.prepare(
      `SELECT COUNT(*) AS n FROM variants WHERE content_id = ? AND status IN ('pending','ready','approved','scheduled')`,
    ).get(v.content_id);
    if (open.n === 0) {
      db.prepare(`UPDATE contents SET status = 'published', updated_at = datetime('now','localtime') WHERE id = ?`).run(v.content_id);
    }
    return { published: true, url: result.url, simulated: result.simulated };
  } catch (e) {
    db.prepare(`UPDATE variants SET status = 'failed', error = ? WHERE id = ?`).run(String(e.message || e), variantId);
    log('error', `발행 실패: ${def ? def.name : v.platform}/${account.name} — ${e.message}`, { variantId });
    throw e;
  }
}

module.exports = { runPipeline, publishVariant };
