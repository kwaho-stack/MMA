// GitHub Copilot 텍스트 엔진 — 사용자의 Copilot 구독을 디바이스 플로우 로그인으로 연결해
// 주제 발굴·원고 작성·리라이팅에 활용한다. (Claude API 키 없이도 운영 가능한 대안 엔진)
//
// 흐름: 디바이스 코드 발급 → 사용자가 github.com/login/device 에서 코드 입력 →
//       OAuth 토큰 저장 → Copilot 세션 토큰 교환(1시간, 자동 갱신) → chat/completions 호출.
// 주의: 개인 Copilot 구독 계정에서만 사용하세요.

const { getSetting, setSetting, log } = require('./db');

// VS Code가 사용하는 공개 디바이스 플로우 client_id (시크릿 불필요)
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';

const EDITOR_HEADERS = {
  'editor-version': 'vscode/1.99.0',
  'editor-plugin-version': 'copilot-chat/0.26.7',
  'user-agent': 'GitHubCopilotChat/0.26.7',
};

let sessionToken = null; // { token, expiresAt } — Copilot 단기 세션 토큰 캐시

async function httpJSON(url, { method = 'POST', headers = {}, form = null, body = null } = {}) {
  const opts = { method, headers: { Accept: 'application/json', ...headers } };
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
    throw new Error(`HTTP ${res.status} — ${data.error_description || data.message || text.slice(0, 200)}`);
  }
  return data;
}

// ---------- 디바이스 플로우 로그인 ----------

/** 1단계: 디바이스 코드 발급 — 사용자에게 user_code와 verification_uri를 보여준다. */
async function deviceStart() {
  const d = await httpJSON('https://github.com/login/device/code', {
    form: { client_id: CLIENT_ID, scope: 'read:user' },
  });
  return {
    device_code: d.device_code,
    user_code: d.user_code,
    verification_uri: d.verification_uri || 'https://github.com/login/device',
    interval: d.interval || 5,
    expires_in: d.expires_in || 900,
  };
}

/** 2단계: 사용자가 코드를 입력했는지 폴링. 완료되면 토큰을 저장한다. */
async function devicePoll(deviceCode) {
  const d = await httpJSON('https://github.com/login/oauth/access_token', {
    form: {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    },
  });
  if (d.error === 'authorization_pending' || d.error === 'slow_down') return { pending: true };
  if (d.error) throw new Error(d.error_description || d.error);
  if (!d.access_token) return { pending: true };

  setSetting('github_copilot_token', d.access_token);
  sessionToken = null;
  // 계정명 조회 (표시용)
  let user = '';
  try {
    const me = await httpJSON('https://api.github.com/user', {
      method: 'GET',
      headers: { Authorization: `token ${d.access_token}`, ...EDITOR_HEADERS },
    });
    user = me.login || '';
  } catch { /* 표시용 정보라 실패해도 무시 */ }
  setSetting('github_copilot_user', user);
  log('system', `GitHub Copilot 연결 완료${user ? ` (@${user})` : ''}`);
  return { ok: true, user };
}

function isConnected() {
  return Boolean(getSetting('github_copilot_token'));
}

function status() {
  return { connected: isConnected(), user: getSetting('github_copilot_user') || '' };
}

function logout() {
  setSetting('github_copilot_token', '');
  setSetting('github_copilot_user', '');
  sessionToken = null;
}

// ---------- Copilot 세션 토큰 (1시간 유효, 자동 갱신) ----------

async function bearer() {
  const gh = getSetting('github_copilot_token');
  if (!gh) throw new Error('GitHub Copilot이 연결되지 않았습니다. 설정에서 로그인하세요.');
  if (sessionToken && sessionToken.expiresAt > Date.now() + 60 * 1000) return sessionToken.token;

  try {
    const d = await httpJSON('https://api.github.com/copilot_internal/v2/token', {
      method: 'GET',
      headers: { Authorization: `token ${gh}`, ...EDITOR_HEADERS },
    });
    sessionToken = { token: d.token, expiresAt: (d.expires_at ? d.expires_at * 1000 : Date.now() + 25 * 60 * 1000) };
    return sessionToken.token;
  } catch (e) {
    if (String(e.message).includes('401') || String(e.message).includes('403')) {
      throw new Error('Copilot 구독을 확인할 수 없습니다. 해당 GitHub 계정에 활성 Copilot 구독이 있는지 확인하세요.');
    }
    throw e;
  }
}

// ---------- 텍스트 생성 ----------

/** OpenAI 호환 chat completions. 응답 텍스트를 반환한다. */
async function chat({ system, prompt, maxTokens = 8000 }) {
  const token = await bearer();
  const model = getSetting('copilot_model') || 'gpt-4o';
  const d = await httpJSON('https://api.githubcopilot.com/chat/completions', {
    headers: {
      Authorization: `Bearer ${token}`,
      'Copilot-Integration-Id': 'vscode-chat',
      ...EDITOR_HEADERS,
    },
    body: {
      model,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: prompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.7,
      stream: false,
    },
  });
  const text = d.choices?.[0]?.message?.content;
  if (!text) throw new Error(`Copilot 응답이 비어 있습니다 (model: ${model}).`);
  return text;
}

module.exports = { deviceStart, devicePoll, isConnected, status, logout, chat };
