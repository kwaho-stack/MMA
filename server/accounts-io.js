// 계정·매칭 내보내기/가져오기 — 미디어 계정, 광고 계정, 매칭, 카테고리 연결을 파일로 백업·복원한다.
// 카테고리는 이름으로 매핑(없으면 생성), 계정은 (플랫폼+이름)으로 중복 판정해 upsert한다.
// 매칭은 내보낸 원본 id를 새 id로 재매핑해 복원한다.

const { db, log } = require('./db');
const { MEDIA_PLATFORMS, AD_PLATFORMS } = require('./catalog');

const EXPORT_TYPE = 'mediadot-accounts';
const EXPORT_VERSION = 1;

/**
 * 현재 등록된 계정·매칭을 내보내기 객체로 만든다.
 * @param {{includeCredentials?: boolean}} opts 자격증명(비밀번호·키) 포함 여부
 */
function exportData({ includeCredentials = true } = {}) {
  const cats = db.prepare('SELECT id, name FROM categories').all();
  const catName = (id) => cats.find((c) => c.id === id)?.name || null;

  const media = db.prepare('SELECT * FROM media_accounts ORDER BY id').all().map((m) => ({
    id: m.id,
    platform: m.platform,
    name: m.name,
    url: m.url || '',
    category_name: catName(m.category_id),
    active: m.active,
    credentials: includeCredentials ? safeParse(m.credentials) : {},
  }));

  const ad = db.prepare('SELECT * FROM ad_accounts ORDER BY id').all().map((a) => ({
    id: a.id,
    platform: a.platform,
    name: a.name,
    status: a.status || 'active',
    credentials: includeCredentials ? safeParse(a.credentials) : {},
  }));

  const matchings = db.prepare('SELECT media_account_id, ad_account_id, note FROM matchings').all();

  return {
    type: EXPORT_TYPE,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    includes_credentials: includeCredentials,
    counts: { media: media.length, ad: ad.length, matchings: matchings.length },
    media_accounts: media,
    ad_accounts: ad,
    matchings,
  };
}

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

/** 카테고리를 이름으로 찾고 없으면 생성해 id를 반환한다. */
function resolveCategory(name) {
  if (!name) return null;
  const found = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (found) return found.id;
  const r = db.prepare('INSERT INTO categories(name) VALUES(?)').run(name);
  return Number(r.lastInsertRowid);
}

/**
 * 내보내기 파일을 복원한다.
 * @param {object} data 내보내기 객체
 * @param {{overwriteCredentials?: boolean}} opts 기존 계정의 자격증명 덮어쓰기 여부(기본 true)
 * @returns {{media:{created,updated}, ad:{created,updated}, matchings:{created}, warnings:string[]}}
 */
function importData(data, { overwriteCredentials = true } = {}) {
  if (!data || data.type !== EXPORT_TYPE) {
    throw new Error('올바른 미디어닷 계정 내보내기 파일이 아닙니다.');
  }
  const warnings = [];
  const mediaIdMap = {}; // 원본 id → 새 id
  const adIdMap = {};
  const result = { media: { created: 0, updated: 0 }, ad: { created: 0, updated: 0 }, matchings: { created: 0 }, warnings };

  db.exec('BEGIN');
  try {
    for (const m of data.media_accounts || []) {
      if (!MEDIA_PLATFORMS[m.platform]) { warnings.push(`알 수 없는 미디어 플랫폼 건너뜀: ${m.platform} (${m.name})`); continue; }
      const catId = resolveCategory(m.category_name);
      const existing = db.prepare('SELECT * FROM media_accounts WHERE platform = ? AND name = ?').get(m.platform, m.name);
      const creds = JSON.stringify(m.credentials || {});
      if (existing) {
        const newCreds = overwriteCredentials && Object.keys(m.credentials || {}).length ? creds : existing.credentials;
        db.prepare('UPDATE media_accounts SET category_id=?, url=?, credentials=?, active=? WHERE id=?')
          .run(catId, m.url || '', newCreds, m.active ? 1 : 0, existing.id);
        mediaIdMap[m.id] = existing.id;
        result.media.updated++;
      } else {
        const r = db.prepare('INSERT INTO media_accounts(platform, name, category_id, url, credentials, active) VALUES(?,?,?,?,?,?)')
          .run(m.platform, m.name, catId, m.url || '', creds, m.active ? 1 : 0);
        mediaIdMap[m.id] = Number(r.lastInsertRowid);
        result.media.created++;
      }
    }

    for (const a of data.ad_accounts || []) {
      if (!AD_PLATFORMS[a.platform]) { warnings.push(`알 수 없는 광고 플랫폼 건너뜀: ${a.platform} (${a.name})`); continue; }
      const existing = db.prepare('SELECT * FROM ad_accounts WHERE platform = ? AND name = ?').get(a.platform, a.name);
      const creds = JSON.stringify(a.credentials || {});
      if (existing) {
        const newCreds = overwriteCredentials && Object.keys(a.credentials || {}).length ? creds : existing.credentials;
        db.prepare('UPDATE ad_accounts SET status=?, credentials=? WHERE id=?').run(a.status || 'active', newCreds, existing.id);
        adIdMap[a.id] = existing.id;
        result.ad.updated++;
      } else {
        const r = db.prepare('INSERT INTO ad_accounts(platform, name, credentials, status) VALUES(?,?,?,?)')
          .run(a.platform, a.name, creds, a.status || 'active');
        adIdMap[a.id] = Number(r.lastInsertRowid);
        result.ad.created++;
      }
    }

    for (const mt of data.matchings || []) {
      const mid = mediaIdMap[mt.media_account_id];
      const aid = adIdMap[mt.ad_account_id];
      if (!mid || !aid) { warnings.push('매칭 1건을 복원하지 못했습니다(연결된 계정 누락).'); continue; }
      const r = db.prepare('INSERT OR IGNORE INTO matchings(media_account_id, ad_account_id, note) VALUES(?,?,?)')
        .run(mid, aid, mt.note || '');
      if (r.changes) result.matchings.created++;
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  log('account', `계정 가져오기: 미디어 +${result.media.created}/~${result.media.updated}, 광고 +${result.ad.created}/~${result.ad.updated}, 매칭 +${result.matchings.created}`);
  return result;
}

module.exports = { exportData, importData, EXPORT_TYPE };
