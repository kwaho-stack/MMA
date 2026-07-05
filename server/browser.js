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
async function launch() {
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
        headless: true,
        executablePath,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=ko-KR'],
      });
    } catch (e) { lastErr = e; }
  }
  throw new Error(`Chromium 실행 실패: ${lastErr?.message || '알 수 없음'}`);
}

function sessionFile(mediaAccountId) {
  return path.join(SESSION_DIR, `media-${mediaAccountId}.json`);
}

/**
 * 미디어 계정의 저장된 로그인 세션으로 브라우저 컨텍스트를 연다.
 * fn(page, ctx)이 정상 종료되면 세션(쿠키)을 다시 저장한다.
 */
async function withAccountPage(account, fn) {
  const browser = await launch();
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

module.exports = { launch, withAccountPage, clearSession, clickFirst, SESSION_DIR };
