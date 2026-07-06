// 한국어 'AI 느낌' 정량 채점기.
// 원고가 얼마나 AI스러운지 0~100(높을수록 AI스러움)으로 점수화하고 근거를 돌려준다.
// 전부 규칙 기반 — 외부 API 없이 오프라인으로 동작한다.
// 용도: (1) 리라이팅 미리보기·평가 하네스의 자동 채점 (2) 스튜디오의 'AI 느낌' 배지
//       (3) 마스터 자기비평 패스에 넘길 지적 근거.

// ── 사전(한국어 AI 전형 표현) ─────────────────────────────────────────────
// 정형 서두구 — 일반론으로 운을 떼는 전형적 AI 도입
const CLICHE_OPENERS = [
  '현대 사회에서', '현대사회에서', '바쁜 일상 속에서', '바쁜 현대인', '오늘날', '요즘 같은', '요즘같은',
  '많은 분들이', '많은 사람들이', '많은 이들이', '누구나 한 번쯤', '누구나 한번쯤',
  '빼놓을 수 없는', '빼놓을 수 없습니다', '우리 삶에서', '우리 생활에서', '급변하는', '나날이 발전하는',
  '관심이 높아지고 있습니다', '관심이 뜨겁습니다', '화두로 떠오르', '이슈가 되고 있',
];
// 정형 마무리구 — 요약·상투적 인사로 닫는 전형
const CLICHE_CLOSERS = [
  '도움이 되셨길', '도움이 되었길', '도움이 되시길', '도움이 되기를', '도움이 되었으면',
  '알아보았습니다', '살펴보았습니다', '정리해보았습니다', '정리해 보았습니다', '알아봤습니다',
  '지금까지', '이상으로', '마무리하겠습니다', '마치겠습니다', '읽어주셔서 감사',
  '유익한 시간', '행복한 하루', '건강 유의', '다음에 또',
];
// 습관적으로 남발되는 접속·전환어
const CONNECTORS = [
  '또한', '게다가', '뿐만 아니라', '더불어', '아울러', '따라서', '그러므로', '그리하여',
  '즉,', '결론적으로', '종합하면', '종합해보면', '먼저,', '마지막으로', '첫째', '둘째', '셋째', '넷째',
];
// 내용 없는 공허한 형용사·부사(막연한 강조)
const EMPTY_MODIFIERS = [
  '다양한', '효과적인', '효율적인', '중요한', '필수적인', '간편한', '손쉽게', '간단하게',
  '매우', '정말', '굉장히', '너무나', '아주', '완벽한', '최고의', '놀라운', '멋진', '훌륭한',
  '눈길을 끄', '각광받', '주목받',
];
// 근거를 흐리는 일반화 표현
const HEDGES = ['일반적으로', '보통', '대체로', '흔히', '대부분의 경우', '통상적으로', '알려져 있습니다', '라고 할 수 있습니다'];

// ── 유틸 ─────────────────────────────────────────────────────────────────
function countOccurrences(text, phrases) {
  const hits = [];
  for (const p of phrases) {
    let idx = 0;
    while ((idx = text.indexOf(p, idx)) !== -1) { hits.push(p); idx += p.length; }
  }
  return hits;
}

// 마크다운·마커 제거 후 순수 본문
function stripMarkup(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[#>*_`~]/g, ' ')
    .replace(/\[(?:이미지|사진|화면|내부링크|수익링크)[^\]]*\]/g, ' ');
}

// 문장 단위 분리(한국어 종결 + 줄바꿈 기준)
function splitSentences(text) {
  return stripMarkup(text)
    .split(/(?<=[.!?…]|다\.|요\.|죠\.|음\.|함\.)\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
}

function words(text) {
  return stripMarkup(text).split(/\s+/).filter(Boolean);
}

// 리스트 줄 비율(모든 걸 번호·불릿으로 정리하는 강박)
function listRatio(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 0;
  const listLines = lines.filter((l) => /^(?:[-*•]|\d+[.)]|[①-⑳]|[가-힣][.)]\s)/.test(l));
  return listLines.length / lines.length;
}

// 문장 길이 변주도(burstiness) — 변동계수(표준편차/평균). 낮을수록 균일 = AI스러움.
function burstiness(sentences) {
  if (sentences.length < 3) return 1; // 표본 부족 시 중립
  const lens = sentences.map((s) => s.length);
  const mean = lens.reduce((a, b) => a + b, 0) / lens.length;
  if (mean === 0) return 1;
  const variance = lens.reduce((a, b) => a + (b - mean) ** 2, 0) / lens.length;
  return Math.sqrt(variance) / mean; // 변동계수(CV)
}

// 짧은 문장(≤12자) 비율 — 인간 글은 리듬상 짧은 문장을 섞는다.
function shortSentenceRatio(sentences) {
  if (!sentences.length) return 0;
  return sentences.filter((s) => s.replace(/\s/g, '').length <= 12).length / sentences.length;
}

// 구체성 — 수치·단위·날짜·고유명사(라틴/숫자 포함 어절) 밀도
function concreteness(text) {
  const w = words(text);
  if (!w.length) return 0;
  let concrete = 0;
  for (const t of w) {
    if (/\d/.test(t)) concrete++;                                   // 숫자 포함
    else if (/[A-Za-z]/.test(t)) concrete++;                        // 영문(브랜드·서비스명)
    else if (/(원|만원|억|퍼센트|%|㎡|평|kg|km|년|월|일|시|분|위|호|층)/.test(t)) concrete++; // 단위·시점
  }
  return concrete / w.length; // 구체 어절 비율
}

