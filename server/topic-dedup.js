// 주제 중복 방지 — 이미 발행했거나 풀에 있는 주제와 비슷한 주제의 재발행을 막는다.
// 정규화 후 완전 일치 또는 2-gram 자카드 유사도(기본 0.6 이상)를 중복으로 판정한다.

const { db } = require('./db');

/** 비교용 정규화 — 공백·기호·데모 접두어 제거, 소문자화 */
function normalize(title) {
  return String(title || '')
    .replace(/^\[데모[^\]]*\]\s*/, '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function bigrams(s) {
  const set = new Set();
  for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
  return set;
}

/** 0~1 자카드 유사도 (2-gram) */
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ga = bigrams(na);
  const gb = bigrams(nb);
  if (!ga.size || !gb.size) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/**
 * 기존 주제(모든 상태) 중 유사한 것을 찾는다.
 * @returns {{topic, score}|null}
 */
function findSimilar(title, { threshold = 0.6, excludeId = null } = {}) {
  const rows = db.prepare(
    `SELECT t.id, t.title, t.status, t.category_id, c.name category_name,
       (SELECT MAX(v.published_at) FROM variants v JOIN contents ct ON ct.id = v.content_id
        WHERE ct.topic_id = t.id AND v.status = 'published') last_published_at
     FROM topics t LEFT JOIN categories c ON c.id = t.category_id
     ORDER BY t.id DESC LIMIT 500`,
  ).all();
  let best = null;
  for (const t of rows) {
    if (excludeId && t.id === excludeId) continue;
    const score = similarity(title, t.title);
    if (score >= threshold && (!best || score > best.score)) best = { topic: t, score };
  }
  return best;
}

/** AI 주제 발굴 프롬프트에 넣을 제외 목록 — 최근 주제 제목 최대 40개 */
function recentTitles(categoryId = null, limit = 40) {
  const rows = categoryId
    ? db.prepare(`SELECT title FROM topics WHERE category_id = ? ORDER BY id DESC LIMIT ?`).all(categoryId, limit)
    : db.prepare(`SELECT title FROM topics ORDER BY id DESC LIMIT ?`).all(limit);
  return rows.map((r) => r.title.replace(/^\[데모[^\]]*\]\s*/, ''));
}

/** 생성된 주제 배열에서 기존·상호 중복을 걸러낸다. */
function filterNew(topics, { threshold = 0.6 } = {}) {
  const kept = [];
  const skipped = [];
  for (const t of topics) {
    const dupDb = findSimilar(t.title, { threshold });
    const dupBatch = kept.find((k) => similarity(k.title, t.title) >= threshold);
    if (dupDb) skipped.push({ title: t.title, reason: `기존 주제와 유사: "${dupDb.topic.title}"` });
    else if (dupBatch) skipped.push({ title: t.title, reason: `같은 배치 내 유사 주제` });
    else kept.push(t);
  }
  return { kept, skipped };
}

module.exports = { normalize, similarity, findSimilar, recentTitles, filterNew };
