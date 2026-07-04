// LLM 콘텐츠 엔진 — Anthropic Claude API.
// ANTHROPIC_API_KEY(환경변수) 또는 설정 화면의 API 키를 사용한다.
// 키가 없으면 템플릿 기반 데모 생성으로 폴백해 전체 파이프라인을 확인할 수 있다(데모 표시됨).

const Anthropic = require('@anthropic-ai/sdk');
const { getSetting } = require('./db');

function getClient() {
  const key = getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

function model() {
  return getSetting('llm_model') || 'claude-opus-4-8';
}

async function jsonRequest({ system, prompt, schema, maxTokens = 16000 }) {
  const client = getClient();
  if (!client) return null;
  const response = await client.messages.create({
    model: model(),
    max_tokens: maxTokens,
    thinking: { type: 'adaptive' },
    system,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema } },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('LLM이 요청을 거절했습니다. 주제를 바꿔 다시 시도하세요.');
  }
  const text = response.content.find((b) => b.type === 'text')?.text || '{}';
  return JSON.parse(text);
}

// ---------- 주제 발굴 ----------

const TOPIC_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          keywords: { type: 'string' },
          angle: { type: 'string' },
        },
        required: ['title', 'keywords', 'angle'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

async function generateTopics(category, count = 5) {
  const result = await jsonRequest({
    system: '당신은 한국 콘텐츠 수익화 전문 에디터입니다. 검색 수요가 있고 광고 수익(애드센스·애드포스트·제휴 마케팅)으로 이어지기 좋은 주제를 발굴합니다.',
    prompt: [
      `카테고리: ${category.name}`,
      category.description ? `카테고리 설명: ${category.description}` : '',
      '',
      `이 카테고리에 맞는 콘텐츠 주제 ${count}개를 제안하세요.`,
      '- 검색량이 꾸준하거나 상승 중일 법한 주제',
      '- 광고 정책 위반 소지(의료·금융 과장, 성인, 사행성)가 없는 주제',
      '- keywords는 핵심 검색 키워드 3~5개(콤마 구분)',
      '- angle은 남들과 다르게 다룰 관점 한 줄',
    ].filter(Boolean).join('\n'),
    schema: TOPIC_SCHEMA,
    maxTokens: 4096,
  });
  if (result) return result.topics;

  // 데모 폴백
  const seeds = ['초보자가 가장 많이 묻는 질문 총정리', '2026년 달라지는 것들', '전문가는 절대 안 하는 실수 5가지', '한 달 직접 해보고 알게 된 것', '무료로 시작하는 방법'];
  return seeds.slice(0, count).map((s, i) => ({
    title: `[데모] ${category.name} — ${s}`,
    keywords: `${category.name}, 정보, 팁`,
    angle: '데모 주제입니다. 설정에서 Anthropic API 키를 등록하면 실제 주제가 생성됩니다.',
    _demo: true,
  }));
}

// ---------- 마스터 원고 생성 ----------

const MASTER_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    body: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'body', 'tags'],
  additionalProperties: false,
};

async function generateMaster(topic, category) {
  const result = await jsonRequest({
    system: [
      '당신은 한국어 콘텐츠 전문 작가입니다. 검색 유입과 광고 수익을 목표로 하는 정보성 원고를 씁니다.',
      '원칙:',
      '- 사실에 근거하고, 확인 불가한 수치·효능은 단정하지 않는다.',
      '- 의료·금융 과장 표현, 수익 보장 표현, 클릭베이트를 쓰지 않는다(광고 게재 제한 방지).',
      '- 독자가 끝까지 읽게 만드는 구조(문제 제기 → 해결 → 실행 팁)로 쓴다.',
    ].join('\n'),
    prompt: [
      `주제: ${topic.title}`,
      `핵심 키워드: ${topic.keywords || '-'}`,
      `다룰 관점: ${topic.angle || '-'}`,
      `카테고리: ${category ? category.name : '-'}`,
      '',
      '위 주제로 마스터 원고를 작성하세요. 이 원고는 이후 플랫폼별(블로그·SNS·숏폼)로 리라이팅되는 원본입니다.',
      '- body는 마크다운, 소제목(##) 4~6개, 전체 2000자 이상',
      '- summary는 2문장 요약',
      '- tags는 관련 태그 8~12개',
    ].join('\n'),
    schema: MASTER_SCHEMA,
  });
  if (result) return result;

  // 데모 폴백
  return {
    title: `[데모] ${topic.title}`,
    summary: `${topic.title}에 대한 데모 원고입니다. Anthropic API 키를 등록하면 실제 원고가 생성됩니다.`,
    body: [
      `## ${topic.title}`,
      '',
      '이 원고는 **데모 모드**에서 생성된 자리표시 콘텐츠입니다. 설정 화면에서 Anthropic API 키를 등록하면 Claude가 실제 장문 원고를 작성합니다.',
      '',
      '## 왜 이 주제인가',
      `키워드(${topic.keywords || '없음'})의 검색 수요를 가정한 데모 섹션입니다.`,
      '',
      '## 핵심 내용',
      '- 데모 포인트 1: 파이프라인 구조 확인용',
      '- 데모 포인트 2: 플랫폼별 리라이팅 확인용',
      '- 데모 포인트 3: 발행 큐/승인 플로우 확인용',
      '',
      '## 마무리',
      '실제 운영 시 이 자리에는 검색 최적화된 장문 원고가 들어갑니다.',
    ].join('\n'),
    tags: (topic.keywords || '데모').split(',').map((s) => s.trim()).filter(Boolean),
    _demo: true,
  };
}

