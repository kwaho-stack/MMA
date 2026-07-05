// 수익 자동 동기화 — 리포팅 API를 제공하는 광고 플랫폼의 일별 수익을 가져와 revenues에 반영한다.
//
//   구글 애드센스   : AdSense Management API v2 (Google OAuth refresh token)
//   쿠팡 파트너스   : Open API 커미션 리포트 (HMAC 서명)
//   타불라          : Backstage API (client_credentials)
//   유튜브 파트너   : YouTube Analytics API (Google OAuth refresh token)
//
// 애드포스트·애드핏·틱톡 리워드·텐핑은 공식 리포트 API가 없어 수동 입력만 지원한다.
// 동기화된 행은 source='sync'로 저장되며, 같은 날짜의 기존 sync 행을 대체한다(수동 입력 행은 건드리지 않음).

const crypto = require('node:crypto');
const { db, getSetting, log } = require('./db');

function credsOf(account) {
  try { return JSON.parse(account.credentials || '{}'); } catch { return {}; }
}

function ymd(d) { return d.toISOString().slice(0, 10); }

function dateWindow(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return { start, end };
}

async function httpJSON(url, { method = 'GET', headers = {}, body = null, form = null } = {}) {
  const opts = { method, headers: { ...headers } };
  if (form) {
    opts.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  } else if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const detail = data.error?.message || data.error_description || data.rMessage || text.slice(0, 200);
    throw new Error(`HTTP ${res.status} — ${detail}`);
  }
  return data;
}

// ---------- 통화 환산 ----------
// 대시보드 합산 일관성을 위해 KRW 외 통화는 설정 환율로 환산해 저장하고, 원화폐 금액은 메모에 남긴다.
function toKRW(amount, currency) {
  const cur = (currency || 'KRW').toUpperCase();
  if (cur === 'KRW') return { amount: Math.round(amount), memo: '' };
  const rate = Number(getSetting('usd_krw_rate') || 1400);
  return { amount: Math.round(amount * rate), memo: `${cur} ${amount.toFixed(2)} × ${rate}` };
}

// ---------- Google OAuth (애드센스·유튜브 공용) ----------
async function googleAccessToken(creds) {
  if (creds.refresh_token && creds.client_id && creds.client_secret) {
    const data = await httpJSON('https://oauth2.googleapis.com/token', {
      method: 'POST',
      form: {
        client_id: creds.client_id,
        client_secret: creds.client_secret,
        refresh_token: creds.refresh_token,
        grant_type: 'refresh_token',
      },
    });
    return data.access_token;
  }
  if (creds.access_token) return creds.access_token; // 직접 발급한 단기 토큰(1시간)도 허용
  throw new Error('Google OAuth 자격증명(client_id, client_secret, refresh_token)이 필요합니다.');
}

// ---------- 플랫폼별 페처: 반환 형식 [{date:'YYYY-MM-DD', amount, currency}] ----------

const FETCHERS = {
  // 구글 애드센스 — AdSense Management API v2
  async adsense(account, days) {
    const c = credsOf(account);
    const pub = (c.publisher_id || '').replace(/^accounts\//, '');
    if (!pub) throw new Error('게시자 ID(pub-...)를 등록하세요.');
    const token = await googleAccessToken(c);
    const { start, end } = dateWindow(days);
    const params = new URLSearchParams({
      'dateRange': 'CUSTOM',
      'startDate.year': start.getUTCFullYear(), 'startDate.month': start.getUTCMonth() + 1, 'startDate.day': start.getUTCDate(),
      'endDate.year': end.getUTCFullYear(), 'endDate.month': end.getUTCMonth() + 1, 'endDate.day': end.getUTCDate(),
      'metrics': 'ESTIMATED_EARNINGS',
      'dimensions': 'DATE',
    });
    const data = await httpJSON(`https://adsense.googleapis.com/v2/accounts/${encodeURIComponent(pub)}/reports:generate?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const currency = data.headers?.find((h) => h.currencyCode)?.currencyCode || 'KRW';
    return (data.rows || []).map((r) => ({
      date: r.cells[0].value,
      amount: parseFloat(r.cells[1].value || '0'),
      currency,
    }));
  },

  // 쿠팡 파트너스 — Open API 커미션 리포트 (HMAC-SHA256 서명)
  async coupang_partners(account, days) {
    const c = credsOf(account);
    if (!c.access_key || !c.secret_key) throw new Error('Access Key / Secret Key를 등록하세요.');
    const { start, end } = dateWindow(Math.min(days, 30)); // 쿠팡 리포트는 최대 31일 범위
    const path = '/v2/providers/affiliate_open_api/apis/openapi/reports/commission';
    const query = `startDate=${ymd(start).replace(/-/g, '')}&endDate=${ymd(end).replace(/-/g, '')}`;
    const datetime = `${new Date().toISOString().substring(2, 19).replace(/[-:]/g, '')}Z`; // yyMMdd'T'HHmmss'Z'
    const message = datetime + 'GET' + path + query;
    const signature = crypto.createHmac('sha256', c.secret_key).update(message).digest('hex');
    const data = await httpJSON(`https://api-gateway.coupang.com${path}?${query}`, {
      headers: {
        Authorization: `CEA algorithm=HmacSHA256, access-key=${c.access_key}, signed-date=${datetime}, signature=${signature}`,
      },
    });
    if (data.rCode && data.rCode !== '0') throw new Error(`쿠팡 API 오류: ${data.rMessage || data.rCode}`);
    // 일자별 커미션 합산
    const byDate = {};
    for (const row of data.data || []) {
      const d = String(row.date || '');
      const iso = d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d;
      byDate[iso] = (byDate[iso] || 0) + Number(row.commission || 0);
    }
    return Object.entries(byDate).map(([date, amount]) => ({ date, amount, currency: 'KRW' }));
  },

  // 타불라 — Backstage API 퍼블리셔 수익 리포트
  async taboola(account, days) {
    const c = credsOf(account);
    if (!c.client_id || !c.client_secret || !c.account_id) {
      throw new Error('Client ID / Client Secret / Account ID를 등록하세요.');
    }
    const tok = await httpJSON('https://backstage.taboola.com/backstage/oauth/token', {
      method: 'POST',
      form: { client_id: c.client_id, client_secret: c.client_secret, grant_type: 'client_credentials' },
    });
    const { start, end } = dateWindow(days);
    const data = await httpJSON(
      `https://backstage.taboola.com/backstage/api/1.0/${encodeURIComponent(c.account_id)}/reports/revenue-summary/dimensions/day?start_date=${ymd(start)}&end_date=${ymd(end)}`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } },
    );
    return (data.results || []).map((r) => ({
      date: String(r.date).slice(0, 10),
      amount: Number(r.revenue ?? r.publisher_revenue ?? 0),
      currency: r.currency || 'USD',
    }));
  },

  // 유튜브 파트너 — YouTube Analytics API (estimatedRevenue)
  async youtube_partner(account, days) {
    const c = credsOf(account);
    const token = await googleAccessToken(c);
    const { start, end } = dateWindow(days);
    const params = new URLSearchParams({
      ids: 'channel==MINE',
      startDate: ymd(start),
      endDate: ymd(end),
      metrics: 'estimatedRevenue',
      dimensions: 'day',
      currency: 'KRW',
    });
    const data = await httpJSON(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (data.rows || []).map((r) => ({ date: r[0], amount: Number(r[1] || 0), currency: 'KRW' }));
  },
};

