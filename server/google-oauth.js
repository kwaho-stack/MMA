// Google 계정 연결 — OAuth 2.0 디바이스 플로우로 Google 계정을 연결해 Gemini(텍스트·이미지)를 사용한다.
// GitHub Copilot 연결과 같은 방식(코드 입력)이며, 텍스트 엔진과 이미지 엔진이 하나의 연결을 공유한다.
//
// 준비물(설정에서 입력): Google Cloud Console → OAuth 클라이언트(유형: TV 및 입력 제한 기기)의
//   client_id / client_secret. 사용 프로젝트에 "Generative Language API"가 사용 설정되어 있어야 한다.
// 저장물: refresh_token(설정 google_refresh_token, 절대 외부로 내보내지 않음), 표시용 이메일.

const { getSetting, setSetting, log } = require('./db');

// Gemini generateContent + 사용자 이메일 조회에 필요한 스코프
const SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever openid email';
// 위 retriever 스코프로 generateContent가 막히는 프로젝트를 위한 광역 폴백 스코프
const SCOPE_BROAD = 'https://www.googleapis.com/auth/cloud-platform openid email';

let accessCache = null; // { token, expiresAt }

async function httpForm(url, form) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok && !data.error) {
    throw new Error(`HTTP ${res.status} — ${text.slice(0, 200)}`);
  }
  return data;
}

function creds() {
  return {
    client_id: getSetting('google_client_id') || '',
    client_secret: getSetting('google_client_secret') || '',
  };
}

// ---------- 디바이스 플로우 ----------

async function deviceStart() {
  const { client_id } = creds();
  if (!client_id) throw new Error('Google OAuth Client ID를 먼저 입력하세요. (Google Cloud Console → OAuth 클라이언트: TV 및 입력 제한 기기)');
  const d = await httpForm('https://oauth2.googleapis.com/device/code', { client_id, scope: SCOPE_BROAD });
  if (d.error) throw new Error(`${d.error_description || d.error} — Client ID와 OAuth 동의 화면 설정을 확인하세요.`);
  return {
    device_code: d.device_code,
    user_code: d.user_code,
    verification_uri: d.verification_url || d.verification_uri || 'https://www.google.com/device',
    interval: d.interval || 5,
    expires_in: d.expires_in || 1800,
  };
}

async function devicePoll(deviceCode) {
  const { client_id, client_secret } = creds();
  const d = await httpForm('https://oauth2.googleapis.com/token', {
    client_id,
    client_secret,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (d.error === 'authorization_pending' || d.error === 'slow_down') return { pending: true };
  if (d.error) throw new Error(d.error_description || d.error);
  if (!d.refresh_token && !d.access_token) return { pending: true };

  if (d.refresh_token) setSetting('google_refresh_token', d.refresh_token);
  accessCache = d.access_token ? { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 } : null;

  const email = emailFromIdToken(d.id_token) || '';
  setSetting('google_user', email);
  log('system', `Google 계정 연결 완료${email ? ` (${email})` : ''}`);
  return { ok: true, user: email };
}

function emailFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(String(idToken).split('.')[1], 'base64').toString('utf8'));
    return payload.email || '';
  } catch { return ''; }
}

// ---------- 토큰·상태 ----------

function isConnected() {
  return Boolean(getSetting('google_refresh_token'));
}

function status() {
  return { connected: isConnected(), user: getSetting('google_user') || '', client_id_set: Boolean(getSetting('google_client_id')) };
}

function logout() {
  setSetting('google_refresh_token', '');
  setSetting('google_user', '');
  accessCache = null;
}

/** refresh_token → access_token (1시간, 캐시). */
async function accessToken() {
  const refresh = getSetting('google_refresh_token');
  if (!refresh) throw new Error('Google 계정이 연결되지 않았습니다. 설정에서 연결하세요.');
  if (accessCache && accessCache.expiresAt > Date.now() + 60 * 1000) return accessCache.token;

  const { client_id, client_secret } = creds();
  const d = await httpForm('https://oauth2.googleapis.com/token', {
    client_id, client_secret, refresh_token: refresh, grant_type: 'refresh_token',
  });
  if (d.error) throw new Error(`Google 토큰 갱신 실패: ${d.error_description || d.error}`);
  accessCache = { token: d.access_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
  return accessCache.token;
}

module.exports = { deviceStart, devicePoll, isConnected, status, logout, accessToken };
