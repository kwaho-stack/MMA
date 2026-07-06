// 티스토리 브라우저 자동 발행 — Open API가 2024년 종료되어 Playwright로 새 에디터를 직접 조작한다.
// 카카오 계정 로그인 세션은 data/sessions/에 저장되어 재사용된다.
//
// 흐름: 카카오 로그인 → {blog}.tistory.com/manage/newpost 진입 → 제목 입력
//       → 본문(TinyMCE iframe) 문단 입력 + [이미지: …] 마커 위치에 파일 업로드
//       → 발행 레이어에서 공개 발행 → 게시 URL 회수
// 2단계 인증이 뜨면 자동화를 중단하고 안내와 함께 수동 발행으로 전환된다.

const { withAccountPage, clickFirst, openLoginWindow } = require('../browser');
const images = require('../images');

function credsOf(account) {
  try { return JSON.parse(account.credentials || '{}'); } catch { return {}; }
}

/**
 * 사용자가 직접 로그인할 수 있도록 화면이 보이는(headful) 카카오 로그인 창을 띄운다.
 * 2단계 인증·캡차는 사용자가 직접 처리하고, TSSESSION 쿠키가 확인되면 세션을 저장한다.
 */
async function browserLogin(account) {
  const creds = credsOf(account);
  return openLoginWindow(account, {
    startUrl: 'https://www.tistory.com/auth/login',
    prefill: async (page) => {
      // 카카오 로그인 버튼까지만 눌러 로그인 폼을 띄운다(자격증명 입력은 사용자가).
      await clickFirst(page, ['.btn_login.link_kakao_id', 'a:has-text("카카오계정으로 로그인")', '.link_kakao_id'], { optional: true, timeout: 3000 });
      await page.waitForTimeout(1200);
      if (creds.kakao_email) {
        await page.locator('input[name="loginId"], input[type="email"]').first().fill(creds.kakao_email).catch(() => {});
      }
    },
    isDone: async (ctx) => (await ctx.cookies()).some((c) => c.name === 'TSSESSION'),
  });
}

async function isLoggedIn(page) {
  await page.goto('https://www.tistory.com/', { waitUntil: 'domcontentloaded' });
  return page.evaluate(() => document.cookie.includes('TSSESSION'));
}

async function login(page, creds) {
  await page.goto('https://www.tistory.com/auth/login', { waitUntil: 'domcontentloaded' });
  await clickFirst(page, ['.btn_login.link_kakao_id', 'a:has-text("카카오계정으로 로그인")', '.link_kakao_id']);
  await page.waitForURL(/accounts\.kakao\.com/, { timeout: 15000 });

  await page.locator('input[name="loginId"], input[type="email"]').first().fill(creds.kakao_email);
  await page.locator('input[name="password"], input[type="password"]').first().fill(creds.kakao_pw);
  await clickFirst(page, ['button[type="submit"]', '.btn_g.highlight', 'button:has-text("로그인")']);
  await page.waitForTimeout(2500);

  const url = page.url();
  if (url.includes('accounts.kakao.com')) {
    if (await page.locator('text=2단계 인증, text=추가 인증, .two_step').count()) {
      throw new Error('카카오 2단계 인증이 필요합니다. 휴대폰에서 인증을 승인한 뒤 다시 시도하거나, 카카오 계정 설정에서 2단계 인증 예외를 확인하세요.');
    }
    const msg = await page.locator('.error_msg, .desc_error, p[class*="error"]').first().textContent().catch(() => '');
    throw new Error(`카카오 로그인 실패${msg ? ` — ${msg.trim()}` : ''}. 이메일/비밀번호를 확인하세요.`);
  }
  await page.waitForURL(/tistory\.com/, { timeout: 15000 }).catch(() => {});
}

/** TinyMCE 본문 iframe 확보 */
async function bodyFrame(page) {
  for (let i = 0; i < 20; i++) {
    for (const f of page.frames()) {
      try {
        if (f.url().includes('editor') || (await f.locator('body#tinymce, body.mce-content-body').count())) return f;
      } catch { /* 프레임 교체 중 */ }
    }
    await page.waitForTimeout(500);
  }
  throw new Error('티스토리 에디터 로딩에 실패했습니다.');
}

