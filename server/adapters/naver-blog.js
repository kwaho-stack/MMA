// 네이버 블로그 브라우저 자동 발행 — 공식 발행 API가 없어 Playwright로 스마트에디터 ONE을 직접 조작한다.
// 로그인 세션은 data/sessions/에 저장되어 재사용된다(매번 로그인하지 않음 → 보호조치 회피가 아니라 자연스러운 이용 패턴).
//
// 흐름: 로그인 확인 → 글쓰기 진입(iframe mainFrame) → 제목 입력 → 본문 문단 입력
//       → [이미지: …] 마커 위치에 생성 이미지 파일 업로드 → 발행 버튼 → 게시 URL 회수
// 캡차·2단계 인증이 뜨면 자동화를 중단하고 명확한 안내와 함께 수동 발행으로 전환된다.

const browser = require('../browser');
const { withAccountPage, clickFirst, openLoginWindow } = browser;
const images = require('../images');

function credsOf(account) {
  try { return JSON.parse(account.credentials || '{}'); } catch { return {}; }
}

// 로그인 여부는 컨텍스트의 쿠키로 판별한다. NID_AUT는 httpOnly라
// document.cookie(JS)로는 절대 안 보이므로, 반드시 ctx.cookies()로 확인해야 한다.
async function isLoggedIn(ctx) {
  const cookies = await ctx.cookies('https://www.naver.com');
  return cookies.some((c) => c.name === 'NID_AUT' && c.value);
}

