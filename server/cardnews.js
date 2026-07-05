// 카드뉴스 렌더러 — 인스타그램 변형(=== 카드 N === 구분)을 1080×1080 PNG 카드로 만든다.
// Playwright로 HTML 템플릿을 스크린샷하므로 별도 이미지 라이브러리가 필요 없다.
// 결과 파일은 data/uploads/cards/에 저장되고 variant.extra.cards에 웹 경로로 기록된다.

const fs = require('node:fs');
const path = require('node:path');
const { getSetting } = require('./db');
const { launch } = require('./browser');

const CARD_DIR = path.join(__dirname, '..', 'data', 'uploads', 'cards');
if (!fs.existsSync(CARD_DIR)) fs.mkdirSync(CARD_DIR, { recursive: true });

/** "=== 카드 N ===" 구분 본문을 카드 배열로 분해. 구분이 없으면 문단 단위로 자른다. */
function splitCards(title, body) {
  const text = String(body || '').trim();
  let parts = text.split(/===\s*카드\s*\d+\s*===/g).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    parts = text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean).slice(0, 7);
  }
  const cards = [{ type: 'cover', text: title }];
  parts.forEach((p, i) => {
    const isLast = i === parts.length - 1;
    const cta = isLast && /(팔로우|저장|공유|댓글|프로필|링크)/.test(p);
    cards.push({ type: cta ? 'cta' : 'body', text: p });
  });
  return cards.slice(0, 10); // 인스타그램 캐러셀 최대 10장
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cardHTML(card, index, total, { accent, brand }) {
  const num = index === 0 ? '' : `${index}/${total - 1}`;
  const isCover = card.type === 'cover';
  const isCta = card.type === 'cta';
  const paras = card.text.split(/\n+/).map((l) => `<p>${esc(l)}</p>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html,body { width:1080px; height:1080px; }
    body {
      font-family: 'Pretendard', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif;
      background:
        radial-gradient(900px 700px at 85% -10%, ${accent}33, transparent 60%),
        radial-gradient(700px 600px at -10% 110%, ${accent}22, transparent 55%),
        linear-gradient(160deg, #101319 0%, #171b24 100%);
      color:#eef1f6; display:flex; flex-direction:column; padding:88px;
    }
    .top { display:flex; justify-content:space-between; align-items:center; font-size:26px; color:#9aa3b2; }
    .chip { display:inline-flex; align-items:center; gap:12px; font-weight:700; letter-spacing:.4px; }
    .chip .dot { width:18px; height:18px; border-radius:50%; background:${accent}; box-shadow:0 0 22px ${accent}aa; }
    .num { font-variant-numeric:tabular-nums; }
    .mid { flex:1; display:flex; flex-direction:column; justify-content:center; gap:34px; }
    .cover-title { font-size:${card.text.length > 40 ? 72 : 86}px; font-weight:800; line-height:1.28; word-break:keep-all; }
    .cover-bar { width:120px; height:10px; border-radius:6px; background:${accent}; }
    .body-text p { font-size:46px; font-weight:600; line-height:1.55; word-break:keep-all; margin-bottom:26px; color:#e6eaf1; }
    .cta p { font-size:50px; font-weight:800; line-height:1.5; word-break:keep-all; margin-bottom:26px;
             background:linear-gradient(90deg, ${accent}, #8ab8ff); -webkit-background-clip:text; background-clip:text; color:transparent; }
    .bot { display:flex; justify-content:space-between; align-items:center; font-size:26px; color:#788093; }
    .swipe { color:${accent}; font-weight:700; }
  </style></head><body>
    <div class="top"><span class="chip"><span class="dot"></span>${esc(brand)}</span><span class="num">${num}</span></div>
    <div class="mid">
      ${isCover
        ? `<div class="cover-bar"></div><div class="cover-title">${esc(card.text)}</div>`
        : `<div class="${isCta ? 'cta' : 'body-text'}">${paras}</div>`}
    </div>
    <div class="bot"><span>${esc(brand)}</span>${index < total - 1 ? '<span class="swipe">밀어서 계속 →</span>' : '<span class="swipe">저장·팔로우 ♥</span>'}</div>
  </body></html>`;
}

/**
 * 인스타그램 변형을 카드뉴스 PNG 세트로 렌더링한다.
 * @returns {Promise<string[]>} 웹 경로 목록 ['/uploads/cards/…', …]
 */
async function buildForVariant({ title, body }, { accent = '#3987e5', tag }) {
  const brand = getSetting('cardnews_brand') || '@mediadot';
  const cards = splitCards(title, body);
  const browser = await launch();
  const files = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 } });
    for (let i = 0; i < cards.length; i++) {
      await page.setContent(cardHTML(cards[i], i, cards.length, { accent, brand }), { waitUntil: 'load' });
      const name = `card-${tag}-${String(i + 1).padStart(2, '0')}.png`;
      await page.screenshot({ path: path.join(CARD_DIR, name), type: 'png' });
      files.push(`/uploads/cards/${name}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  return files;
}

/** 웹 경로를 실제 파일 경로로 (다운로드·검증용) */
function localPathOf(webPath) {
  const name = path.basename(String(webPath || ''));
  const p = path.join(CARD_DIR, name);
  return fs.existsSync(p) ? p : null;
}

module.exports = { buildForVariant, splitCards, localPathOf, CARD_DIR };
