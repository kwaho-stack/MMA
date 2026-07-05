// 이미지 엔진 — Google Gemini로 본문 삽화를 생성한다. (API 키 또는 Google 계정 OAuth)
// 리라이팅 원고의 [이미지: 장면 묘사] 마커를 찾아 마커당 1장을 생성하고,
// 파일은 data/uploads/에 저장, 경로는 variant.extra.images에 기록된다.
//   · 브라우저 발행(네이버·티스토리): 마커 위치에 파일을 직접 업로드
//   · API 발행(블로그스팟·워드프레스): public_base_url 기준 <img> 태그로 치환

const fs = require('node:fs');
const path = require('node:path');
const { getSetting } = require('./db');
const gemini = require('./gemini');

const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// [이미지: …] / [사진: …] 마커 — 네이버 프로파일의 기존 표기도 함께 인식한다.
const MARKER_RE = /\[(?:이미지|사진)\s*[::]\s*([^\]\n]{2,200})\]/g;

function enabled() {
  return getSetting('image_gen_enabled') === '1' && gemini.available();
}

function hasKey() {
  return gemini.available();
}

/**
 * Gemini 이미지 생성. PNG를 저장하고 웹 경로('/uploads/…')를 반환한다.
 * @param {string} prompt 장면 묘사
 * @param {{aspect?: string, filename?: string}} opts
 */
async function generateImage(prompt, { aspect = '16:9', filename = null } = {}) {
  if (!gemini.available()) throw new Error('Gemini를 사용할 수 없습니다. 설정에서 Gemini API 키를 등록하거나 Google 계정을 연결하세요.');
  const model = getSetting('gemini_image_model') || 'gemini-2.5-flash-image';

  const styled = [
    '블로그 본문에 어울리는 고품질 삽화를 생성하세요.',
    `장면: ${prompt}`,
    '스타일: 밝고 현대적인 사진 또는 플랫 일러스트. 이미지 안에 글자·워터마크·로고를 넣지 마세요.',
  ].join('\n');

  const call = (withAspect) => gemini.generateContent(model, {
    contents: [{ parts: [{ text: styled }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(withAspect ? { imageConfig: { aspectRatio: aspect } } : {}),
    },
  });

  let data;
  try {
    data = await call(true);
  } catch (e) {
    // 구버전 모델은 imageConfig를 지원하지 않을 수 있음 → 비율 없이 재시도
    if (String(e.message).includes('imageConfig') || String(e.message).includes('aspect')) data = await call(false);
    else throw e;
  }

  const parts = data.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || '이미지 없음';
    throw new Error(`Gemini가 이미지를 반환하지 않았습니다 (${reason}).`);
  }

  const ext = (img.inlineData.mimeType || 'image/png').includes('jpeg') ? 'jpg' : 'png';
  const name = filename || `gen-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(img.inlineData.data, 'base64'));
  return { file: `/uploads/${name}`, mime: img.inlineData.mimeType || 'image/png' };
}

/**
 * 원고 본문의 이미지 마커를 스캔해 삽화를 생성한다(최대 4장).
 * 마커는 본문에 그대로 남겨두고(발행 시점에 치환/업로드), 생성 목록만 반환한다.
 * @returns {Promise<{images: Array<{marker:string, prompt:string, file:string}>}>}
 */
async function prepareBodyImages(body, tag) {
  if (!enabled()) return { images: [] };
  const markers = [...String(body || '').matchAll(MARKER_RE)].slice(0, 4);
  const images = [];
  for (let i = 0; i < markers.length; i++) {
    const [marker, desc] = markers[i];
    const { file } = await generateImage(desc.trim(), {
      aspect: '16:9',
      filename: `inline-${tag}-${i + 1}.png`,
    });
    images.push({ marker, prompt: desc.trim(), file });
  }
  return { images };
}

/** 마커를 <img> 태그(HTML) 또는 빈 문자열로 치환한 본문을 만든다 — API 발행용. */
function bodyWithImageTags(body, images, { html = true } = {}) {
  let out = String(body || '');
  const base = (getSetting('public_base_url') || '').replace(/\/$/, '');
  for (const img of images || []) {
    const tag = html && base
      ? `<img src="${base}${img.file}" alt="${img.prompt.replace(/"/g, '&quot;')}" style="max-width:100%; height:auto;" />`
      : '';
    out = out.replace(img.marker, tag);
  }
  return out.replace(MARKER_RE, ''); // 생성되지 않은 마커는 제거
}

/** 웹 경로('/uploads/…')를 실제 파일 경로로 변환한다 — 브라우저 발행 업로드용. */
function localPathOf(webPath) {
  const name = path.basename(String(webPath || ''));
  const p = path.join(UPLOAD_DIR, name);
  return fs.existsSync(p) ? p : null;
}

module.exports = { enabled, hasKey, generateImage, prepareBodyImages, bodyWithImageTags, localPathOf, MARKER_RE, UPLOAD_DIR };