const SYNCABLE = Object.keys(FETCHERS);

/** 일별 수익 rows를 revenues 테이블에 반영 — 같은 날짜의 기존 sync 행을 대체(수동 행 보존). */
function saveDailyRevenue(adAccountId, rows) {
  const del = db.prepare(`DELETE FROM revenues WHERE ad_account_id = ? AND date = ? AND source = 'sync'`);
  const ins = db.prepare(
    `INSERT INTO revenues(ad_account_id, media_account_id, date, amount, currency, memo, source) VALUES(?,?,?,?,?,?,'sync')`,
  );
  let saved = 0, total = 0;
  for (const row of rows) {
    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const { amount, memo } = toKRW(Number(row.amount) || 0, row.currency);
    del.run(adAccountId, row.date);
    if (amount !== 0) {
      ins.run(adAccountId, null, row.date, amount, 'KRW', memo ? `자동 동기화 (${memo})` : '자동 동기화');
      saved++; total += amount;
    }
  }
  return { saved, total };
}

/** 광고 계정 1개 동기화 */
async function syncAdAccount(adAccountId, days = null) {
  const account = db.prepare('SELECT * FROM ad_accounts WHERE id = ?').get(adAccountId);
  if (!account) throw new Error('광고 계정을 찾을 수 없습니다.');
  const fetcher = FETCHERS[account.platform];
  if (!fetcher) throw new Error('이 광고 플랫폼은 리포트 API가 없어 자동 동기화를 지원하지 않습니다. 수익 화면에서 수동 입력하세요.');

  const windowDays = Number(days || getSetting('revenue_sync_days') || 7);
  try {
    const rows = await fetcher(account, windowDays);
    const { saved, total } = saveDailyRevenue(account.id, rows);
    db.prepare(`UPDATE ad_accounts SET last_sync_at = datetime('now','localtime'), sync_error = '' WHERE id = ?`).run(account.id);
    log('revenue', `수익 동기화 완료: ${account.name} — 최근 ${windowDays}일 중 ${saved}일치, 합계 ${total.toLocaleString('ko-KR')}원`, { adAccountId: account.id });
    return { ok: true, days: windowDays, saved, total };
  } catch (e) {
    const msg = String(e.message || e);
    db.prepare(`UPDATE ad_accounts SET sync_error = ? WHERE id = ?`).run(msg, account.id);
    log('error', `수익 동기화 실패: ${account.name} — ${msg}`, { adAccountId: account.id });
    throw new Error(`${account.name} 동기화 실패: ${msg}`);
  }
}

/** 자격증명이 갖춰진(연동 준비된) 광고 계정 일괄 동기화 */
function syncReadyAccounts() {
  const { AD_PLATFORMS } = require('./catalog');
  return db.prepare('SELECT * FROM ad_accounts').all().filter((a) => {
    const def = AD_PLATFORMS[a.platform];
    if (!def || !def.sync) return false;
    const creds = credsOf(a);
    return def.sync.required.every((k) => creds[k]);
  });
}

async function syncAll(days = null) {
  const accounts = syncReadyAccounts();
  const results = [];
  for (const a of accounts) {
    try {
      const r = await syncAdAccount(a.id, days);
      results.push({ id: a.id, name: a.name, ...r });
    } catch (e) {
      results.push({ id: a.id, name: a.name, ok: false, error: String(e.message || e) });
    }
  }
  return results;
}

module.exports = { syncAdAccount, syncAll, syncReadyAccounts, saveDailyRevenue, SYNCABLE };
