// 프리플라이트 — 자동발행 실행 전, 실패 요인을 미리 점검해 체크리스트로 알려준다.
// 각 항목은 { ok, label, detail, fix } 형태 — fix는 사용자가 바로 이동할 화면 해시.

const { db, getSetting } = require('./db');
const { MEDIA_PLATFORMS, AD_PLATFORMS } = require('./catalog');
const llm = require('./llm');
const gemini = require('./gemini');
const browser = require('./browser');

function credsOf(row) {
  try { return JSON.parse(row.credentials || '{}'); } catch { return {}; }
}

function accountReady(account) {
  const def = MEDIA_PLATFORMS[account.platform];
  if (!def) return { ready: false, issue: '알 수 없는 플랫폼' };
  const mode = def.publish.mode;
  if (mode === 'manual') return { ready: true, mode, note: '반자동(복사·붙여넣기)' };
  const creds = credsOf(account);
  const missing = def.publish.credentialFields.filter((f) => f.required && !creds[f.key]);
  if (missing.length) {
    return {
      ready: false, mode,
      issue: `${mode === 'browser' ? '로그인 정보' : '자격증명'} 미등록: ${missing.map((f) => f.label).join(', ')}`,
    };
  }
  return { ready: true, mode };
}

function publishedToday(mediaAccountId) {
  return db.prepare(
    `SELECT COUNT(*) n FROM variants WHERE media_account_id = ? AND status = 'published' AND date(published_at) = date('now','localtime')`,
  ).get(mediaAccountId).n;
}

/**
 * 카테고리 기준 발행 전 점검.
 * @returns {{ok:boolean, items:Array, accounts:Array}}
 */
function check(categoryId) {
  const simulate = getSetting('simulate_publish') === '1';
  const items = [];

  // 1) 텍스트 엔진
  const engine = llm.engineInfo();
  items.push(engine.ready
    ? { ok: true, label: 'AI 텍스트 엔진', detail: `${engine.label} 연결됨` }
    : { ok: false, level: 'warn', label: 'AI 텍스트 엔진', detail: '엔진 미연결 — 자리표시 데모 원고로 생성됩니다', fix: '#/settings' });

  // 2) 이미지 엔진 (선택 사항)
  const imgOn = getSetting('image_gen_enabled') === '1';
  items.push(!imgOn
    ? { ok: true, label: '이미지 엔진', detail: '삽화 자동 생성 꺼짐 (텍스트만 발행)' }
    : gemini.available()
      ? { ok: true, label: '이미지 엔진', detail: `Gemini 연결됨 (${gemini.authLabel()})` }
      : { ok: false, level: 'warn', label: '이미지 엔진', detail: 'Gemini 미연결 — 삽화 없이 발행됩니다', fix: '#/settings' });

  // 3) 대상 계정
  const accounts = db.prepare('SELECT * FROM media_accounts WHERE category_id = ? AND active = 1').all(categoryId)
    .map((a) => {
      const def = MEDIA_PLATFORMS[a.platform];
      const r = accountReady(a);
      const today = publishedToday(a.id);
      const limit = Number(getSetting('daily_limit_per_account') || 3);
      return {
        id: a.id, name: a.name, platform: a.platform, platform_name: def?.name || a.platform,
        mode: r.mode, ready: r.ready, issue: r.issue || '', note: r.note || '',
        today, limit, limit_left: Math.max(0, limit - today),
      };
    });

  if (!accounts.length) {
    items.push({ ok: false, level: 'error', label: '대상 계정', detail: '이 카테고리에 연결된 활성 미디어 계정이 없습니다', fix: '#/accounts' });
  } else {
    const notReady = accounts.filter((a) => !a.ready);
    const full = accounts.filter((a) => a.limit_left === 0);
    if (simulate) {
      items.push({ ok: true, label: `대상 계정 ${accounts.length}개`, detail: '시뮬레이션 모드 — 자격증명 없이도 전체 흐름이 동작합니다' });
    } else if (notReady.length) {
      items.push({
        ok: false, level: 'warn', label: `대상 계정 ${accounts.length}개`,
        detail: `${notReady.length}개 계정 인증 미완료 (${notReady.map((a) => a.name).join(', ')}) — 해당 계정은 수동 발행으로 전환됩니다`,
        fix: '#/accounts',
      });
    } else {
      items.push({ ok: true, label: `대상 계정 ${accounts.length}개`, detail: '모든 계정 발행 준비 완료' });
    }
    if (full.length) {
      items.push({
        ok: false, level: 'warn', label: '일일 발행 상한',
        detail: `${full.map((a) => a.name).join(', ')} — 오늘 상한 도달, 발행 시 내일로 이월됩니다`, fix: '#/settings',
      });
    }
  }

  // 4) 브라우저 자동 발행 요건 (네이버·티스토리) — 실계정 모드에서만 점검
  const browserAccounts = accounts.filter((a) => a.mode === 'browser');
  if (browserAccounts.length && !simulate) {
    const names = browserAccounts.map((a) => a.platform_name).filter((v, i, arr) => arr.indexOf(v) === i).join('·');
    if (!browser.binaryReady()) {
      items.push({
        ok: false, level: 'warn', label: `브라우저 자동 발행 (${names})`,
        detail: '크로미움 미설치 — 서버에서 `npx playwright install chromium` 실행 필요. 미설치 시 수동 발행으로 전환됩니다',
      });
    } else {
      const ready = browserAccounts.filter((a) => a.ready);
      if (ready.length) items.push({ ok: true, label: `브라우저 자동 발행 (${names})`, detail: `${ready.length}개 계정 로그인 정보 등록됨 — 자동 발행 가능` });
    }
  }

  // 5) 인스타그램 캐러셀 업로드 요건
  const igAccounts = accounts.filter((a) => a.platform === 'instagram');
  if (igAccounts.length && !simulate && getSetting('cardnews_enabled') === '1' && !getSetting('public_base_url')) {
    items.push({
      ok: false, level: 'warn', label: '인스타그램 카드뉴스',
      detail: '서버 공개 URL(public_base_url) 미설정 — 카드뉴스는 생성되지만 자동 업로드 대신 수동 업로드로 안내됩니다', fix: '#/settings',
    });
  }

  // 6) 주제 풀
  const pool = db.prepare(`SELECT COUNT(*) n FROM topics WHERE category_id = ? AND status = 'pool'`).get(categoryId).n;
  items.push(pool > 0
    ? { ok: true, label: '주제 풀', detail: `대기 중인 주제 ${pool}건` }
    : { ok: true, label: '주제 풀', detail: '풀이 비어 있음 — 실행 시 AI가 새 주제를 발굴합니다' });

  const hasError = items.some((i) => !i.ok && i.level === 'error');
  return { ok: !hasError, items, accounts, simulate };
}

module.exports = { check };
