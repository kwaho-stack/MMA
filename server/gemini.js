// Gemini 공용 호출 계층 — 텍스트(llm)와 이미지(images)가 함께 쓴다.
// 인증은 두 경로를 지원한다:
//   1) Gemini API 키 (설정 gemini_api_key, AI Studio 발급) → ?key= 쿼리
//   2) Google 계정 OAuth (설정에서 연결) → Authorization: Bearer
// 키가 있으면 키를 우선 사용하고, 없으면 OAuth 토큰을 사용한다.

const { getSetting } = require('./db');
const google = require('./google-oauth');

/** 텍스트·이미지 생성이 가능한 상태인지(키 또는 OAuth) */
function available() {
  return Boolean(getSetting('gemini_api_key')) || google.isConnected();
}

/** 현재 인증 방식 라벨 (설정·표시용) */
function authLabel() {
  if (getSetting('gemini_api_key')) return 'API 키';
  if (google.isConnected()) return 'Google 계정';
  return null;
}

async function endpoint(model, method) {
  const key = getSetting('gemini_api_key');
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${method}`;
  if (key) return { url: `${base}?key=${encodeURIComponent(key)}`, headers: {} };
  if (google.isConnected()) {
    const token = await google.accessToken();
    return { url: base, headers: { Authorization: `Bearer ${token}` } };
  }
  throw new Error('Gemini를 사용할 수 없습니다. 설정에서 Gemini API 키를 등록하거나 Google 계정을 연결하세요.');
}

/** generateContent 호출 — 파싱된 응답 JSON을 반환. */
async function generateContent(model, body) {
  const { url, headers } = await endpoint(model, 'generateContent');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status} — ${data.error?.message || text.slice(0, 200)}`);
  return data;
}

/** 후보 응답에서 텍스트 파트를 이어붙인다. */
function textOf(data) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || '').join('').trim();
}

module.exports = { available, authLabel, generateContent, textOf };
