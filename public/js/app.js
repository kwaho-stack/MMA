// 해시 라우터 + 부트스트랩

const ROUTES = {
  '/': viewDashboard,
  '/studio': viewStudio,
  '/queue': viewQueue,
  '/accounts': viewAccounts,
  '/categories': viewCategories,
  '/guidelines': viewGuidelines,
  '/revenue': viewRevenue,
  '/settings': viewSettings,
};

async function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const segments = hash.split('/').filter(Boolean); // e.g. ['studio','content','3']
  const base = `/${segments[0] || ''}`;
  const handler = ROUTES[base] || ROUTES['/'];
  const view = document.getElementById('view');

  document.querySelectorAll('#nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.route === (ROUTES[base] ? base : '/'));
  });

  clearTimeout(window.__detailPoll);
  try {
    await handler(view, segments.slice(1));
  } catch (e) {
    view.innerHTML = `<div class="empty">화면을 불러오지 못했습니다: ${esc(e.message)}</div>`;
  }
  refreshQueueBadge();
}

async function refreshQueueBadge() {
  try {
    const d = await API.get('/api/dashboard');
    const qb = document.getElementById('queue-badge');
    qb.textContent = d.counts.pendingApproval > 0 ? d.counts.pendingApproval : '';
    const mi = document.getElementById('mode-indicator');
    if (!mi.innerHTML) {
      mi.innerHTML = `
        <div class="mode-line"><span class="dot" style="background:${d.settings.publish_mode === 'auto' ? 'var(--good)' : 'var(--warning)'}"></span>
          발행: ${d.settings.publish_mode === 'auto' ? '완전 자동' : '컨펌 후 발행'}</div>
        <div class="mode-line"><span class="dot" style="background:${d.settings.llm_ready ? 'var(--good)' : 'var(--muted)'}"></span>
          LLM: ${d.settings.llm_ready ? esc(d.settings.llm_label || '연결됨') : '데모 모드'}</div>
        <div class="mode-line"><span class="dot" style="background:${d.settings.simulate_publish === '1' ? 'var(--s4)' : 'var(--good)'}"></span>
          배포: ${d.settings.simulate_publish === '1' ? '시뮬레이션' : '실제 발행'}</div>`;
    }
  } catch { /* 사이드바 배지는 실패해도 무시 */ }
}

window.addEventListener('hashchange', render);
window.addEventListener('resize', () => {
  // 차트가 있는 화면은 리사이즈 시 다시 그린다 (디바운스)
  clearTimeout(window.__resizeT);
  window.__resizeT = setTimeout(() => {
    if (document.querySelector('.chart-wrap svg')) render();
  }, 250);
});
render();
