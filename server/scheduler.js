// 스케줄러 —
// 1) 매분: 예약 시각이 지난 variants를 발행한다(분산 발행).
// 2) 매분: schedule_enabled=1이고 현재 시각이 schedule_times에 해당하면
//    auto_enabled 카테고리마다 파이프라인을 자동 실행한다(완전 자동 모드).

const cron = require('node-cron');
const { db, getSetting, log } = require('./db');
const { runPipeline, publishVariant } = require('./pipeline');
const revenueSync = require('./revenue-sync');

let lastAutoRunKey = '';
let lastRevenueSyncKey = '';

async function tickPublishQueue() {
  const due = db.prepare(
    `SELECT id FROM variants WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?`,
  ).all(new Date().toISOString());
  for (const row of due) {
    try {
      await publishVariant(row.id);
    } catch {
      // publishVariant가 상태·로그를 기록하므로 계속 진행
    }
  }
}

async function tickAutoPipeline() {
  if (getSetting('schedule_enabled') !== '1') return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const times = (getSetting('schedule_times') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!times.includes(hhmm)) return;

  const runKey = `${now.toDateString()}|${hhmm}`;
  if (runKey === lastAutoRunKey) return; // 같은 분에 중복 실행 방지
  lastAutoRunKey = runKey;

  const categories = db.prepare('SELECT * FROM categories WHERE auto_enabled = 1').all();
  if (!categories.length) return;
  log('scheduler', `정기 자동발행 시작 (${hhmm}) — 대상 카테고리 ${categories.length}개`);
  for (const c of categories) {
    try {
      await runPipeline({ categoryId: c.id, mode: getSetting('publish_mode') });
    } catch (e) {
      log('error', `정기 자동발행 실패(${c.name}): ${e.message}`);
    }
  }
}

// 매일 지정 시각에 동기화 가능한 광고 계정의 수익을 자동 반영한다.
async function tickRevenueSync() {
  if (getSetting('revenue_sync_enabled') !== '1') return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (hhmm !== (getSetting('revenue_sync_time') || '06:10')) return;

  const runKey = `${now.toDateString()}|${hhmm}`;
  if (runKey === lastRevenueSyncKey) return;
  lastRevenueSyncKey = runKey;

  // 자격증명이 갖춰진 계정만 대상 (미설정 계정은 매일 실패 로그를 남기지 않도록 건너뜀)
  const targets = revenueSync.syncReadyAccounts();
  if (!targets.length) return;

  log('scheduler', `일일 수익 동기화 시작 (${hhmm}) — 대상 ${targets.length}개 계정`);
  await revenueSync.syncAll();
}

function start() {
  cron.schedule('* * * * *', async () => {
    try { await tickPublishQueue(); } catch (e) { log('error', `발행 큐 처리 오류: ${e.message}`); }
    try { await tickAutoPipeline(); } catch (e) { log('error', `자동 파이프라인 오류: ${e.message}`); }
    try { await tickRevenueSync(); } catch (e) { log('error', `수익 동기화 오류: ${e.message}`); }
  });
  log('scheduler', '스케줄러 시작 — 발행 큐 · 정기 자동발행 · 일일 수익 동기화 감시 중');
}

module.exports = { start };
