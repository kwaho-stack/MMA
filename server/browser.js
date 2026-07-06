// 공용 브라우저 헬퍼 — Playwright Chromium 실행과 계정별 로그인 세션 관리.
// 카드뉴스 렌더링과 네이버·티스토리 브라우저 자동 발행이 함께 사용한다.
//
// 캡차 회피: 계정별 "영구 프로필"(launchPersistentContext)을 쓰고 자동화 흔적을 지운다.
//  - navigator.webdriver 제거, --disable-blink-features=AutomationControlled 등 stealth 옵션
//  - 실제 Chrome 채널을 우선 사용(번들 크로미움보다 캡차를 훨씬 적게 유발)
//  - 로그인 창(headful)과 발행(headless)이 같은 프로필을 공유 → 네이버가 "기억된 기기"로 인식

const fs = require('node:fs');
const path = require('node:path');

const SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

const PROFILE_ROOT = path.join(__dirname, '..', 'data', 'profiles');
if (!fs.existsSync(PROFILE_ROOT)) fs.mkdirSync(PROFILE_ROOT, { recursive: true });
function profileDir(mediaAccountId) {
  return path.join(PROFILE_ROOT, `media-${mediaAccountId}`);
}

let chromiumMod = null;
function chromium() {
  if (!chromiumMod) {
    try {
      chromiumMod = require('playwright').chromium;
    } catch {
      throw new Error('playwright가 설치되지 않았습니다. `npm install` 후 다시 시도하세요.');
    }
  }
  return chromiumMod;
}

/** Chromium 실행 — 기본 탐색 실패 시 흔한 설치 경로로 폴백한다. */
async function launch({ headless = true } = {}) {
  const candidates = [
    undefined, // playwright 기본 탐색 (PLAYWRIGHT_BROWSERS_PATH 포함)
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
  ].filter((p, i) => i === 0 || (p && fs.existsSync(p)));

  let lastErr = null;
  for (const executablePath of candidates) {
    try {
      return await chromium().launch({
        headless,
        executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR'],
      });
    } catch (e) { lastErr = e; }
  }
  // 브라우저 실행 파일이 없는 경우가 가장 흔하다 — npm install만으로는 브라우저가 안 받아진다.
  const msg = String(lastErr?.message || '');
  if (/Executable doesn'?t exist|please run the following command|install/i.test(msg)) {
    throw new Error('브라우저(크로미움)가 설치되지 않았습니다. 서버가 있는 곳에서 `npx playwright install chromium` 을 한 번 실행한 뒤 다시 시도하세요. (네이버·티스토리 자동 발행에 필요)');
  }
  throw new Error(`크로미움 실행 실패: ${msg || '알 수 없음'}`);
}

/** 브라우저 자동 발행 사용 가능 여부 — 프리플라이트 점검용. */
async function isAvailable() {
  try {
    const b = await launch();
    await b.close().catch(() => {});
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e.message || e) };
  }
}

/** 브라우저를 실행하지 않고 실행 파일 존재만 빠르게 확인한다(프리플라이트 GET용). */
function binaryReady() {
  const known = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', process.env.CHROME_PATH]
    .filter(Boolean);
  if (known.some((p) => fs.existsSync(p))) return true;
  try {
    const p = chromium().executablePath();
    return Boolean(p && fs.existsSync(p));
  } catch {
    return false;
  }
}

function sessionFile(mediaAccountId) {
  return path.join(SESSION_DIR, `media-${mediaAccountId}.json`);
}

/**
 * 계정별 영구 프로필로 stealth 브라우저 컨텍스트를 연다.
 * 실제 Chrome 채널을 우선 시도하고(캡차 최소화), 없으면 번들 크로미움으로 폴백한다.
 */
async function openAccountContext(account, { headless = true } = {}) {
  const dir = profileDir(account.id);
  fs.mkdirSync(dir, { recursive: true });

  const common = {
    headless,
    viewport: { width: 1440, height: 960 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR', '--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  };
  // 실제 Chrome 채널이 자동화 탐지·캡차를 가장 적게 유발 → 우선, 그다음 번들 크로미움 경로.
  const launchers = [
    { channel: 'chrome' },
    ...[undefined, process.env.CHROME_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
      .filter((p, i) => i === 0 || (p && fs.existsSync(p)))
      .map((executablePath) => ({ executablePath })),
  ];

  let lastErr = null;
  for (const opt of launchers) {
    try {
      const ctx = await chromium().launchPersistentContext(dir, { ...common, ...opt });
      ctx.setDefaultTimeout(25000);
      // 자동화 흔적 제거 — 네이버 등은 navigator.webdriver로 봇을 판별해 캡차를 띄운다.
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko'] });
      });
      return ctx;
    } catch (e) { lastErr = e; }
  }
  const msg = String(lastErr?.message || '');
  if (/Executable doesn'?t exist|please run the following command|install/i.test(msg)) {
    throw new Error('브라우저(크로미움)가 설치되지 않았습니다. 서버가 있는 곳에서 `npx playwright install chromium` 을 한 번 실행한 뒤 다시 시도하세요. (네이버·티스토리 자동 발행에 필요)');
  }
  throw new Error(`브라우저 실행 실패: ${msg || '알 수 없음'}`);
}