async function insertImage(page, filePath) {
  // 에디터의 숨은 파일 입력에 직접 주입 — 커서 위치에 업로드·삽입된다.
  const direct = page.locator('#attach-image, input[type="file"][accept*="image"]').first();
  if (await direct.count()) {
    await direct.setInputFiles(filePath);
  } else {
    const chooser = page.waitForEvent('filechooser', { timeout: 8000 });
    await clickFirst(page, ['#mceu_0 button', 'button[aria-label*="사진"]', 'button:has-text("사진")']);
    const fc = await chooser;
    await fc.setFiles(filePath);
  }
  await page.waitForTimeout(2500); // 업로드 완료 대기
}

/**
 * 발행 실행.
 * @returns {Promise<{url: string}>}
 */
async function publish(account, variant) {
  const creds = credsOf(account);
  if (!creds.kakao_email || !creds.kakao_pw || !creds.blog_name) {
    throw new Error('카카오 계정과 블로그 이름(xxx.tistory.com의 xxx)이 등록되지 않았습니다. 계정 · 매칭에서 등록하세요.');
  }
  const extra = (() => { try { return JSON.parse(variant.extra || '{}'); } catch { return {}; } })();
  const imgList = (extra.images || []).map((im) => ({ ...im, local: images.localPathOf(im.file) })).filter((im) => im.local);
  const blogHost = `${creds.blog_name}.tistory.com`;

  return withAccountPage(account, async (page) => {
    // "저장된 글이 있습니다" 등 confirm 대화상자는 새로 쓰기로 무시
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    if (!(await isLoggedIn(page))) await login(page, creds);

    await page.goto(`https://${blogHost}/manage/newpost/?type=post`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    if (page.url().includes('auth/login') || page.url().includes('accounts.kakao.com')) {
      await login(page, creds);
      await page.goto(`https://${blogHost}/manage/newpost/?type=post`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);
    }

    // 제목
    const titleInput = page.locator('#post-title-inp, textarea[placeholder*="제목"], input[placeholder*="제목"]').first();
    await titleInput.waitFor({ state: 'visible', timeout: 15000 });
    await titleInput.fill(variant.title);

    // 본문 — HTML은 태그 없이 텍스트로 정리해서 입력(기본모드), 마커 위치에 이미지 업로드
    const frame = await bodyFrame(page);
    await frame.locator('body').click();
    const plain = String(variant.body || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

    const segments = plain.split(images.MARKER_RE); // [텍스트, 마커설명, 텍스트, …]
    let imgIdx = 0;
    for (let i = 0; i < segments.length; i++) {
      if (i % 2 === 1) {
        const im = imgList[imgIdx++];
        if (im) {
          try { await insertImage(page, im.local); }
          catch { /* 이미지 1장 실패는 본문 발행을 막지 않는다 */ }
          await frame.locator('body').click().catch(() => {});
          await page.keyboard.press('Control+End').catch(() => {});
        }
        continue;
      }
      const text = segments[i].trim();
      if (!text) continue;
      for (const line of text.split('\n')) {
        if (line.trim()) await page.keyboard.type(line, { delay: 3 });
        await page.keyboard.press('Enter');
      }
    }

    // 태그
    const tags = (extra.hashtags || []).slice(0, 8);
    const tagInput = page.locator('#tagText, input[placeholder*="태그"]').first();
    if (tags.length && (await tagInput.count())) {
      for (const t of tags) {
        await tagInput.fill(String(t).replace(/^#/, ''));
        await page.keyboard.press('Enter');
      }
    }

    // 발행 레이어 열기 → 공개 → 발행
    await clickFirst(page, ['#publish-layer-btn', 'button:has-text("완료")', 'button:has-text("발행")']);
    await page.waitForTimeout(800);
    await clickFirst(page, ['#open20', 'input[value="20"]', 'label:has-text("공개")'], { optional: true, timeout: 2500 });
    await clickFirst(page, ['#publish-btn', 'button:has-text("공개 발행")', 'button:has-text("발행")']);

    // 발행 후 관리 목록으로 이동 → 최신 글 URL 회수
    await page.waitForURL(/manage\/post|tistory\.com/, { timeout: 30000 }).catch(() => {});
    let url = `https://${blogHost}/`;
    try {
      const res = await page.request.get(`https://${blogHost}/rss`);
      const xml = await res.text();
      const m = xml.match(/<item>[\s\S]*?<link>([^<]+)<\/link>/);
      if (m) url = m[1].trim();
    } catch { /* RSS 조회 실패 시 블로그 홈 URL */ }
    return { url };
  });
}

module.exports = { publish, browserLogin };
