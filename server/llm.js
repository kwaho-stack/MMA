// LLM 콘텐츠 엔진 — Anthropic Claude API / GitHub Copilot(구독 로그인) / Google Gemini(키 또는 OAuth).
// 설정의 llm_provider로 우선 엔진을 고르고, 해당 엔진이 준비되지 않았으면 다른 엔진으로 폴백한다.
// 모두 없으면 템플릿 기반 데모 생성으로 폴백해 전체 파이프라인을 확인할 수 있다(데모 표시됨).

const Anthropic = require('@anthropic-ai/sdk');
const { getSetting } = require('./db');
const copilot = require('./copilot');
const gemini = require('./gemini');
const guidelines = require('./guidelines');
const aiTells = require('./ai-tells');
const { stripAiMarkup, CLICKBAIT_TITLE } = require('./format');

/** 생성 결과에서 AI 티(마크다운 기호)를 걷어낸다 — 제목·본문·캡션 공통 후처리. */
function cleanContent(o) {
  if (!o) return o;
  if (o.title) o.title = stripAiMarkup(o.title).trim();
  if (o.body) o.body = stripAiMarkup(o.body);
  if (o.caption) o.caption = stripAiMarkup(o.caption);
  return o;
}

const PROVIDER_ORDER = ['anthropic', 'copilot', 'google'];

function getClient() {
  const key = getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY || '';
  if (!key) return null;
  return new Anthropic({ apiKey: key });
}

function model() {
  return getSetting('llm_model') || 'claude-opus-4-8';
}

/** 단계별 모델 — 리라이팅은 저가 모델을 따로 지정할 수 있다(비용 절감). */
function modelFor(stage) {
  if (stage === 'rewrite') {
    const r = (getSetting('llm_model_rewrite') || '').trim();
    if (r) return r;
  }
  return model();
}

// adaptive thinking + effort를 지원하는 모델(그 외 Haiku 등에 보내면 400).
function supportsAdaptive(m) {
  return /^claude-(opus-4-(6|7|8)|sonnet-(5|4-6)|fable-5)/.test(String(m || ''));
}

function effortLevel() {
  const e = getSetting('llm_effort') || 'medium';
  return ['low', 'medium', 'high', 'xhigh', 'max'].includes(e) ? e : 'medium';
}

/** 모델별로 안전한 thinking/effort 파라미터 — 지원 안 하는 모델에는 아무것도 싣지 않는다. */
function anthropicTuning(m) {
  if (supportsAdaptive(m)) return { thinking: { type: 'adaptive' }, effort: effortLevel() };
  return {}; // Haiku 등: thinking·effort 미전송(비용도 절감)
}

/** 콘텐츠 블록 배열 또는 문자열 프롬프트를 문자열로 평탄화(copilot·gemini용). */
function promptText(prompt) {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) return prompt.map((b) => b.text || '').join('\n\n');
  return String(prompt || '');
}

function providerReady(p) {
  if (p === 'anthropic') return Boolean(getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY);
  if (p === 'copilot') return copilot.isConnected();
  if (p === 'google') return gemini.available();
  return false;
}

/** 사용 가능한 엔진 결정: 설정 우선순위 → 준비된 엔진 폴백 → null(데모) */
function activeProvider() {
  const pref = getSetting('llm_provider') || 'anthropic';
  if (providerReady(pref)) return pref;
  return PROVIDER_ORDER.find((p) => providerReady(p)) || null;
}

