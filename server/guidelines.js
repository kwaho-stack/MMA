// 글쓰기·리라이팅 지침 — 카탈로그의 기본 rewriteProfile 위에 사용자 수정본을 덮어쓴다.
// '_master' 항목은 마스터 원고(원본) 작성 지침이다.
// 저장 형식(guidelines.data JSON): { format?, tone?, structure?, length?, notes?, extra? }
//   extra: 기본 프로파일에 더해 추가로 지킬 지시사항(자유 서술)

const { db } = require('./db');
const { MEDIA_PLATFORMS } = require('./catalog');

// 마스터 원고 기본 지침 — llm.js의 시스템 프롬프트와 함께 사용된다.
const MASTER_DEFAULT = [
  '- 사실에 근거하고, 확인 불가한 수치·효능은 단정하지 않는다.',
  '- 의료·금융 과장 표현, 수익 보장 표현, 클릭베이트를 쓰지 않는다(광고 게재 제한 방지).',
  '- 독자가 끝까지 읽게 만드는 구조(문제 제기 → 해결 → 실행 팁)로 쓴다.',
  '- 소제목(##) 4~6개, 전체 2000자 이상의 정보성 장문.',
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
