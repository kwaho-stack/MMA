// 발행 어댑터 — 플랫폼별 실제 배포 로직.
// simulate_publish=1 이면 외부 API를 호출하지 않고 시뮬레이션 URL로 성공 처리한다(데모/테스트용).
// mode 'api'     : 공식 API 호출 (자격증명 없으면 수동 폴백)
// mode 'browser' : Playwright 브라우저 자동화 — 네이버 블로그·티스토리 (실패 시 수동 폴백)
// mode 'manual'  : 복사용 발행 패키지 제공(반자동)

const { MEDIA_PLATFORMS } = require('../catalog');
const { getSetting, log } = require('../db');
const images = require('../images');

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
  if (!def || !['api', 'browser'].includes(def.publish.mode)) return false;
  const creds = credsOf(account);
  return def.publish.credentialFields
    .filter((f) => f.required)
    .every((f) => creds[f.key] && String(creds[f.key]).trim() !== '');
}

function extraOf(variant) {
  try { return JSON.parse(variant.extra || '{}'); } catch { return {}; }
}

/** [이미지: …] 마커를 <img> 태그로 치환한 HTML 본문 — API 블로그 발행용 */
function htmlBody(variant) {
  const extra = extraOf(variant);
  return images.bodyWithImageTags(variant.body, extra.images || [], { html: true });
}

const API_PUBLISHERS = {
  async blogger(account, variant) {
    const c = credsOf(account);
    const data = await postJSON(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(c.blog_id)}/posts/`,
      {
        headers: { Authorization: `Bearer ${c.access_token}` },
        body: { kind: 'blogger#post', title: variant.title, content: htmlBody(variant) },
      },
    );
    return { url: data.url || '' };
  },

  async wordpress(account, variant) {
    const c = credsOf(account);
    const auth = Buffer.from(`${c.username}:${c.app_password}`).toString('base64');
    const data = await postJSON(`${c.site_url.replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
      headers: { Authorization: `Basic ${auth}` },
      body: { title: variant.title, content: htmlBody(variant), status: 'publish' },
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

  // 인스타그램 — 카드뉴스가 있으면 캐러셀(여러 장) 업로드, 없으면 단일 이미지 폴백.
  // Graph API는 공개 접근 가능한 이미지 URL만 받으므로 public_base_url 설정이 필요하다.
  async instagram(account, variant) {
    const c = credsOf(account);
    const extra = extraOf(variant);
    const IG = `https://graph.facebook.com/v21.0/${encodeURIComponent(c.ig_user_id)}`;
    const caption = [extra.caption || variant.title, (extra.hashtags || []).map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')]
      .filter(Boolean).join('\n\n').slice(0, 2100);

    const base = (getSetting('public_base_url') || '').replace(/\/$/, '');
    const cards = (extra.cards || []).slice(0, 10);

    if (cards.length >= 2 && base) {
      // 1) 카드별 캐러셀 아이템 컨테이너 생성
      const children = [];
      for (const card of cards) {
        const item = await postJSON(`${IG}/media`, {
          body: { image_url: `${base}${card}`, is_carousel_item: true, access_token: c.access_token },
        });
        children.push(item.id);
      }
      // 2) 캐러셀 컨테이너 → 3) 발행
      const container = await postJSON(`${IG}/media`, {
        body: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: c.access_token },
      });
      const pub = await postJSON(`${IG}/media_publish`, {
        body: { creation_id: container.id, access_token: c.access_token },
      });
      return { url: pub.id ? `https://www.instagram.com/p/${pub.id}` : '' };
    }

    if (cards.length >= 2 && !base) {
      throw new Error('카드뉴스가 준비되었지만 서버 공개 URL(public_base_url)이 설정되지 않아 인스타그램에 업로드할 수 없습니다. 설정 → 이미지 엔진에서 공개 URL을 등록하거나, 카드 이미지를 내려받아 수동 업로드하세요.');
    }

    const single = cards.length === 1 && base ? `${base}${cards[0]}` : c.default_image_url;
    if (!single) {
      throw new Error('인스타그램 발행에는 이미지가 필요합니다. 카드뉴스 생성을 켜고 public_base_url을 설정하거나, 대체 이미지 URL을 등록하세요.');
    }
    const container = await postJSON(`${IG}/media`, {
      body: { image_url: single, caption, access_token: c.access_token },
    });
    const pub = await postJSON(`${IG}/media_publish`, {
      body: { creation_id: container.id, access_token: c.access_token },
    });
    return { url: pub.id ? `https://www.instagram.com/p/${pub.id}` : '' };
  },
};

// 브라우저 자동 발행 (Playwright) — 모듈은 사용 시점에 로드한다.
const BROWSER_PUBLISHERS = {
  naver_blog: () => require('./naver-blog'),
  tistory: () => require('./tistory'),
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
    return {
      mode: 'manual',
      reason: def.publish.mode === 'browser'
        ? '로그인 정보가 등록되지 않아 수동 발행으로 전환되었습니다. 계정 관리에서 아이디/비밀번호를 등록하면 브라우저 자동 발행됩니다.'
        : 'API 자격증명이 등록되지 않아 수동 발행으로 전환되었습니다. 계정 관리에서 자격증명을 등록하세요.',
    };
  }

  // 브라우저 자동 발행 — 실패하면 원인과 함께 수동 발행으로 폴백한다.
  if (def.publish.mode === 'browser') {
    try {
      const { url } = await BROWSER_PUBLISHERS[platformKey]().publish(account, variant);
      return { mode: 'published', simulated: false, url };
    } catch (e) {
      log('error', `브라우저 자동 발행 실패(${def.name}/${account.name}): ${e.message}`, { variantId: variant.id });
      return { mode: 'manual', reason: `브라우저 자동 발행 실패 — ${e.message} 원고 복사로 수동 발행할 수 있습니다.` };
    }
  }

  const fn = API_PUBLISHERS[platformKey];
  if (!fn) return { mode: 'manual', reason: '이 플랫폼의 API 발행은 아직 지원되지 않습니다.' };
  const { url } = await fn(account, variant);
  return { mode: 'published', simulated: false, url };
}

module.exports = { publish, hasRequiredCreds };