/** Copilot 응답에서 JSON 추출 — 코드펜스·앞뒤 잡음을 걷어낸다. */
function parseJSONLoose(text) {
  let t = String(text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

async function jsonRequest({ system, prompt, schema, maxTokens = 16000, stage = 'master', cache = false }) {
  const provider = activeProvider();
  if (!provider) return null;

  if (provider === 'copilot') {
    const raw = await copilot.chat({
      system: `${system}\n\n중요: 반드시 아래 JSON 스키마를 만족하는 JSON 객체 하나만 출력하세요. 설명·코드펜스·다른 텍스트를 붙이지 마세요.`,
      prompt: `${promptText(prompt)}\n\n[출력 JSON 스키마]\n${JSON.stringify(schema)}`,
      maxTokens: Math.min(maxTokens, 8000),
    });
    return parseJSONLoose(raw);
  }

  if (provider === 'google') {
    const gmodel = getSetting('google_text_model') || 'gemini-2.5-flash';
    const data = await gemini.generateContent(gmodel, {
      systemInstruction: { parts: [{ text: `${system}\n\n반드시 아래 스키마를 만족하는 JSON 객체 하나만 출력하세요.\n${JSON.stringify(schema)}` }] },
      contents: [{ role: 'user', parts: [{ text: promptText(prompt) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: Math.min(maxTokens, 8192) },
    });
    if (data.candidates?.[0]?.finishReason === 'SAFETY') {
      throw new Error('Gemini가 안전 정책으로 응답을 거절했습니다. 주제를 바꿔 다시 시도하세요.');
    }
    return parseJSONLoose(gemini.textOf(data) || '{}');
  }

  // ── Anthropic ──
  const useModel = modelFor(stage);
  const tuning = anthropicTuning(useModel);
  const cacheOn = cache && getSetting('prompt_cache') !== '0';

  // 시스템 프롬프트: 캐싱 시 캐시 제어 블록으로 감싼다(같은 실행의 여러 리라이팅이 재사용).
  const systemParam = cacheOn
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system;

  // 사용자 메시지: 배열이면 콘텐츠 블록으로, 캐싱 시 첫 블록(공유 마스터 원고)에 캐시 제어를 건다.
  let content;
  if (Array.isArray(prompt)) {
    content = prompt.map((b, i) => (cacheOn && i === 0 ? { ...b, cache_control: { type: 'ephemeral' } } : b));
  } else {
    content = prompt;
  }

  const req = {
    model: useModel,
    max_tokens: maxTokens,
    system: systemParam,
    messages: [{ role: 'user', content }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  if (tuning.thinking) req.thinking = tuning.thinking;
  if (tuning.effort) req.output_config.effort = tuning.effort;

  const client = getClient();
  const response = await client.messages.create(req);
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

async function generateTopics(category, count = 5, { exclude = [] } = {}) {
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
      exclude.length ? [
        '',
        '[이미 다룬 주제 — 아래와 같거나 비슷한 주제는 절대 제안하지 마세요]',
        ...exclude.slice(0, 40).map((t) => `- ${t}`),
      ].join('\n') : '',
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

async function generateMaster(topic, category, { stages = false } = {}) {
  const guide = guidelines.masterGuide();
  const system = [
    '당신은 발로 뛰며 취재해 글을 쓰는 한국의 프리랜서 정보 콘텐츠 작가입니다.',
    '당신이 쓰는 초고는 "AI가 뽑아낸 매끈한 글"이 아니라, 실제 경험과 구체적 사실이 꽉 찬 취재 원본이어야 합니다.',
    '이 원고는 이후 플랫폼별(블로그·SNS·숏폼)로 리라이팅됩니다. 그러니 특정 매체 문체로 굳히지 말고, 사실·구체·리듬이 살아있는 중립적 초고를 쓰세요.',
    '',
    '원칙:',
    guide.base,
    guide.custom ? `\n[운영자 추가 지침 — 반드시 반영]\n${guide.custom}` : '',
  ].filter(Boolean).join('\n');
  const prompt = [
    `주제: ${topic.title}`,
    `핵심 키워드: ${topic.keywords || '-'}`,
    `다룰 관점: ${topic.angle || '-'}`,
    `카테고리: ${category ? category.name : '-'}`,
    '',
    CLICKBAIT_TITLE,
    '',
    '위 주제로 마스터 원고를 작성하세요.',
    '- body는 소제목(짧은 제목 줄) 4~6개로 나누되, #·##·**·__ 같은 마크다운 기호는 절대 쓰지 말 것(소제목은 그냥 짧은 문장 줄로). 전체 2000자 이상',
    '- summary는 2문장 요약',
    '- tags는 관련 태그 8~12개',
  ].join('\n');

  let result = await jsonRequest({ system, prompt, schema: MASTER_SCHEMA });
  const stageInfo = { selfcritique: getSetting('deai_selfcritique') !== '0', draft: null, draftScore: null, revisedScore: null, applied: false };

  // 자기비평 패스(2단 생성) — AI 느낌 점수가 높으면 구체적 지적과 함께 1회 개정.
  // 실제 모델 응답일 때만 수행(데모 폴백엔 의미 없음), 설정으로 끌 수 있음.
  if (result && getSetting('deai_selfcritique') !== '0') {
    try {
      const crit = aiTells.critiqueNotes(result.body);
      stageInfo.draft = stages ? { title: result.title, body: result.body } : null;
      stageInfo.draftScore = crit.score;
      if (crit.score >= 30 && crit.notes) {
        const revised = await jsonRequest({
          system,
          prompt: [
            '아래는 당신이 방금 쓴 초고입니다. 자동 검사에서 AI가 쓴 티가 나는 부분이 발견됐습니다.',
            '',
            `[제목]\n${result.title}`,
            `[본문]\n${result.body}`,
            '',
            `[반드시 해소할 지점 — AI 느낌 점수 ${crit.score}/100]`,
            crit.notes,
            '',
            '지시: 정보량·사실·구조는 유지하되, 위 지적을 전부 해소해 다시 쓰세요.',
            '- 정형 서두/마무리구는 삭제하고, 구체적 장면·수치·질문으로 시작하고 맺으세요.',
            '- 접속어·공허 형용사를 덜어내고, 막연한 일반화 문장은 구체적 사례·수치로 바꾸세요.',
            '- 문장 길이를 들쭉날쭉하게, 짧은 문장을 섞어 리듬을 주세요.',
            'summary·tags도 함께 다시 정리하세요.',
          ].join('\n'),
          schema: MASTER_SCHEMA,
        });
        // 개선됐을 때만 채택(더 나빠지면 원본 유지).
        if (revised && revised.body) {
          const rScore = aiTells.score(revised.body).score;
          stageInfo.revisedScore = rScore;
          if (rScore <= crit.score) { result = revised; stageInfo.applied = true; }
        }
      }
    } catch { /* 자기비평 실패는 치명적이지 않음 — 초안 그대로 사용 */ }
  }

  if (result) {
    cleanContent(result);
    if (stages) result._stages = stageInfo;
    return result;
  }

  // 데모 폴백
  return cleanContent({
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
  });
}

// ---------- 사진 기반 마스터 원고(포토 오토 블로깅) ----------

/**
 * 첨부 사진 + 사진별 설명으로 방문 후기형 마스터 원고를 생성한다.
 * 사진 자리에는 [[PHOTO]] 자리표시자를 순서대로 넣어, 발행 시 실제 사진이 그 위치에 삽입된다.
 * @param {{title:string, keywords?:string, angle?:string}} topic
 * @param {object} category
 * @param {Array<{caption:string}>} photos 순서 있는 사진 설명
 */
async function generateMasterFromPhotos(topic, category, photos) {
  const guide = guidelines.masterGuide();
  const photoList = photos.map((p, i) => `${i + 1}. ${p.caption || '(설명 없음)'}`).join('\n');
  const system = [
    '당신은 직접 다녀온 장소·여행·맛집을 생생하게 기록하는 한국의 블로거입니다.',
    '독자가 "나도 가보고 싶다"고 느끼도록, 첨부된 사진과 현장 경험을 살려 진짜 방문 후기처럼 씁니다.',
    '원칙:',
    guide.base,
    guide.custom ? `\n[운영자 추가 지침 — 반드시 반영]\n${guide.custom}` : '',
  ].filter(Boolean).join('\n');
  const prompt = [
    `주제/장소: ${topic.title}`,
    topic.keywords ? `키워드: ${topic.keywords}` : '',
    topic.angle ? `관점: ${topic.angle}` : '',
    `카테고리: ${category ? category.name : '-'}`,
    '',
    `첨부된 사진 ${photos.length}장과 각 사진 설명(순서대로):`,
    photoList,
    '',
    CLICKBAIT_TITLE,
    '',
    '위 사진들을 순서대로 활용해 방문 후기 블로그 글을 쓰세요.',
    `- 사진이 들어갈 자리에 정확히 [[PHOTO]] 라고 표기하세요. [[PHOTO]]는 사진 순서대로 총 ${photos.length}번, 각 사진 설명에 해당하는 문단 근처에 넣습니다.`,
    '- 각 사진 앞뒤로 그 사진에 대한 구체적 묘사·현장 경험·꿀팁을 2~4문장 쓰세요(설명을 그대로 베끼지 말고 확장).',
    '- #·##·**·__ 같은 마크다운 기호는 쓰지 마세요(소제목은 짧은 문장 줄로).',
    '- 도입은 방문 계기와 첫인상, 마무리는 총평 + 추천 대상 + 독자에게 묻는 질문 1개로.',
    '- body는 전체 1,200자 이상, summary는 2문장, tags는 장소·지역·메뉴 등 관련 태그 8~12개.',
  ].filter(Boolean).join('\n');

  const result = await jsonRequest({ system, prompt, schema: MASTER_SCHEMA });
  if (result) return cleanContent(result);

  // 데모 폴백 — 사진 설명을 엮어 자리표시자와 함께 배치
  return cleanContent({
    title: topic.title,
    summary: `${topic.title} 방문 후기입니다. Anthropic API 키를 등록하면 사진을 활용한 실제 후기가 생성됩니다.`,
    body: [
      `${topic.title}에 다녀왔습니다.`,
      '',
      ...photos.flatMap((p, i) => [`${p.caption || `사진 ${i + 1}`}`, '[[PHOTO]]', '']),
      '전체적으로 만족스러운 방문이었습니다. 여러분은 어디가 가장 궁금하신가요?',
    ].join('\n'),
    tags: (topic.keywords || category?.name || '방문후기').split(',').map((s) => s.trim()).filter(Boolean),
    _demo: true,
  });
}

// ---------- 플랫폼별 리라이팅 ----------

const REWRITE_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    body: { type: 'string' },
    hashtags: { type: 'array', items: { type: 'string' } },
    caption: { type: 'string' },
    cta: { type: 'string' },
    pinned_comment: { type: 'string' },
    ad_snippet: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['title', 'body', 'hashtags', 'caption', 'cta', 'pinned_comment', 'ad_snippet', 'notes'],
  additionalProperties: false,
};

// ---------- 글자수 하드리밋 (SNS) ----------

function splitPosts(body) {
  return String(body || '').split(/===\s*(?:포스트|트윗|카드)\s*\d+\s*===/g).map((s) => s.trim()).filter(Boolean);
}

/** 플랫폼 글자수 제한 위반 내용을 찾는다. 없으면 null. */
function limitViolation(result, platformDef, profile) {
  const limits = platformDef.limits;
  if (!limits) return null;
  if (limits.perPost && profile.format === 'thread') {
    const over = splitPosts(result.body).filter((p) => p.length > limits.perPost);
    if (over.length) return `포스트/트윗 ${over.length}개가 ${limits.perPost}자를 초과했습니다. 각 포스트를 ${limits.perPost}자 이내로 줄이세요.`;
  }
  if (limits.caption && result.caption && result.caption.length > limits.caption) {
    return `캡션이 ${limits.caption}자를 초과했습니다. ${limits.caption}자 이내로 줄이세요.`;
  }
  return null;
}

/** 재요청 후에도 초과하면 마지막 수단으로 잘라낸다(발행 실패 방지). */
function hardTrim(result, platformDef, profile) {
  const limits = platformDef.limits;
  if (!limits) return result;
  if (limits.perPost && profile.format === 'thread') {
    const posts = splitPosts(result.body).map((p) => (p.length > limits.perPost ? `${p.slice(0, limits.perPost - 1)}…` : p));
    result.body = posts.map((p, i) => `=== 포스트 ${i + 1} ===\n${p}`).join('\n\n');
  }
  if (limits.caption && result.caption && result.caption.length > limits.caption) {
    result.caption = `${result.caption.slice(0, limits.caption - 1)}…`;
  }
  return result;
}

// ---------- 광고 연동 컨텍스트 ----------

/** 계정에 매칭된 광고 플랫폼을 리라이팅 프롬프트용 광고 전략 지시문으로 바꾼다. */
function adDirectives(kind, ads) {
  if (!ads || !ads.length) {
    return ['- 연결된 수익원 없음: ad_snippet은 빈 문자열로 두세요.'];
  }
  const { AD_PLATFORMS } = require('./catalog');
  const names = ads.map((a) => AD_PLATFORMS[a.platform]?.name || a.platform);
  const hasCoupang = ads.some((a) => a.platform === 'coupang_partners');
  const lines = [`- 이 계정의 수익원: ${names.join(', ')} — 광고가 글의 흐름을 깨지 않고 맥락에 녹아들게 하세요.`];
  if (kind === 'blog') {
    lines.push('- ad_snippet: 결론 직전 "함께 보면 좋은 정보" 섹션에 넣을 1~3문장. 본문 주제와 자연스럽게 이어지는 추천 문구로 쓰고, 링크가 들어갈 자리는 [수익링크] 로 표시.');
  } else if (kind === 'sns') {
    lines.push('- ad_snippet: 캡션/본문 말미에 녹일 프로필 링크 유도 문구 1문장 (예: "자세한 정보는 프로필 링크에 정리해뒀어요").');
    lines.push('- pinned_comment: 댓글로 달아둘 자연스러운 랜딩 유도 멘트 1~2문장, 링크 자리는 [수익링크].');
  } else {
    lines.push('- cta: 영상 중반에 들어갈 심플하고 명확한 CTA 한 문장.');
    lines.push('- pinned_comment: 고정 댓글용 문구 1~2문장, 링크 자리는 [수익링크].');
  }
  if (hasCoupang) {
    lines.push('- 쿠팡 파트너스가 연결됨: ad_snippet 끝에 "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다." 대가성 문구를 반드시 포함.');
  }
  return lines;
}

/**
 * 지침 체크리스트 유도 정제 — 초안을 플랫폼 지침 항목별로 자가 점검하고 고쳐 다시 쓰게 한다.
 * 저가 모델이 한 번에 못 지키는 지침을 '하나씩 따라가며' 충족시키는 품질 보강 단계.
 * guided_refine: 'auto'(저가 모델에서만·기본) | 'on'(항상) | 'off'
 */
async function guidedRefine(draft, { system, masterBlock, platformDef, profile }) {
  if (!draft || draft._demo) return draft;
  const mode = getSetting('guided_refine') || 'auto';
  if (mode === 'off') return draft;
  // auto: 상위 모델(사고 지원)은 한 방에 잘 쓰므로 생략, 저가 모델일 때만 정제(비용·품질 균형).
  if (mode === 'auto' && supportsAdaptive(modelFor('rewrite'))) return draft;

  const crit = aiTells.critiqueNotes(draft.body || '');
  const aiNotes = crit.notes ? `\n[AI 느낌 신호 — 아래 표현을 삭제/교체]\n${crit.notes}` : '';
  // 이미 충분히 사람 같고 지적할 게 없으면 정제 생략(불필요한 호출 방지).
  if (crit.score < 22 && !aiNotes) return draft;

  const instr = [
    '아래는 당신이 방금 쓴 리라이팅 초안입니다. 발행 전에 지침을 항목별로 하나씩 점검하고 어긋난 곳을 고쳐 다시 쓰세요.',
    '',
    `[제목]\n${draft.title}`,
    `[본문]\n${draft.body}`,
    '',
    '[지침 체크리스트 — 각 항목을 확인하고 충족하도록 수정]',
    `- 구조: ${profile.structure}`,
    `- 톤: ${profile.tone}`,
    `- 전략·주의: ${profile.notes}`,
    profile.extra ? `- 운영자 추가 지침: ${profile.extra}` : '',
    aiNotes,
    '',
    '지시: 위 원본 원고의 사실·정보는 유지하되, 체크리스트를 모두 충족하도록 제목·본문·부가 항목(hashtags·caption·cta·pinned_comment·ad_snippet·notes)을 다시 완성하세요.',
  ].filter(Boolean).join('\n');

  try {
    const refined = await jsonRequest({
      system,
      prompt: [{ type: 'text', text: masterBlock }, { type: 'text', text: instr }],
      schema: REWRITE_SCHEMA, stage: 'rewrite', cache: true,
    });
    // AI 느낌이 더 나빠지지 않았을 때만 채택.
    if (refined && refined.body && aiTells.score(refined.body).score <= crit.score + 5) {
      return hardTrim(refined, platformDef, profile);
    }
  } catch { /* 정제 실패는 무시 — 초안 사용 */ }
  return draft;
}

async function rewriteForPlatform(master, platformKey, platformDef, account, { ads = [], photos = null } = {}) {
  // 지침 탭에서 수정한 프로파일이 있으면 그것을 사용한다.
  const p = guidelines.profileFor(platformKey) || platformDef.rewriteProfile;
  const isBlog = platformDef.kind === 'blog';
  const photoMode = Array.isArray(photos) && photos.length > 0;
  const system = [
    '당신은 각 플랫폼의 알고리즘과 이용자 소비 성향을 꿰뚫는 전문 카피라이터입니다. 하나의 원고를 플랫폼별로 완전히 다른 글로 재창작합니다.',
    '리라이팅 원칙(중복 콘텐츠·저품질 판정 방지):',
    '- 제목, 서두, 문단 구조, 예시를 원본과 다르게 완전히 재구성한다. 단순 어순 변경이 아니라 재창작.',
    '- 해당 플랫폼 이용자가 그 플랫폼에서 쓴 글처럼 읽히게 한다(네이티브 톤).',
    '- 정보의 정확성은 유지하되 표현·전개는 독자적으로.',
    '- 광고 정책 위반 표현(효능 단정, 수익 보장, 과장)을 쓰지 않는다.',
    '- 광고·수익 문구는 콘텐츠 맥락에 자연스럽게 녹인다. 판매 압박 문구 금지.',
  ].join('\n');

  // 공유 블록(마스터 원고) — 한 콘텐츠의 여러 플랫폼 리라이팅이 동일하므로 프롬프트 캐싱으로 재사용한다.
  const photoBlock = photoMode
    ? `\n\n[첨부 사진 ${photos.length}장 — 순서대로]\n${photos.map((ph, i) => `${i + 1}. ${ph.caption || '(설명 없음)'}`).join('\n')}`
    : '';
  const masterBlock = [`[원본 원고]`, `제목: ${master.title}`, `본문:\n${master.body}`, photoBlock].join('\n');

  // 사진 모드: Gemini 삽화 대신 사용자가 올린 실제 사진을 [[PHOTO]] 자리에 순서대로 넣는다.
  const imageInstr = photoMode
    ? `- 본문에 첨부 사진을 넣습니다. 사진이 들어갈 자리에 정확히 [[PHOTO]] 라고만 표기하고, 사진 순서대로 총 ${photos.length}번 배치하세요(각 사진 설명에 맞는 문단 근처). [이미지: …] 형태의 마커나 다른 이미지 표기는 절대 쓰지 마세요.`
    : (isBlog ? '- 본문 중간에 어울리는 삽화 위치를 [이미지: 장면을 구체적으로 묘사] 형식으로 2~3곳 표시하세요(이미지가 자동 생성되어 삽입됩니다).' : '');

  const buildInstr = (retryNote) => [
    `[타깃 플랫폼] ${platformDef.name} (계정: ${account.name})`,
    `- 형식: ${p.format}`,
    `- 톤: ${p.tone}`,
    `- 구조: ${p.structure}`,
    `- 분량: ${p.length}`,
    `- 전략: ${p.notes}`,
    p.extra ? `- 운영자 추가 지침(반드시 반영): ${p.extra}` : '',
    '',
    '[광고·수익 연동]',
    ...adDirectives(platformDef.kind, ads),
    '',
    '위 프로파일에 맞춰 리라이팅하세요.',
    '',
    CLICKBAIT_TITLE,
    '- 본문에는 #·##·**·__ 같은 마크다운 기호를 쓰지 마세요(소제목은 짧은 문장 줄로).',
    '',
    imageInstr,
    '- title: 이 플랫폼용 제목(원본 제목과 다르게, 위 어그로 지침을 반드시 적용)',
    '- body: 본문(형식이 cards면 카드별로 "=== 카드 N ===" 구분, thread면 "=== 포스트 N ===" 구분, script면 장면 지시 포함 대본)',
    '- hashtags: SNS/숏폼이면 맥락에 맞는 해시태그(SNS는 3~5개만), 블로그면 태그 목록',
    '- caption: SNS용 캡션(블로그면 메타 설명 1~2문장)',
    '- cta: 독자 행동 유도 문구 한 문장(없으면 빈 문자열)',
    '- pinned_comment: 고정/첫 댓글용 문구(SNS·숏폼, 없으면 빈 문자열)',
    '- ad_snippet: 위 광고 연동 지시에 따른 수익 문구(없으면 빈 문자열)',
    '- notes: 발행 시 참고사항 한두 줄',
    retryNote ? `\n[재요청] ${retryNote}` : '',
  ].filter(Boolean).join('\n');

  // 캐시 가능한 공유 블록을 앞에, 플랫폼별 지시를 뒤에 둔다(첫 블록이 캐시 프리픽스).
  const buildPrompt = (retryNote) => [{ type: 'text', text: masterBlock }, { type: 'text', text: buildInstr(retryNote) }];

  let result = await jsonRequest({ system, prompt: buildPrompt(null), schema: REWRITE_SCHEMA, stage: 'rewrite', cache: true });

  if (result) {
    // SNS 글자수 하드리밋: 위반 시 1회 재요청 → 그래도 초과하면 잘라내기(발행 실패 방지)
    const violation = limitViolation(result, platformDef, p);
    if (violation) {
      const retried = await jsonRequest({ system, prompt: buildPrompt(violation), schema: REWRITE_SCHEMA, stage: 'rewrite', cache: true });
      result = hardTrim(retried || result, platformDef, p);
    }
    // 지침 체크리스트 유도 정제 — 저가 모델이 지침을 하나씩 따라 자가 점검·수정하게 한다.
    result = await guidedRefine(result, { system, masterBlock, platformDef, profile: p });
    return cleanContent(result);
  }

  // 데모 폴백 — 프로파일 구조만 흉내낸 자리표시 원고
  return {
    title: `[데모·${platformDef.name}] ${master.title.replace(/^\[데모\]\s*/, '')}`,
    body: `(${platformDef.name} 전용 데모 리라이팅)\n\n${master.summary}\n\n형식: ${p.format} / 분량: ${p.length}\n실제 운영 시 프로파일(${p.tone.slice(0, 40)}…)에 맞춘 재창작 원고가 생성됩니다.${photoMode ? `\n\n${photos.map(() => '[[PHOTO]]').join('\n\n')}` : ''}`,
    hashtags: (master.tags || []).slice(0, 5),
    caption: master.summary,
    cta: platformDef.kind === 'blog' ? '' : '(데모) 프로필 링크에서 더 보기',
    pinned_comment: platformDef.kind === 'blog' ? '' : '(데모) 자세한 내용은 [수익링크] 에서 확인하세요.',
    ad_snippet: ads.length ? '(데모) 함께 보면 좋은 정보 — [수익링크]' : '',
    notes: 'AI 엔진 연결 후 실제 리라이팅이 수행됩니다.',
    _demo: true,
  };
}

/** 텍스트 엔진(Claude 또는 Copilot)이 하나라도 준비되었는지 */
function hasApiKey() {
  return activeProvider() !== null;
}

/** 사이드바·설정 표시용 엔진 정보 */
function engineInfo() {
  const provider = activeProvider();
  let label;
  if (provider === 'copilot') label = `Copilot (${getSetting('copilot_model') || 'gpt-4o'})`;
  else if (provider === 'google') label = `Gemini (${getSetting('google_text_model') || 'gemini-2.5-flash'})`;
  else if (provider === 'anthropic') {
    const rw = modelFor('rewrite');
    label = rw !== model() ? `Claude (${model()} · 리라이팅 ${rw})` : `Claude (${model()})`;
  } else label = '데모 모드';
  return { ready: provider !== null, provider, label };
}

module.exports = { generateTopics, generateMaster, generateMasterFromPhotos, rewriteForPlatform, hasApiKey, engineInfo };
