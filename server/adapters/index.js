// 발행 어댑터 — 플랫폼별 실제 배포 로직.
// simulate_publish=1 이면 외부 API를 호출하지 않고 시뮬레이션 URL로 성공 처리한다(데모/테스트용).
// API 자격증명이 없거나 플랫폼이 manual 모드면 'manual' 결과를 돌려주고,
// 프론트에서 복사용 발행 패키지를 제공한다(반자동 발행).

const { MEDIA_PLATFORMS } = require('../catalog');
const { getSetting } = require('../db');

async function postJSON(url, { headers = {}, body, method = 'POST' } = {}) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    throw new Error(`${url} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return data;
}

function credsOf(account) {
  try { return JSON.parse(account.credentials || '{}'); } catch { return {}; }
}

function hasRequiredCreds(platformKey, account) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def || def.publish.mode !== 'api') return false;
  const creds = credsOf(account);
  return def.publish.credentialFields
    .filter((f) => f.required)
    .every((f) => creds[f.key] && String(creds[f.key]).trim() !== '');
}

const API_PUBLISHERS = {
  async blogger(account, variant) {
    const c = credsOf(account);
    const data = await postJSON(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(c.blog_id)}/posts/`,
      {
        headers: { Authorization: `Bearer ${c.access_token}` },
        body: { kind: 'blogger#post', title: variant.title, content: variant.body },
      },
    );
    return { url: data.url || '' };
  },

  async wordpress(account, variant) {
    const c = credsOf(account);
    const auth = Buffer.from(`${c.username}:${c.app_password}`).toString('base64');
    const data = await postJSON(`${c.site_url.replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
      headers: { Authorization: `Basic ${auth}` },
      body: { title: variant.title, content: variant.body, status: 'publish' },
    });
    return { url: data.link || '' };
  },

  async facebook(account, variant) {
    const c = credsOf(account);
    const message = `${variant.title}\n\n${variant.body}`;
    const data = await postJSON(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(c.page_id)}/feed`,
      { body: { message, access_token: c.page_access_token } },
    );
    return { url: data.id ? `https://www.facebook.com/${data.id}` : '' };
  },

  async threads(account, variant) {
    const c = credsOf(account);
    // Threads API: 컨테이너 생성 → 발행 2단계
    const text = `${variant.title}\n\n${variant.body}`.slice(0, 490);
    const container = await postJSON(
      `https://graph.threads.net/v1.0/${encodeURIComponent(c.threads_user_id)}/threads`,
      { body: { media_type: 'TEXT', text, access_token: c.access_token } },
    );
    const pub = await postJSON(
      `https://graph.threads.net/v1.0/${encodeURIComponent(c.threads_user_id)}/threads_publish`,
      { body: { creation_id: container.id, access_token: c.access_token } },
    );
    return { url: pub.id ? `https://www.threads.net/post/${pub.id}` : '' };
  },

  async x_twitter(account, variant) {
    const c = credsOf(account);
    const text = `${variant.title}\n\n${variant.body}`.slice(0, 270);
    const data = await postJSON('https://api.twitter.com/2/tweets', {
      headers: { Authorization: `Bearer ${c.access_token}` },
      body: { text },
    });
    return { url: data.data?.id ? `https://x.com/i/status/${data.data.id}` : '' };
  },

  async instagram(account, variant) {
    const c = credsOf(account);
    if (!c.default_image_url) {
      throw new Error('인스타그램 발행에는 이미지가 필요합니다. 기본 카드 이미지 URL을 등록하거나 수동 발행하세요.');
    }
    const extra = JSON.parse(variant.extra || '{}');
    const caption = [extra.caption || variant.title, (extra.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')]
      .filter(Boolean).join('\n\n').slice(0, 2100);
    const container = await postJSON(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(c.ig_user_id)}/media`,
      { body: { image_url: c.default_image_url, caption, access_token: c.access_token } },
    );
    const pub = await postJSON(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(c.ig_user_id)}/media_publish`,
      { body: { creation_id: container.id, access_token: c.access_token } },
    );
    return { url: pub.id ? `https://www.instagram.com/p/${pub.id}` : '' };
  },
};

/**
 * 발행 실행.
 * @returns {Promise<{mode:'published'|'manual', url?:string, simulated?:boolean, reason?:string}>}
 */
async function publish(platformKey, account, variant) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def) throw new Error(`알 수 없는 플랫폼: ${platformKey}`);

  const simulate = getSetting('simulate_publish') === '1';

  if (def.publish.mode === 'manual') {
    return { mode: 'manual', reason: def.publish.manualReason };
  }

  if (simulate) {
    return {
      mode: 'published',
      simulated: true,
      url: `https://demo.mediadot.local/${platformKey}/${account.id}/${variant.id}`,
    };
  }

  if (!hasRequiredCreds(platformKey, account)) {
    return { mode: 'manual', reason: 'API 자격증명이 등록되지 않아 수동 발행으로 전환되었습니다. 계정 관리에서 자격증명을 등록하세요.' };
  }

  const fn = API_PUBLISHERS[platformKey];
  if (!fn) return { mode: 'manual', reason: '이 플랫폼의 API 발행은 아직 지원되지 않습니다.' };
  const { url } = await fn(account, variant);
  return { mode: 'published', simulated: false, url };
}

module.exports = { publish, hasRequiredCreds };
