// 광고 정책 리스크 검사 — 자동발행 콘텐츠가 애드센스/애드포스트 등에서
// 게재 제한·저품질 판정을 받아 수익이 막히는 것을 사전에 걸러낸다.
// 발행을 막는 검열이 아니라, 정책 위반 표현을 발행 전에 고치게 하는 안전장치.

const RULES = [
  {
    category: '의료·건강 과장',
    level: 'high',
    words: ['완치', '만병통치', '부작용 없음', '즉효', '특효약', '암 예방 효과', '100% 치료'],
    advice: '의학적 효능 단정 표현은 애드센스 의료 정책 위반 소지. "도움이 될 수 있다" 수준으로 완화하세요.',
  },
  {
    category: '금융 과장·투자 권유',
    level: 'high',
    words: ['원금 보장', '확정 수익', '무조건 수익', '100% 수익', '절대 손해', '월 천만원 보장'],
    advice: '수익 보장 표현은 금융 광고 정책 위반. 수치는 출처와 함께, 보장 표현은 삭제하세요.',
  },
  {
    category: '성인·유해',
    level: 'high',
    words: ['성인용품', '19금', '유흥업소', '조건만남'],
    advice: '성인 콘텐츠는 대부분의 광고 네트워크에서 게재 불가.',
  },
  {
    category: '사행성',
    level: 'high',
    words: ['도박', '카지노 사이트', '토토', '배팅 사이트', '먹튀'],
    advice: '사행성 키워드는 애드센스 게재 제한 + 네이버 저품질 요인.',
  },
  {
    category: '과장 광고 문구',
    level: 'medium',
    words: ['무조건', '절대로', '유일한 방법', '지금 당장 사세요', '안 사면 손해', '충격적인'],
    advice: '클릭베이트성 과장 문구는 저품질 판정 요인. 근거 있는 표현으로 바꾸세요.',
  },
  {
    category: '저작권·출처 주의',
    level: 'medium',
    words: ['퍼옴', '무단 전재', '출처 없음'],
    advice: '출처 불명 인용은 저작권 신고 및 저품질 요인.',
  },
  {
    category: '대가성 표기 필요',
    level: 'low',
    words: ['쿠팡 파트너스', '제휴 링크', '파트너스 활동'],
    advice: '제휴 링크 포함 시 "이 포스팅은 쿠팡 파트너스 활동의 일환으로 수수료를 제공받을 수 있습니다" 문구가 있는지 확인하세요.',
  },
];

const LEVEL_ORDER = { low: 1, medium: 2, high: 3 };

function checkPolicy(text) {
  const hits = [];
  const t = String(text || '');
  for (const rule of RULES) {
    for (const word of rule.words) {
      if (t.includes(word)) {
        hits.push({ word, category: rule.category, level: rule.level, advice: rule.advice });
      }
    }
  }
  let level = 'ok';
  for (const h of hits) {
    if (level === 'ok' || LEVEL_ORDER[h.level] > (LEVEL_ORDER[level] || 0)) level = h.level;
  }
  return { level, hits };
}

module.exports = { checkPolicy };