async function login(page, creds) {
  await page.goto('https://nid.naver.com/nidlogin.login?mode=form', { waitUntil: 'domcontentloaded' });
  // 입력값을 JS로 주입 — 오타·IME 문제 없이 안정적으로 입력된다.
  await page.evaluate(({ id, pw }) => {
    const set = (sel, v) => {
      const el = document.querySelector(sel);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    set('#id', id);
    set('#pw', pw);
  }, { id: creds.naver_id, pw: creds.naver_pw });
  await clickFirst(page, ['#log\\.login', 'button[type=submit]', '.btn_login']);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  const url = page.url();
  // 새 기기 등록 화면 → "등록안함"
  if (url.includes('deviceConfirm')) {
    await clickFirst(page, ['#new\\.dontsave', 'a:has-text("등록안함")', 'span:has-text("등록안함")'], { optional: true });
    await page.waitForTimeout(1200);
  }
  if (page.url().includes('nidlogin')) {
    const captcha = await page.locator('#captcha, .captcha_wrap, img[alt*="캡차"]').count();
    if (captcha) {
      throw new Error('네이버가 자동입력 방지(캡차)를 요구합니다. PC 브라우저에서 이 계정으로 한 번 로그인한 뒤 다시 시도하거나, 잠시 후 재시도하세요.');
    }
    const msg = await page.locator('.error_message, #err_common').first().textContent().catch(() => '');
    throw new Error(`네이버 로그인 실패${msg ? ` — ${msg.trim()}` : ''}. 아이디/비밀번호를 확인하세요.`);
  }
}

/** 에디터 프레임 확보 — 글쓰기 페이지의 mainFrame 안에 스마트에디터가 뜬다. */
async function editorFrame(page) {
  for (let i = 0; i < 20; i++) {
    for (const f of page.frames()) {
      try {
        if (await f.locator('.se-container, .se-title-text').count()) return f;
      } catch { /* 프레임 교체 중 */ }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('네이버 에디터 로딩에 실패했습니다.');
}

async function insertImage(page, frame, filePath) {
  const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
  await clickFirst(frame, [
    'button[data-name="image"]',
    '.se-image-toolbar-button',
    'button[data-log="dot.img"]',
    'button:has-text("사진")',
  ]);
  const fc = await chooser;
  await fc.setFiles(filePath);
  await page.waitForTimeout(2500); // 업로드 완료 대기
  // 업로드 후 커서를 본문 끝으로
  await frame.locator('.se-component.se-text .se-text-paragraph').last().click({ timeout: 3000 }).catch(() => {});
}

/**
 * 한 줄을 네이버 스마트에디터 인용구(quotation) 컴포넌트로 삽입한다.
 * 에디터 버전에 따라 툴바 셀렉터가 달라 여러 후보를 시도하고, 버튼을 못 찾으면
 * 인용부호로 감싼 일반 문단으로 폴백한다(발행 자체는 막지 않는다).
 */
async function insertQuote(page, frame, text) {
  const opened = await clickFirst(frame, [
    'button[data-name="quotation"]',
    'button[data-log="fnt.quot"]',
    '.se-toolbar-item-quotation button',
    'button[aria-label*="인용"]',
    'button.se-toolbar-button-quotation',
    'button:has-text("인용구")',
  ], { optional: true, timeout: 1500 });
  if (opened) {
    // 인용구 스타일 서브메뉴가 뜨면 첫 스타일을 고른다(없으면 무시).
    await clickFirst(frame, [
      '.se-toolbar-option-quotation button',
      '.se-quotation-type-option button',
      '.se-toolbar-submenu button',
    ], { optional: true, timeout: 800 });
    await page.keyboard.type(text, { delay: 6 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter'); // 인용구 블록에서 빠져나와 일반 문단으로 복귀
    return true;
  }
  // 폴백: 인용부호로 감싼 문단
  await page.keyboard.type(`“${text}”`, { delay: 6 });
  await page.keyboard.press('Enter');
  return false;
}

/**
 * 사용자가 직접 로그인할 수 있도록 화면이 보이는(headful) 네이버 로그인 창을 띄운다.
 * 아이디/비밀번호가 등록돼 있으면 미리 채워 넣고, 캡차·2단계 인증은 사용자가 직접 처리한다.
 * NID_AUT 쿠키가 확인되면 로그인 성공으로 보고 세션을 저장한다(이후 자동 발행이 이 세션을 재사용).
 */
async function browserLogin(account) {
  const creds = credsOf(account);
  return openLoginWindow(account, {
    startUrl: 'https://nid.naver.com/nidlogin.login?mode=form',
    prefill: async (page) => {
      if (!creds.naver_id && !creds.naver_pw) return;
      await page.evaluate(({ id, pw }) => {
        const set = (sel, v) => {
          const el = document.querySelector(sel);
          if (el && v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
        };
        set('#id', id); set('#pw', pw);
      }, { id: creds.naver_id || '', pw: creds.naver_pw || '' });
    },
    isDone: async (ctx) => (await ctx.cookies()).some((c) => c.name === 'NID_AUT'),
  });
}

/**
 * 사용자가 평소 쓰는 브라우저에서 네이버에 정상 로그인한 뒤, 개발자도구에서 복사한
 * 로그인 쿠키(NID_AUT / NID_SES)를 계정 프로필에 주입한다 — 자동화 캡차가 아예 없는 방식.
 */
async function importCookies(account, raw = {}) {
  const authVal = String(raw.NID_AUT || raw.nid_aut || '').trim();
  const sesVal = String(raw.NID_SES || raw.nid_ses || '').trim();
  if (!authVal) {
    throw new Error('NID_AUT 쿠키 값이 필요합니다. 네이버에 로그인한 브라우저에서 F12 → Application(애플리케이션) → Cookies → https://www.naver.com → NID_AUT 값을 복사해 붙여넣으세요.');
  }
  // 만료 시각을 명시해야 프로필에 영구 저장된다(미지정 시 세션 쿠키로 취급돼 재실행 시 사라짐).
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30일
  const mk = (name, value) => ({ name, value, domain: '.naver.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires });
  const cookies = [mk('NID_AUT', authVal)];
  if (sesVal) cookies.push(mk('NID_SES', sesVal));
  return browser.setCookies(account, cookies);
}

/**
 * 편집 프레임·상단 페이지·모든 하위 프레임을 훑어 버튼을 찾아 클릭한다.
 * 스마트에디터는 버전마다 버튼 위치(프레임)와 클래스(해시)가 달라, 넓게 탐색해야 안정적이다.
 * @returns {Promise<string>} 클릭에 성공한 셀렉터
 */
async function clickAcross(page, frame, selectors, { timeout = 8000, label = '버튼' } = {}) {
  const scopes = [];
  const seen = new Set();
  for (const s of [frame, page, ...page.frames()]) {
    if (s && !seen.has(s)) { seen.add(s); scopes.push(s); }
  }
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const scope of scopes) {
      for (const sel of selectors) {
        try {
          const loc = scope.locator(sel).first();
          if (await loc.count()) {
            await loc.scrollIntoViewIfNeeded({ timeout: 600 }).catch(() => {});
            await loc.click({ timeout: 1500 });
            return sel;
          }
        } catch { /* 다음 후보/스코프 */ }
      }
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`${label}을(를) 찾지 못했습니다(에디터 UI가 바뀌었을 수 있음). 원고 복사로 수동 발행하거나, 발행 큐에서 다시 시도하세요.`);
}

// 발행 버튼 후보 — 해시 클래스가 바뀌어도 살아남도록 data속성·클래스 부분일치·텍스트·aria를 함께 시도.
const PUBLISH_OPEN_SELECTORS = [
  'button[data-testid="seOnePublishBtn"]',
  'button[data-click-area="tpb.publish"]',
  '[class*="publish_btn"]',
  'button[class*="publish"]',
  'button[aria-label*="발행"]',
  'button:has-text("발행")',
  'a:has-text("발행")',
  '[role="button"]:has-text("발행")',
];
const PUBLISH_CONFIRM_SELECTORS = [
  'button[data-testid="seOnePublishConfirmBtn"]',
  '[data-click-area^="tpb"]',
  '[class*="confirm_btn"]',
  '[class*="btn_ok"]',
  '.layer_btn_area button:has-text("발행")',
  'button:has-text("발행")',
  '[role="button"]:has-text("발행")',
];

/**
 * 발행 실행.
 * @returns {Promise<{url: string}>}
 */
async function publish(account, variant) {
  const creds = credsOf(account);
  if (!creds.naver_id || !creds.naver_pw) {
    throw new Error('네이버 아이디/비밀번호가 등록되지 않았습니다. 계정 · 매칭에서 등록하세요.');
  }
  const extra = (() => { try { return JSON.parse(variant.extra || '{}'); } catch { return {}; } })();
  const imgList = (extra.images || []).map((im) => ({ ...im, local: images.localPathOf(im.file) })).filter((im) => im.local);

  return withAccountPage(account, async (page, ctx) => {
    if (!(await isLoggedIn(ctx))) await login(page, creds);

    // 글쓰기 진입
    await page.goto(`https://blog.naver.com/${encodeURIComponent(creds.naver_id)}?Redirect=Write&`, { waitUntil: 'domcontentloaded' });
    const frame = await editorFrame(page);

    // "작성 중이던 글" 팝업·도움말 패널 정리
    await clickFirst(frame, ['.se-popup-button-cancel', 'button:has-text("취소")'], { optional: true, timeout: 2500 });
    await clickFirst(frame, ['.se-help-panel-close-button', 'button[aria-label="닫기"]'], { optional: true, timeout: 1500 });

    // 제목
    await frame.locator('.se-section-documentTitle, .se-title-text').first().click();
    await frame.locator('body').press('Control+a').catch(() => {});
    await page.keyboard.type(variant.title, { delay: 12 });

    // 본문 — 마커 단위로 나눠 문단 입력 + 이미지 업로드
    await frame.locator('.se-component.se-text .se-text-paragraph').first().click();
    const segments = String(variant.body || '').split(images.MARKER_RE);
    // split 결과: [텍스트, 마커설명, 텍스트, 마커설명, …]
    let imgIdx = 0;
    for (let i = 0; i < segments.length; i++) {
      const isMarkerDesc = i % 2 === 1;
      if (isMarkerDesc) {
        const im = imgList[imgIdx++];
        if (im) {
          try { await insertImage(page, frame, im.local); }
          catch { /* 이미지 1장 실패는 본문 발행을 막지 않는다 */ }
        }
        continue;
      }
      const text = segments[i];
      if (!text.trim()) continue;
      for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (!line) { await page.keyboard.press('Enter'); continue; }
        const quote = line.match(/^>\s?(.+)$/); // "> 인용문" → 인용구 컴포넌트
        if (quote) {
          await insertQuote(page, frame, quote[1].trim());
        } else {
          await page.keyboard.type(line, { delay: 4 });
          await page.keyboard.press('Enter');
        }
      }
    }

    // 태그 입력은 발행 레이어에서 — 발행 버튼(1차, 발행 설정 레이어 열기)
    await clickAcross(page, frame, PUBLISH_OPEN_SELECTORS, { label: '발행 버튼' });
    await page.waitForTimeout(1200);

    // 태그 (해시태그 앞 5개)
    const tags = (extra.hashtags || []).slice(0, 5);
    if (tags.length) {
      const tagInput = frame.locator('#tag-input, input[placeholder*="태그"]').first();
      if (await tagInput.count()) {
        for (const t of tags) {
          await tagInput.fill(String(t).replace(/^#/, ''));
          await page.keyboard.press('Enter');
        }
      }
    }

    // 발행 확정(2차, 레이어의 최종 발행 버튼)
    await clickAcross(page, frame, PUBLISH_CONFIRM_SELECTORS, { label: '발행 확정 버튼' });

    // 게시 완료 → PostView로 이동
    await page.waitForURL(/blog\.naver\.com\/.+\/\d+|PostView/, { timeout: 30000 }).catch(() => {});
    const url = page.url().includes('blog.naver.com') && /\d{6,}/.test(page.url())
      ? page.url()
      : `https://blog.naver.com/${creds.naver_id}`;
    return { url };
  });
}

module.exports = { publish, browserLogin, importCookies };
