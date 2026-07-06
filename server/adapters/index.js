// 발행 어댑터 — 플랫폼별 실제 배포 로직.
// simulate_publish=1 이면 외부 API를 호출하지 않고 시뮬레이션 URL로 성공 처리한다(데모/테스트용).
// mode 'api'     : 공식 API 호출 (자격증명 없으면 수동 폴백)
// mode 'browser' : Playwright 브라우저 자동화 — 네이버 블로그·티스토리 (실패 시 수동 폴백)
// mode 'manual'  : 복사용 발행 패키지 제공(반자동)

const { MEDIA_PLATFORMS, validateCreds, isWpcomHost } = require('../catalog');
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
  return validateCreds(platformKey, credsOf(account)).ok;
}

/**
 * Google OAuth 액세스 토큰 확보.
 * refresh_token(+client_id/secret)이 있으면 발행 직전에 새 액세스 토큰을 발급받고(만료 회피),
 * 없으면 저장된 단기 access_token을 그대로 쓴다.
 */
async function googleAccessToken(c) {
  if (c.refresh_token && c.client_id && c.client_secret) {
    const params = new URLSearchParams({
      client_id: c.client_id,
      client_secret: c.client_secret,
      refresh_token: c.refresh_token,
      grant_type: 'refresh_token',
    });
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) {
      throw new Error(`Google 액세스 토큰 갱신 실패 — refresh token/client 정보를 확인하세요. (${data.error_description || data.error || `HTTP ${res.status}`})`);
    }
    return data.access_token;
  }
  if (c.access_token) return c.access_token;
  throw new Error('Blogger 인증 정보가 없습니다. Refresh Token(권장) 또는 Access Token을 등록하세요.');
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
    const token = await googleAccessToken(c); // refresh_token이 있으면 여기서 자동 갱신
    const data = await postJSON(
      `https://www.googleapis.com/blogger/v3/blogs/${encodeURIComponent(c.blog_id)}/posts/`,
      {
        headers: { Authorization: `Bearer ${token}` },
        body: { kind: 'blogger#post', title: variant.title, content: htmlBody(variant) },
      },
    );
    return { url: data.url || '' };
  },

  async wordpress(account, variant) {
    const c = credsOf(account);
    const html = htmlBody(variant);

    // 가입형(WordPress.com): 무료·하위 플랜은 wp-json이 막혀 있어 public-api를 써야 한다.
    // 호스트가 *.wordpress.com 이거나 액세스 토큰이 등록돼 있으면 이 경로로 발행한다.
    if (isWpcomHost(c.site_url) || c.wpcom_token) {
      if (!c.wpcom_token) {
        throw new Error('WordPress.com 가입형 블로그는 액세스 토큰이 필요합니다. developer.wordpress.com/apps 에서 앱을 만들어 OAuth2 액세스 토큰을 발급받아 계정 정보에 등록하세요. (자체 호스팅 워드프레스라면 사이트 URL에 실제 도메인을 넣으세요)');
      }
      let host;
      try {
        host = new URL(/^https?:\/\//.test(c.site_url) ? c.site_url : `https://${c.site_url}`).hostname;
      } catch { host = String(c.site_url).replace(/^https?:\/\//, '').replace(/\/.*$/, ''); }
      const data = await postJSON(
        `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(host)}/posts/new`,
        {
          headers: { Authorization: `Bearer ${c.wpcom_token}` },
          body: { title: variant.title, content: html, status: 'publish' },
        },
      );
      return { url: data.URL || data.short_URL || '' };
    }

    // 자체 호스팅: 표준 REST API(wp-json) + Application Password(Basic 인증)
    const auth = Buffer.from(`${c.username}:${c.app_password}`).toString('base64');
    const data = await postJSON(`${c.site_url.replace(/\/$/, '')}/wp-json/wp/v2/posts`, {
      headers: { Authorization: `Basic ${auth}` },
      body: { title: variant.title, content: html, status: 'publish' },
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
    // 대체 이미지: 계정별 지정값 우선, 없으면 설정의 전역 대체 이미지.
    const fallback = (c.default_image_url || getSetting('default_image_url') || '').trim();

    // 카드뉴스가 2장 이상이고 공개 URL이 있으면 → 캐러셀 자동 업로드(최선)
    if (cards.length >= 2 && base) {
      const children = [];
      for (const card of cards) {
        const item = await postJSON(`${IG}/media`, {
          body: { image_url: `${base}${card}`, is_carousel_item: true, access_token: c.access_token },
        });
        children.push(item.id);
      }
      const container = await postJSON(`${IG}/media`, {
        body: { media_type: 'CAROUSEL', children: children.join(','), caption, access_token: c.access_token },
      });
      const pub = await postJSON(`${IG}/media_publish`, {
        body: { creation_id: container.id, access_token: c.access_token },
      });
      return { url: pub.id ? `https://www.instagram.com/p/${pub.id}` : '' };
    }

    // 캐러셀이 불가능한 모든 경우 → 단일 이미지로 폴백.
    //  · 공개 URL이 있고 카드가 1장 이상이면 첫 카드 이미지를 사용
    //  · 그 외에는 대체 이미지 URL(계정별 또는 전역)을 사용
    const single = (base && cards.length >= 1) ? `${base}${cards[0]}` : fallback;
    if (!single) {
      const why = cards.length >= 2
        ? `카드뉴스 ${cards.length}장이 준비됐지만 서버 공개 URL(public_base_url)이 없어 캐러셀 업로드가 불가능합니다.`
        : '게시할 이미지가 없습니다.';
      throw new Error(`${why} 해결: ① 설정 → 이미지 엔진에서 서버 공개 URL을 등록해 카드뉴스를 자동 업로드하거나, ② 계정 정보 또는 설정에 "대체 이미지 URL"(공개 접근 가능한 https 이미지)을 등록하세요. 인스타그램 Graph API는 반드시 외부에서 열리는 이미지 URL이 필요합니다.`);
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

/**
 * 브라우저 자동 발행 플랫폼(네이버·티스토리)에서 사용자가 직접 로그인하도록
 * 화면이 보이는 로그인 창을 띄운다. 성공 시 세션이 저장돼 이후 자동 발행이 재사용한다.
 */
async function browserLogin(platformKey, account) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def) throw new Error(`알 수 없는 플랫폼: ${platformKey}`);
  if (def.publish.mode !== 'browser' || !BROWSER_PUBLISHERS[platformKey]) {
    throw new Error(`${def.name}은(는) 브라우저 직접 로그인이 필요한 플랫폼이 아닙니다.`);
  }
  const mod = BROWSER_PUBLISHERS[platformKey]();
  if (!mod.browserLogin) throw new Error(`${def.name} 직접 로그인은 아직 지원되지 않습니다.`);
  return mod.browserLogin(account);
}

/**
 * 사용자 실브라우저에서 복사한 로그인 쿠키를 계정 프로필에 주입한다(캡차 없는 프론트 방식).
 */
async function importCookies(platformKey, account, raw) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def) throw new Error(`알 수 없는 플랫폼: ${platformKey}`);
  if (def.publish.mode !== 'browser' || !BROWSER_PUBLISHERS[platformKey]) {
    throw new Error(`${def.name}은(는) 쿠키 로그인 대상 플랫폼이 아닙니다.`);
  }
  const mod = BROWSER_PUBLISHERS[platformKey]();
  if (!mod.importCookies) throw new Error(`${def.name} 쿠키 로그인은 아직 지원되지 않습니다.`);
  return mod.importCookies(account, raw);
}

module.exports = { publish, hasRequiredCreds, browserLogin, importCookies };