/**
 * 미디어 계정의 영구 프로필로 페이지를 연다. 세션(쿠키·로컬스토리지)은 프로필에 자동 저장된다.
 * 종료 직전, 네이버 등이 발행 때마다 교체(rotate)하는 세션 쿠키에 만료 시각을 부여해 유지한다
 * — 그래야 한 번 로그인으로 세션이 계속 살아 있고, 매번 쿠키를 다시 넣지 않아도 된다.
 */
async function withAccountPage(account, fn, { headless = true } = {}) {
  const ctx = await openAccountContext(account, { headless });
  const page = ctx.pages()[0] || await ctx.newPage();
  try {
    return await fn(page, ctx);
  } finally {
    await persistSessionCookies(ctx);
    await ctx.close().catch(() => { /* 프로필은 종료 시 자동 저장됨 */ });
  }
}

/** 외부(사용자 실브라우저)에서 복사한 로그인 쿠키를 계정 프로필에 주입한다 — 캡차 없는 프론트 방식. */
async function setCookies(account, cookies) {
  if (!cookies || !cookies.length) throw new Error('주입할 쿠키가 없습니다.');
  return withAccountPage(account, async (page, ctx) => {
    await ctx.addCookies(cookies);
    return { ok: true, count: cookies.length };
  }, { headless: true });
}

/** 저장된 로그인 세션 삭제(재로그인 유도) — 영구 프로필과 구 세션 파일 모두 제거. */
function clearSession(mediaAccountId) {
  const f = sessionFile(mediaAccountId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
  const dir = profileDir(mediaAccountId);
  if (fs.existsSync(dir)) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 사용 중이면 다음에 정리 */ } }
}

/**
 * 화면이 보이는(headful) 브라우저 창을 띄워 사용자가 직접 로그인하게 한다.
 * 캡차·2단계 인증처럼 자동화가 막히는 관문을 사람이 직접 통과하고,
 * 로그인이 확인되면(isDone) 세션(쿠키)을 저장해 이후 자동 발행이 재사용한다.
 *
 * @param {object} account 미디어 계정
 * @param {object} opts
 * @param {string} opts.startUrl 로그인 페이지 URL
 * @param {(ctx)=>Promise<boolean>} opts.isDone 로그인 완료 판정(쿠키 기반, 페이지 이동 없이)
 * @param {(page)=>Promise<void>} [opts.prefill] 아이디/비밀번호 자동 채우기(선택)
 * @param {number} [opts.timeoutMs=180000] 로그인 대기 제한 시간
 */
async function openLoginWindow(account, { startUrl, isDone, prefill, timeoutMs = 240000 }) {
  return withAccountPage(account, async (page, ctx) => {
    if (await isDone(ctx).catch(() => false)) { await persistSessionCookies(ctx); return { ok: true, already: true }; }
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    if (prefill) await prefill(page).catch(() => { /* 자동 채우기 실패는 무시 — 사용자가 직접 입력 */ });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isDone(ctx).catch(() => false)) { await persistSessionCookies(ctx); return { ok: true }; }
      await page.waitForTimeout(1500);
    }
    throw new Error('로그인 완료를 확인하지 못했습니다(제한 시간 초과). 열린 창에서 로그인·캡차를 마친 뒤 다시 시도하세요.');
  }, { headless: false });
}

/**
 * 로그인 성공 후, 만료 없는 세션 쿠키에 만료 시각을 부여해 프로필에 영구 저장되게 한다.
 * (persistent 프로필도 세션 쿠키는 다음 실행에서 사라지므로, 발행 때 재사용되도록 고정한다.)
 */
async function persistSessionCookies(ctx) {
  try {
    const cookies = await ctx.cookies();
    const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30; // 30일
    const fixed = cookies
      .filter((c) => !c.expires || c.expires < 0)
      .map((c) => ({ ...c, expires: exp }));
    if (fixed.length) await ctx.addCookies(fixed);
  } catch { /* 쿠키 고정 실패는 치명적이지 않음 */ }
}

/** 여러 후보 셀렉터 중 먼저 나타나는 것을 클릭한다. */
async function clickFirst(scope, selectors, { timeout = 4000, optional = false } = {}) {
  for (const sel of selectors) {
    try {
      const loc = scope.locator(sel).first();
      await loc.waitFor({ state: 'visible', timeout });
      await loc.click();
      return sel;
    } catch { /* 다음 후보 */ }
  }
  if (optional) return null;
  throw new Error(`클릭할 요소를 찾지 못했습니다: ${selectors.join(' | ')}`);
}

module.exports = { launch, withAccountPage, openAccountContext, openLoginWindow, setCookies, clearSession, clickFirst, isAvailable, binaryReady, SESSION_DIR };
