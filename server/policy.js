// 광고 정책 리스크 검사 — 자동발행 콘텐츠가 애드센스/애드포스트 등에서
// 게재 제한·저품질 판정을 받아 수익이 막히는 것을 사전에 걸러낸다.
// 발행을 막는 검열이 아니라, 정책 위반 표현을 발행 전에 고치게 하는 안전장치.
// 검출 시: 위반 단어 + 대체 표현 제안 + 전후 문맥을 함께 돌려줘 바로 고칠 수 있게 한다.
// high 위험은 완전 자동 모드라도 승인 대기로 강제 전환된다(pipeline.js).

const RULES = [
  {
    category: '의료·건강 과장',
    level: 'high',
    words: {
      '완치': '증상 완화에 도움을 줄 수 있다',
      '만병통치': '여러 상황에서 활용된다',
      '부작용 없음': '일반적으로 부담이 적은 편이다',
      '즉효': '비교적 빠른 변화를 기대할 수 있다',
      '특효약': '도움이 되는 방법 중 하나',
      '암 예방 효과': '건강 관리에 참고할 수 있다',
      '100% 치료': '개선 사례가 보고되어 있다',
      '살이 빠진다': '체중 관리에 도움이 될 수 있다',
      '다이어트 보장': '꾸준히 하면 도움이 될 수 있다',
    },
    advice: '의학적 효능 단정은 애드센스 의료 정책 위반 소지 — 가능성 표현으로 완화하세요.',
  },
  {
    category: '금융 과장·투자 권유',
    level: 'high',
    words: {
      '원금 보장': '원금 손실 가능성을 확인하세요',
      '확정 수익': '기대 수익 (변동 가능)',
      '무조건 수익': '수익을 기대할 수 있는 (손실 위험 있음)',
      '100% 수익': '과거 수익 사례 (미래 보장 아님)',
      '절대 손해': '상대적으로 위험이 낮은',
      '월 천만원 보장': '수익 사례 소개 (개인차 있음)',
      '무조건 오른다': '상승 가능성이 언급되는',
      '전재산 투자': '여유 자금 내에서 검토',
    },
    advice: '수익 보장 표현은 금융 광고 정책 위반 — 수치는 출처와 함께, 보장 표현은 삭제하세요.',
  },
  {
    category: '성인·유해',
    level: 'high',
    words: { '성인용품': null, '19금': null, '유흥업소': null, '조건만남': null },
    advice: '성인 콘텐츠는 대부분의 광고 네트워크에서 게재 불가 — 주제 자체를 변경하세요.',
  },
  {
    category: '사행성',
    level: 'high',
    words: { '도박': null, '카지노 사이트': null, '토토': null, '배팅 사이트': null, '먹튀': null, '홀덤': null },
    advice: '사행성 키워드는 애드센스 게재 제한 + 네이버 저품질 요인 — 주제 자체를 변경하세요.',
  },
  {
    category: '과장 광고 문구 (클릭베이트)',
    level: 'medium',
    words: {
      '무조건': '대부분의 경우',
      '절대로': '가급적',
      '유일한 방법': '효과적인 방법 중 하나',
      '지금 당장 사세요': '필요하다면 살펴보세요',
      '안 사면 손해': '가격 대비 만족도가 높은 편',
      '충격적인': '눈에 띄는',
      '경악': '놀라움',
      '반드시 해야': '해두면 좋은',
      '모르면 손해': '알아두면 유용한',
    },
    advice: '클릭베이트성 과장은 저품질 판정 요인 — 근거 있는 표현으로 바꾸세요.',
  },
  {
    category: '저작권·출처 주의',
    level: 'medium',
    words: { '퍼옴': '출처를 명시해 인용', '무단 전재': null, '출처 없음': '출처 확인 후 표기' },
    advice: '출처 불명 인용은 저작권 신고 및 저품질 요인.',
  },
  {
    category: '대가성 표기 필요',
    level: 'low',
    words: { '쿠팡 파트너스': null, '제휴 링크': null, '파트너스 활동': null },
    advice: '제휴 링크 포함 시 "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다" 문구가 본문에 있는지 확인하세요.',
  },
];

const LEVEL_ORDER = { low: 1, medium: 2, high: 3 };

/** 위반 단어의 전후 문맥(±28자)을 잘라 하이라이트용 스니펫을 만든다. */
function contextOf(text, word) {
  const idx = text.indexOf(word);
  if (idx < 0) return '';
  const start = Math.max(0, idx - 28);
  const end = Math.min(text.length, idx + word.length + 28);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\n/g, ' ')}${end < text.length ? '…' : ''}`;
}

/**
 * @returns {{level:'ok'|'low'|'medium'|'high', hits:Array<{word, category, level, advice, suggestion, context}>}}
 */
function checkPolicy(text) {
  const hits = [];
  const t = String(text || '');
  for (const rule of RULES) {
    for (const [word, suggestion] of Object.entries(rule.words)) {
      if (t.includes(word)) {
        hits.push({
          word,
          category: rule.category,
          level: rule.level,
          advice: rule.advice,
          suggestion: suggestion || null,
          context: contextOf(t, word),
        });
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