// ---------- 플랫폼별 리라이팅 ----------

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    caption: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['title', 'body', 'hashtags', 'caption', 'notes'],
  additionalProperties: false,
};

async function rewriteForPlatform(master, platformKey, platformDef, account) {
  const p = platformDef.rewriteProfile;
  const result = await jsonRequest({
    system: [
      '당신은 멀티 플랫폼 콘텐츠 리라이팅 전문가입니다. 하나의 원고를 플랫폼별로 완전히 다른 글로 재창작합니다.',
      '리라이팅 원칙(중복 콘텐츠·저품질 판정 방지):',
      '- 제목, 서두, 문단 구조, 예시를 원본과 다르게 완전히 재구성한다. 단순 어순 변경이 아니라 재창작.',
      '- 해당 플랫폼 이용자가 그 플랫폼에서 쓴 글처럼 읽히게 한다(네이티브 톤).',
      '- 정보의 정확성은 유지하되 표현·전개는 독자적으로.',
      '- 광고 정책 위반 표현(효능 단정, 수익 보장, 과장)을 쓰지 않는다.',
    ].join('\n'),
    prompt: [
      `[원본 원고]`,
      `제목: ${master.title}`,
      `본문:\n${master.body}`,
      '',
      `[타깃 플랫폼] ${platformDef.name} (계정: ${account.name})`,
      `- 형식: ${p.format}`,
      `- 톤: ${p.tone}`,
      `- 구조: ${p.structure}`,
      `- 분량: ${p.length}`,
      `- 전략: ${p.notes}`,
      '',
      '위 프로파일에 맞춰 리라이팅하세요.',
      '- title: 이 플랫폼용 제목(원본 제목과 다르게)',
      '- body: 본문(형식이 cards면 카드별로 "=== 카드 N ===" 구분, thread면 "=== 포스트 N ===" 구분, script면 장면 지시 포함 대본)',
      '- hashtags: SNS/숏폼이면 해시태그 목록, 블로그면 태그 목록',
      '- caption: SNS용 캡션(블로그면 메타 설명 1~2문장)',
      '- notes: 발행 시 참고사항(이미지 준비, 링크 삽입 위치 등) 한두 줄',
    ].join('\n'),
    schema: REWRITE_SCHEMA,
  });
  if (result) return result;

  // 데모 폴백 — 프로파일 구조만 흉내낸 자리표시 원고
  return {
    title: `[데모·${platformDef.name}] ${master.title.replace(/^\[데모\]\s*/, '')}`,
    body: `(${platformDef.name} 전용 데모 리라이팅)\n\n${master.summary}\n\n형식: ${p.format} / 분량: ${p.length}\n실제 운영 시 프로파일(${p.tone})에 맞춘 재창작 원고가 생성됩니다.`,
    hashtags: (master.tags || []).slice(0, 8),
    caption: master.summary,
    notes: 'Anthropic API 키 등록 후 실제 리라이팅이 수행됩니다.',
    _demo: true,
  };
}

function hasApiKey() {
  return Boolean(getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY);
}

module.exports = { generateTopics, generateMaster, rewriteForPlatform, hasApiKey };
