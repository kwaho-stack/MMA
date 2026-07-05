const path = require('node:path');
const express = require('express');
const { db, getAllSettings, setSetting, getSetting, log, DEFAULT_SETTINGS } = require('./db');
const { MEDIA_PLATFORMS, AD_PLATFORMS } = require('./catalog');
const seed = require('./seed');
const llm = require('./llm');
const { runPipeline, publishVariant } = require('./pipeline');
const revenueSync = require('./revenue-sync');
const scheduler = require('./scheduler');
const copilot = require('./copilot');
const images = require('./images');
const guidelines = require('./guidelines');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
// 생성된 삽화·카드뉴스 이미지 (data/uploads)
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads')));

const wrap = (fn) => (req, res) => {
  Promise.resolve(fn(req, res)).catch((e) => {
    res.status(400).json({ error: String(e.message || e) });
  });
};

// ---------- 카탈로그 ----------
app.get('/api/catalog', (req, res) => {
  res.json({ media: MEDIA_PLATFORMS, ad: AD_PLATFORMS });
});

// ---------- 대시보드 ----------
app.get('/api/dashboard', wrap(async (req, res) => {
  const counts = {
    accounts: db.prepare('SELECT COUNT(*) n FROM media_accounts WHERE active = 1').get().n,
    adAccounts: db.prepare('SELECT COUNT(*) n FROM ad_accounts').get().n,
    topicsPool: db.prepare(`SELECT COUNT(*) n FROM topics WHERE status = 'pool'`).get().n,
    pendingApproval: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'ready'`).get().n,
    scheduled: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'scheduled'`).get().n,
    manualQueue: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'manual'`).get().n,
    publishedToday: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'published' AND date(published_at) = date('now','localtime')`).get().n,
    published7d: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'published' AND published_at >= datetime('now','localtime','-7 days')`).get().n,
    failed: db.prepare(`SELECT COUNT(*) n FROM variants WHERE status = 'failed'`).get().n,
  };

  const revenueDaily = db.prepare(
    `SELECT date, SUM(amount) amount FROM revenues
     WHERE date >= date('now','localtime','-29 days') GROUP BY date ORDER BY date`,
  ).all();
  const revenueByAd = db.prepare(
    `SELECT a.platform, a.name, SUM(r.amount) amount FROM revenues r
     JOIN ad_accounts a ON a.id = r.ad_account_id
     WHERE r.date >= date('now','localtime','-29 days')
     GROUP BY r.ad_account_id ORDER BY amount DESC`,
  ).all();
  const revenue30d = revenueDaily.reduce((s, r) => s + r.amount, 0);
  const prev = db.prepare(
    `SELECT SUM(amount) amount FROM revenues
     WHERE date >= date('now','localtime','-59 days') AND date < date('now','localtime','-29 days')`,
  ).get().amount || 0;

  const categoryStats = db.prepare(
    `SELECT c.id, c.name, c.color, c.auto_enabled,
       (SELECT COUNT(*) FROM media_accounts m WHERE m.category_id = c.id AND m.active = 1) accounts,
       (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.status = 'pool') topics,
       (SELECT COUNT(*) FROM variants v JOIN contents ct ON ct.id = v.content_id
         WHERE ct.category_id = c.id AND v.status = 'published'
         AND v.published_at >= datetime('now','localtime','-7 days')) published7d
     FROM categories c ORDER BY c.id`,
  ).all();

  const activity = db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 12').all();
  const recentContents = db.prepare(
    `SELECT ct.*, c.name category_name, c.color category_color,
       (SELECT COUNT(*) FROM variants v WHERE v.content_id = ct.id) variant_count,
       (SELECT COUNT(*) FROM variants v WHERE v.content_id = ct.id AND v.status = 'published') published_count
     FROM contents ct LEFT JOIN categories c ON c.id = ct.category_id
     ORDER BY ct.id DESC LIMIT 6`,
  ).all();

  res.json({
    counts,
    revenue: { daily: revenueDaily, byAd: revenueByAd, total30d: revenue30d, prev30d: prev },
    categories: categoryStats,
    activity,
    recentContents,
    settings: {
      publish_mode: getSetting('publish_mode'),
      schedule_enabled: getSetting('schedule_enabled'),
      simulate_publish: getSetting('simulate_publish'),
      llm_ready: llm.hasApiKey(),
      llm_label: llm.engineInfo().label,
    },
  });
}));

// ---------- 카테고리 ----------
app.get('/api/categories', wrap(async (req, res) => {
  const rows = db.prepare(
    `SELECT c.*,
       (SELECT COUNT(*) FROM media_accounts m WHERE m.category_id = c.id AND m.active = 1) accounts,
       (SELECT COUNT(*) FROM topics t WHERE t.category_id = c.id AND t.status = 'pool') topics
     FROM categories c ORDER BY c.id`,
  ).all();
  res.json(rows);
}));

app.post('/api/categories', wrap(async (req, res) => {
  const { name, description = '', color = '#3987e5', auto_enabled = 0 } = req.body;
  if (!name) throw new Error('카테고리 이름은 필수입니다.');
  const r = db.prepare('INSERT INTO categories(name, description, color, auto_enabled) VALUES(?,?,?,?)')
    .run(name, description, color, auto_enabled ? 1 : 0);
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/categories/:id', wrap(async (req, res) => {
  const { name, description = '', color = '#3987e5', auto_enabled = 0 } = req.body;
  db.prepare('UPDATE categories SET name=?, description=?, color=?, auto_enabled=? WHERE id=?')
    .run(name, description, color, auto_enabled ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/categories/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 미디어 계정 ----------
app.get('/api/media-accounts', wrap(async (req, res) => {
  const rows = db.prepare(
    `SELECT m.*, c.name category_name, c.color category_color FROM media_accounts m
     LEFT JOIN categories c ON c.id = m.category_id ORDER BY m.id`,
  ).all();
  const matches = db.prepare(
    `SELECT mt.media_account_id, mt.ad_account_id, mt.id, a.name ad_name, a.platform ad_platform
     FROM matchings mt JOIN ad_accounts a ON a.id = mt.ad_account_id`,
  ).all();
  for (const r of rows) {
    r.credentials = JSON.parse(r.credentials || '{}');
    r.matchings = matches.filter((m) => m.media_account_id === r.id);
  }
  res.json(rows);
}));

app.post('/api/media-accounts', wrap(async (req, res) => {
  const { platform, name, category_id = null, url = '', credentials = {} } = req.body;
  if (!MEDIA_PLATFORMS[platform]) throw new Error('지원하지 않는 플랫폼입니다.');
  if (!name) throw new Error('계정 이름은 필수입니다.');
  const r = db.prepare('INSERT INTO media_accounts(platform, name, category_id, url, credentials) VALUES(?,?,?,?,?)')
    .run(platform, name, category_id || null, url, JSON.stringify(credentials));
  log('account', `미디어 계정 등록: ${MEDIA_PLATFORMS[platform].name} — ${name}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/media-accounts/:id', wrap(async (req, res) => {
  const { name, category_id = null, url = '', credentials = {}, active = 1 } = req.body;
  db.prepare('UPDATE media_accounts SET name=?, category_id=?, url=?, credentials=?, active=? WHERE id=?')
    .run(name, category_id || null, url, JSON.stringify(credentials), active ? 1 : 0, req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/media-accounts/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM media_accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 광고 계정 ----------
app.get('/api/ad-accounts', wrap(async (req, res) => {
  const rows = db.prepare('SELECT * FROM ad_accounts ORDER BY id').all();
  const matches = db.prepare(
    `SELECT mt.ad_account_id, m.name media_name, m.platform media_platform
     FROM matchings mt JOIN media_accounts m ON m.id = mt.media_account_id`,
  ).all();
  const rev = db.prepare(
    `SELECT ad_account_id, SUM(amount) amount FROM revenues
     WHERE date >= date('now','localtime','-29 days') GROUP BY ad_account_id`,
  ).all();
  for (const r of rows) {
    r.credentials = JSON.parse(r.credentials || '{}');
    r.matchings = matches.filter((m) => m.ad_account_id === r.id);
    r.revenue30d = rev.find((x) => x.ad_account_id === r.id)?.amount || 0;
    const def = AD_PLATFORMS[r.platform];
    r.sync_available = Boolean(def && def.sync);
    r.sync_ready = Boolean(def && def.sync && def.sync.required.every((k) => r.credentials[k]));
  }
  res.json(rows);
}));

// ---------- 수익 자동 동기화 ----------
app.post('/api/ad-accounts/:id/sync', wrap(async (req, res) => {
  const result = await revenueSync.syncAdAccount(Number(req.params.id), req.body?.days || null);
  res.json(result);
}));

app.post('/api/revenues/sync-all', wrap(async (req, res) => {
  const results = await revenueSync.syncAll(req.body?.days || null);
  res.json({ results });
}));

app.post('/api/ad-accounts', wrap(async (req, res) => {
  const { platform, name, credentials = {}, status = 'active' } = req.body;
  if (!AD_PLATFORMS[platform]) throw new Error('지원하지 않는 광고 플랫폼입니다.');
  if (!name) throw new Error('계정 이름은 필수입니다.');
  const r = db.prepare('INSERT INTO ad_accounts(platform, name, credentials, status) VALUES(?,?,?,?)')
    .run(platform, name, JSON.stringify(credentials), status);
  log('account', `광고 계정 등록: ${AD_PLATFORMS[platform].name} — ${name}`);
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.put('/api/ad-accounts/:id', wrap(async (req, res) => {
  const { name, credentials = {}, status = 'active' } = req.body;
  db.prepare('UPDATE ad_accounts SET name=?, credentials=?, status=? WHERE id=?')
    .run(name, JSON.stringify(credentials), status, req.params.id);
  res.json({ ok: true });
}));

app.delete('/api/ad-accounts/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM ad_accounts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 매칭 ----------
app.post('/api/matchings', wrap(async (req, res) => {
  const { media_account_id, ad_account_id, note = '' } = req.body;
  const media = db.prepare('SELECT * FROM media_accounts WHERE id = ?').get(media_account_id);
  const adAcc = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(ad_account_id);
  if (!media || !adAcc) throw new Error('계정을 찾을 수 없습니다.');
  const adDef = AD_PLATFORMS[adAcc.platform];
  const compatible = adDef.attach.includes(media.platform);
  const r = db.prepare('INSERT OR IGNORE INTO matchings(media_account_id, ad_account_id, note) VALUES(?,?,?)')
    .run(media_account_id, ad_account_id, note);
  res.json({ id: Number(r.lastInsertRowid), compatible,
    warning: compatible ? null : `${adDef.name}은(는) 보통 ${media.platform} 플랫폼에 게재되지 않습니다. 매칭은 저장되었지만 확인이 필요합니다.` });
}));

app.delete('/api/matchings/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM matchings WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 주제 ----------
app.get('/api/topics', wrap(async (req, res) => {
  const { category_id, status = 'pool' } = req.query;
  let sql = `SELECT t.*, c.name category_name, c.color category_color FROM topics t
             LEFT JOIN categories c ON c.id = t.category_id WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') { sql += ' AND t.status = ?'; params.push(status); }
  if (category_id) { sql += ' AND t.category_id = ?'; params.push(category_id); }
  sql += ' ORDER BY t.id DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
}));

app.post('/api/topics', wrap(async (req, res) => {
  const { category_id, title, keywords = '', angle = '' } = req.body;
  if (!title) throw new Error('주제 제목은 필수입니다.');
  const r = db.prepare('INSERT INTO topics(category_id, title, keywords, angle, source) VALUES(?,?,?,?,?)')
    .run(category_id || null, title, keywords, angle, 'manual');
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.post('/api/topics/generate', wrap(async (req, res) => {
  const { category_id, count = 5 } = req.body;
  const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(category_id);
  if (!category) throw new Error('카테고리를 찾을 수 없습니다.');
  const topics = await llm.generateTopics(category, Math.min(Number(count) || 5, 10));
  const insert = db.prepare('INSERT INTO topics(category_id, title, keywords, angle, source) VALUES(?,?,?,?,?)');
  const ids = topics.map((t) => Number(insert.run(category_id, t.title, t.keywords, t.angle, 'llm').lastInsertRowid));
  log('topic', `주제 ${ids.length}건 생성 (${category.name})${llm.hasApiKey() ? '' : ' — 데모 모드'}`);
  res.json({ ids, demo: !llm.hasApiKey() });
}));

app.delete('/api/topics/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM topics WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 파이프라인 ----------
app.post('/api/pipeline/run', wrap(async (req, res) => {
  const { category_id, topic_id = null, account_ids = null, mode = null } = req.body;
  const contentId = await runPipeline({ categoryId: category_id, topicId: topic_id, accountIds: account_ids, mode });
  res.json({ content_id: contentId });
}));

// ---------- 콘텐츠 ----------
app.get('/api/contents', wrap(async (req, res) => {
  const rows = db.prepare(
    `SELECT ct.*, c.name category_name, c.color category_color,
       (SELECT COUNT(*) FROM variants v WHERE v.content_id = ct.id) variant_count,
       (SELECT COUNT(*) FROM variants v WHERE v.content_id = ct.id AND v.status = 'published') published_count,
       (SELECT COUNT(*) FROM variants v WHERE v.content_id = ct.id AND v.status IN ('ready','approved')) waiting_count
     FROM contents ct LEFT JOIN categories c ON c.id = ct.category_id
     ORDER BY ct.id DESC LIMIT 50`,
  ).all();
  res.json(rows);
}));

app.get('/api/contents/:id', wrap(async (req, res) => {
  const content = db.prepare(
    `SELECT ct.*, c.name category_name, c.color category_color FROM contents ct
     LEFT JOIN categories c ON c.id = ct.category_id WHERE ct.id = ?`,
  ).get(req.params.id);
  if (!content) throw new Error('콘텐츠를 찾을 수 없습니다.');
  content.policy_report = JSON.parse(content.policy_report || '{}');
  const variants = db.prepare(
    `SELECT v.*, m.name account_name FROM variants v
     LEFT JOIN media_accounts m ON m.id = v.media_account_id
     WHERE v.content_id = ? ORDER BY v.id`,
  ).all(req.params.id);
  for (const v of variants) v.extra = JSON.parse(v.extra || '{}');
  res.json({ ...content, variants });
}));

// ---------- 발행 큐 / 승인 ----------
app.get('/api/queue', wrap(async (req, res) => {
  const rows = db.prepare(
    `SELECT v.*, m.name account_name, ct.title content_title, c.name category_name, c.color category_color
     FROM variants v
     LEFT JOIN media_accounts m ON m.id = v.media_account_id
     LEFT JOIN contents ct ON ct.id = v.content_id
     LEFT JOIN categories c ON c.id = ct.category_id
     WHERE v.status IN ('ready','approved','scheduled','manual','failed')
     ORDER BY CASE v.status WHEN 'ready' THEN 0 WHEN 'scheduled' THEN 1 WHEN 'manual' THEN 2 ELSE 3 END, v.id DESC`,
  ).all();
  for (const v of rows) v.extra = JSON.parse(v.extra || '{}');
  res.json(rows);
}));

app.post('/api/variants/:id/approve', wrap(async (req, res) => {
  // 승인 → 즉시 발행 시도
  const result = await publishVariant(Number(req.params.id));
  res.json(result);
}));

app.post('/api/variants/:id/schedule', wrap(async (req, res) => {
  const { at } = req.body;
  if (!at) throw new Error('예약 시각(at)이 필요합니다.');
  db.prepare(`UPDATE variants SET status = 'scheduled', scheduled_at = ? WHERE id = ?`)
    .run(new Date(at).toISOString(), req.params.id);
  res.json({ ok: true });
}));

app.post('/api/variants/:id/reject', wrap(async (req, res) => {
  db.prepare(`UPDATE variants SET status = 'rejected' WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/variants/:id/mark-published', wrap(async (req, res) => {
  // 수동(복사·붙여넣기) 발행 완료 처리
  const { url = '' } = req.body;
  db.prepare(
    `UPDATE variants SET status = 'published', published_at = datetime('now','localtime'), published_url = ?, simulated = 0 WHERE id = ?`,
  ).run(url, req.params.id);
  log('publish', `수동 발행 완료 처리 (variant #${req.params.id})`, { url });
  res.json({ ok: true });
}));

// ---------- 수익 ----------
app.get('/api/revenues', wrap(async (req, res) => {
  const days = Number(req.query.days || 30);
  const daily = db.prepare(
    `SELECT date, SUM(amount) amount FROM revenues
     WHERE date >= date('now','localtime', ?) GROUP BY date ORDER BY date`,
  ).all(`-${days - 1} days`);
  const byAd = db.prepare(
    `SELECT r.ad_account_id, a.platform, a.name, SUM(r.amount) amount, COUNT(*) entries
     FROM revenues r JOIN ad_accounts a ON a.id = r.ad_account_id
     WHERE r.date >= date('now','localtime', ?) GROUP BY r.ad_account_id ORDER BY amount DESC`,
  ).all(`-${days - 1} days`);
  const recent = db.prepare(
    `SELECT r.*, a.name ad_name, a.platform ad_platform, m.name media_name
     FROM revenues r
     JOIN ad_accounts a ON a.id = r.ad_account_id
     LEFT JOIN media_accounts m ON m.id = r.media_account_id
     ORDER BY r.date DESC, r.id DESC LIMIT 60`,
  ).all();
  res.json({ daily, byAd, recent });
}));

app.post('/api/revenues', wrap(async (req, res) => {
  const { ad_account_id, media_account_id = null, date, amount, memo = '' } = req.body;
  if (!ad_account_id || !date || amount === undefined) throw new Error('광고 계정, 날짜, 금액은 필수입니다.');
  const r = db.prepare('INSERT INTO revenues(ad_account_id, media_account_id, date, amount, memo) VALUES(?,?,?,?,?)')
    .run(ad_account_id, media_account_id || null, date, Number(amount), memo);
  res.json({ id: Number(r.lastInsertRowid) });
}));

app.delete('/api/revenues/:id', wrap(async (req, res) => {
  db.prepare('DELETE FROM revenues WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

// ---------- 설정 ----------
app.get('/api/settings', wrap(async (req, res) => {
  const s = getAllSettings();
  s.anthropic_api_key_set = Boolean(s.anthropic_api_key || process.env.ANTHROPIC_API_KEY);
  s.anthropic_api_key = s.anthropic_api_key ? '********' : '';
  s.gemini_api_key_set = Boolean(s.gemini_api_key);
  s.gemini_api_key = s.gemini_api_key ? '********' : '';
  delete s.github_copilot_token; // 토큰은 절대 내려보내지 않음
  s.copilot = copilot.status();
  s.engine = llm.engineInfo();
  res.json(s);
}));

app.put('/api/settings', wrap(async (req, res) => {
  const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'github_copilot_token');
  for (const [k, v] of Object.entries(req.body || {})) {
    if (!allowed.includes(k)) continue;
    if ((k === 'anthropic_api_key' || k === 'gemini_api_key') && v === '********') continue; // 마스킹 값은 무시
    setSetting(k, v);
  }
  log('system', '설정이 변경되었습니다.', req.body.publish_mode ? { publish_mode: req.body.publish_mode } : {});
  res.json({ ok: true });
}));

// ---------- GitHub Copilot 로그인 (디바이스 플로우) ----------
app.get('/api/copilot/status', (req, res) => res.json(copilot.status()));

app.post('/api/copilot/device-start', wrap(async (req, res) => {
  res.json(await copilot.deviceStart());
}));

app.post('/api/copilot/device-poll', wrap(async (req, res) => {
  const { device_code } = req.body || {};
  if (!device_code) throw new Error('device_code가 필요합니다.');
  res.json(await copilot.devicePoll(device_code));
}));

app.post('/api/copilot/logout', wrap(async (req, res) => {
  copilot.logout();
  log('system', 'GitHub Copilot 연결이 해제되었습니다.');
  res.json({ ok: true });
}));

// ---------- 이미지 생성 테스트 ----------
app.post('/api/images/test', wrap(async (req, res) => {
  const prompt = (req.body?.prompt || '').trim() || '노트북으로 글을 쓰는 사람의 책상, 따뜻한 조명';
  const r = await images.generateImage(prompt, { aspect: '16:9' });
  log('system', `이미지 생성 테스트 성공: ${prompt}`);
  res.json(r);
}));

// ---------- 글쓰기·리라이팅 지침 ----------
app.get('/api/guidelines', wrap(async (req, res) => {
  res.json(guidelines.list());
}));

app.put('/api/guidelines/:platform', wrap(async (req, res) => {
  guidelines.save(req.params.platform, req.body || {});
  log('system', `지침 수정: ${req.params.platform === '_master' ? '마스터 원고' : req.params.platform}`);
  res.json({ ok: true });
}));

app.delete('/api/guidelines/:platform', wrap(async (req, res) => {
  guidelines.reset(req.params.platform);
  res.json({ ok: true });
}));

// ---------- 활동 로그 ----------
app.get('/api/activity', wrap(async (req, res) => {
  res.json(db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 50').all());
}));

// SPA 라우팅
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

const PORT = process.env.PORT || 3400;
seed.run();
scheduler.start();
app.listen(PORT, () => {
  console.log(`미디어닷(MediaDot) 실행 중 → http://localhost:${PORT}`);
});