/**
 * 원고 AI 느낌 채점.
 * @param {string} text 본문(마크다운 허용)
 * @returns {{score:number, level:'low'|'mid'|'high', signals:Array, metrics:object}}
 *   score: 0(사람 같음)~100(AI 같음)
 */
function score(text) {
  const raw = String(text || '');
  const sentences = splitSentences(raw);
  const wlen = words(raw).length || 1;
  const per1000 = (n) => (n / wlen) * 1000; // 1000어절당 빈도

  const openers = countOccurrences(raw, CLICHE_OPENERS);
  const closers = countOccurrences(raw, CLICHE_CLOSERS);
  const connectors = countOccurrences(raw, CONNECTORS);
  const modifiers = countOccurrences(raw, EMPTY_MODIFIERS);
  const hedges = countOccurrences(raw, HEDGES);
  const lr = listRatio(raw);
  const cv = burstiness(sentences);
  const shortR = shortSentenceRatio(sentences);
  const conc = concreteness(raw);

  // 각 신호를 0~1 위반도로 환산(1=매우 AI스러움) 후 가중합.
  const signals = [
    { key: 'cliche_opener', label: '정형 서두구', weight: 18,
      viol: Math.min(1, openers.length / 1), hits: [...new Set(openers)],
      detail: openers.length ? `"${[...new Set(openers)].join('", "')}" — 일반론 도입은 AI 전형` : '없음' },
    { key: 'cliche_closer', label: '정형 마무리구', weight: 14,
      viol: Math.min(1, closers.length / 1), hits: [...new Set(closers)],
      detail: closers.length ? `"${[...new Set(closers)].join('", "')}" — 상투적 맺음말` : '없음' },
    { key: 'connectors', label: '접속어 남발', weight: 14,
      viol: Math.min(1, per1000(connectors.length) / 25), hits: [...new Set(connectors)],
      detail: `1000어절당 ${per1000(connectors.length).toFixed(1)}회` },
    { key: 'empty_modifiers', label: '공허한 형용사·부사', weight: 14,
      viol: Math.min(1, per1000(modifiers.length) / 20), hits: [...new Set(modifiers)],
      detail: `1000어절당 ${per1000(modifiers.length).toFixed(1)}회` },
    { key: 'hedges', label: '막연한 일반화', weight: 8,
      viol: Math.min(1, per1000(hedges.length) / 12), hits: [...new Set(hedges)],
      detail: `1000어절당 ${per1000(hedges.length).toFixed(1)}회` },
    { key: 'list_ratio', label: '리스트 강박', weight: 10,
      viol: Math.max(0, Math.min(1, (lr - 0.25) / 0.45)),
      detail: `리스트 줄 비율 ${(lr * 100).toFixed(0)}%` },
    { key: 'burstiness', label: '문장 리듬 단조', weight: 12,
      viol: Math.max(0, Math.min(1, (0.55 - cv) / 0.4)),
      detail: `길이 변동계수 ${cv.toFixed(2)} (낮을수록 균일)` },
    { key: 'short_sentence', label: '짧은 문장 부재', weight: 6,
      viol: Math.max(0, Math.min(1, (0.15 - shortR) / 0.15)),
      detail: `짧은 문장 비율 ${(shortR * 100).toFixed(0)}%` },
    { key: 'concreteness', label: '구체성 부족', weight: 16,
      viol: Math.max(0, Math.min(1, (0.06 - conc) / 0.06)),
      detail: `구체 어절 비율 ${(conc * 100).toFixed(1)}% (수치·고유명사)` },
  ];

  const totalWeight = signals.reduce((a, s) => a + s.weight, 0);
  const raw01 = signals.reduce((a, s) => a + s.weight * s.viol, 0) / totalWeight;
  const finalScore = Math.round(raw01 * 100);
  const level = finalScore >= 55 ? 'high' : finalScore >= 30 ? 'mid' : 'low';

  // 위반도 높은 순으로 정렬(개선 우선순위)
  signals.sort((a, b) => (b.weight * b.viol) - (a.weight * a.viol));

  return {
    score: finalScore,
    level,
    signals,
    metrics: {
      words: wlen, sentences: sentences.length,
      burstiness: Number(cv.toFixed(2)), shortSentenceRatio: Number(shortR.toFixed(2)),
      listRatio: Number(lr.toFixed(2)), concreteness: Number(conc.toFixed(3)),
      openers: openers.length, closers: closers.length,
      connectors: connectors.length, modifiers: modifiers.length, hedges: hedges.length,
    },
  };
}

/** 자기비평 패스에 넘길 지적 텍스트 — 위반 신호를 사람이 읽는 지시로 변환. */
function critiqueNotes(text) {
  const r = score(text);
  const lines = [];
  for (const s of r.signals) {
    if (s.viol < 0.34) continue;
    if (s.hits && s.hits.length) lines.push(`- ${s.label}: ${s.hits.slice(0, 8).map((h) => `"${h}"`).join(', ')} → 삭제하거나 구체적 표현으로 교체`);
    else lines.push(`- ${s.label}: ${s.detail} → 개선 필요`);
  }
  return { score: r.score, level: r.level, notes: lines.join('\n') };
}

module.exports = { score, critiqueNotes, splitSentences };
