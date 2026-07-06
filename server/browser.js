// 공용 브라우저 헬퍼 — Playwright Chromium 실행과 계정별 로그인 세션 관리.
// 카드뉴스 렌더링과 네이버·티스토리 브라우저 자동 발행이 함께 사용한다.

const fs = require('node:fs');
const path = require('node:path');

const SESSION_DIR = path.join(__dirname, '..', 'data', 'sessions');
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

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
 * 미디어 계정의 저장된 로그인 세션으로 브라우저 컨텍스트를 연다.
 * fn(page, ctx)이 정상 종료되면 세션(쿠키)을 다시 저장한다.
 */
async function withAccountPage(account, fn, { headless = true } = {}) {
  const browser = await launch({ headless });
  const stateFile = sessionFile(account.id);
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    ...(fs.existsSync(stateFile) ? { storageState: stateFile } : {}),
  });
  ctx.setDefaultTimeout(25000);
  const page = await ctx.newPage();
  try {
    const result = await fn(page, ctx);
    try { await ctx.storageState({ path: stateFile }); } catch { /* 세션 저장 실패는 치명적이지 않음 */ }
    return result;
  } finally {
    await browser.close().catch(() => {});
  }
}

/** 저장된 로그인 세션 삭제(재로그인 유도) */
function clearSession(mediaAccountId) {
  const f = sessionFile(mediaAccountId);
  if (fs.existsSync(f)) fs.unlinkSync(f);
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
async function openLoginWindow(account, { startUrl, isDone, prefill, timeoutMs = 180000 }) {
  return withAccountPage(account, async (page, ctx) => {
    if (await isDone(ctx).catch(() => false)) return { ok: true, already: true };
    await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    if (prefill) await prefill(page).catch(() => { /* 자동 채우기 실패는 무시 — 사용자가 직접 입력 */ });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await isDone(ctx).catch(() => false)) return { ok: true };
      await page.waitForTimeout(1500);
    }
    throw new Error('로그인 완료를 확인하지 못했습니다(제한 시간 초과). 열린 창에서 로그인·캡차를 마친 뒤 다시 시도하세요.');
  }, { headless: false });
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

module.exports = { launch, withAccountPage, openLoginWindow, clearSession, clickFirst, isAvailable, binaryReady, SESSION_DIR };
