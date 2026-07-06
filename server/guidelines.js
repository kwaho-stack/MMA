// 글쓰기·리라이팅 지침 — 카탈로그의 기본 rewriteProfile 위에 사용자 수정본을 덮어쓴다.
// '_master' 항목은 마스터 원고(원본) 작성 지침이다.
// 저장 형식(guidelines.data JSON): { format?, tone?, structure?, length?, notes?, extra? }
//   extra: 기본 프로파일에 더해 추가로 지킬 지시사항(자유 서술)

const { db } = require('./db');
const { MEDIA_PLATFORMS } = require('./catalog');

// 마스터 원고 기본 지침 — llm.js의 시스템 프롬프트와 함께 사용된다.
// 핵심 목표: '사람이 직접 취재해 쓴 초고'처럼 — AI 특유의 표현·구조·리듬 tell을 원본부터 제거한다.
// (강한 화자 페르소나는 플랫폼 리라이팅에서 입히므로, 여기선 문체를 특정 매체로 굳히지 않는다.)
const MASTER_DEFAULT = [
  '[사실·안전]',
  '- 사실에 근거하고, 확인 불가한 수치·효능은 단정하지 않는다.',
  '- 의료·금융 효능 단정("완치","원금 보장" 등)·수익 보장 금지(광고 게재 제한 방지).',
  '- 제목은 호기심을 끄는 과장을 허용한다(사실 왜곡은 금지) — 본문으로 뒷받침되는 범위에서 궁금하게 만든다.',
  '',
  '[구체성 — 내용에서 AI 느낌 제거: 가장 중요]',
  '- 소제목마다 최소 1개의 구체적 근거를 넣는다: 실제 수치·비용·시점·고유명사(서비스·브랜드·기관명)·상황.',
  '- "일반적으로/보통/대체로/많은 사람들이" 같은 막연한 일반화 문장을 쓰지 않는다 — 구체적 상황이나 예시로 대체한다.',
  '- 최소 한 번은 반례·예외·"이건 사람마다 다르다"는 뉘앙스를 넣어 균형을 잡는다(위키처럼 정답만 나열하지 않는다).',
  '',
  '[표현 — 금칙: 아래 표현을 쓰지 않는다]',
  '- 정형 서두 금지: "현대 사회에서", "바쁜 일상 속에서", "많은 분들이 궁금해하시는", "~은 빼놓을 수 없는".',
  '- 정형 마무리 금지: "~에 대해 알아보았습니다", "도움이 되셨길 바랍니다", "지금까지 ~였습니다", "읽어주셔서 감사합니다".',
  '- 접속어 남발 금지: "또한/게다가/따라서/즉/먼저/마지막으로/첫째·둘째·셋째"를 습관적으로 붙이지 않는다.',
  '- 공허한 형용사·부사 금지: "다양한/효과적인/중요한/필수적인/매우/정말/굉장히" 대신 구체적으로 서술한다.',
  '- 리스트 강박 금지: 모든 내용을 번호·불릿으로 정리하지 않는다. 대부분은 문장으로 풀어 쓰고, 리스트는 정말 나열이 필요한 곳에만.',
  '',
  '[리듬 — 문장에서 AI 느낌 제거]',
  '- 문장 길이를 의도적으로 들쭉날쭉하게. 긴 설명 문장 뒤에는 아주 짧은 문장(5~12자)을 섞어 호흡을 만든다.',
  '- 서두는 일반론이 아니라 구체적 장면·수치·질문으로 곧장 시작한다.',
  '',
  '[구조]',
  '- 소제목(##) 4~6개, 전체 2000자 이상. 문제 제기 → 해결 → 실행 팁 흐름이되, 각 섹션 길이·형식을 일부러 다르게 해 대칭을 깬다.',
].join('\n');

function getOverride(platform) {
  const row = db.prepare('SELECT data, updated_at FROM guidelines WHERE platform = ?').get(platform);
  if (!row) return null;
  try { return { data: JSON.parse(row.data || '{}'), updated_at: row.updated_at }; } catch { return null; }
}

/** 플랫폼의 유효 리라이팅 프로파일(기본값 + 사용자 수정) */
function profileFor(platformKey) {
  const def = MEDIA_PLATFORMS[platformKey];
  if (!def) return null;
  const base = { ...def.rewriteProfile, extra: '' };
  const ov = getOverride(platformKey);
  if (!ov) return base;
  const merged = { ...base };
  for (const k of ['format', 'tone', 'structure', 'length', 'notes', 'extra']) {
    if (ov.data[k] !== undefined && String(ov.data[k]).trim() !== '') merged[k] = String(ov.data[k]);
  }
  return merged;
}

/** 마스터 원고 작성 지침(기본 + 사용자 수정) */
function masterGuide() {
  const ov = getOverride('_master');
  const custom = ov?.data?.extra ? String(ov.data.extra).trim() : '';
  const base = ov?.data?.notes ? String(ov.data.notes) : MASTER_DEFAULT;
  return { base, custom };
}

/** 지침 목록 — 화면 표출용 (마스터 + 전체 플랫폼) */
function list() {
  const out = [];
  const masterOv = getOverride('_master');
  out.push({
    platform: '_master',
    name: '마스터 원고 (모든 플랫폼의 원본)',
    kind: 'master',
    default: { notes: MASTER_DEFAULT, extra: '' },
    override: masterOv ? masterOv.data : null,
    updated_at: masterOv?.updated_at || null,
  });
  for (const [key, def] of Object.entries(MEDIA_PLATFORMS)) {
    const ov = getOverride(key);
    out.push({
      platform: key,
      name: def.name,
      kind: def.kind,
      publish_mode: def.publish.mode,
      default: { ...def.rewriteProfile, extra: '' },
      override: ov ? ov.data : null,
      effective: profileFor(key),
      updated_at: ov?.updated_at || null,
    });
  }
  return out;
}

function save(platform, data) {
  if (platform !== '_master' && !MEDIA_PLATFORMS[platform]) throw new Error('알 수 없는 플랫폼입니다.');
  const clean = {};
  for (const k of ['format', 'tone', 'structure', 'length', 'notes', 'extra']) {
    if (data[k] !== undefined) clean[k] = String(data[k]);
  }
  db.prepare(
    `INSERT INTO guidelines(platform, data, updated_at) VALUES(?, ?, datetime('now','localtime'))
     ON CONFLICT(platform) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
  ).run(platform, JSON.stringify(clean));
}

function reset(platform) {
  db.prepare('DELETE FROM guidelines WHERE platform = ?').run(platform);
}

module.exports = { profileFor, masterGuide, list, save, reset, MASTER_DEFAULT };
