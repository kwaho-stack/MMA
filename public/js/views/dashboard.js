async function viewDashboard(el) {
  const d = await API.get('/api/dashboard');
  const rev = d.revenue;
  const deltaPct = rev.prev30d > 0 ? ((rev.total30d - rev.prev30d) / rev.prev30d) * 100 : null;
  const sparkVals = rev.daily.slice(-12).map((r) => r.amount);

  const ACT_COLORS = { pipeline: 'var(--s1)', publish: 'var(--good)', error: 'var(--critical)', warn: 'var(--warning)', system: 'var(--muted)', scheduler: 'var(--s4)', account: 'var(--s2)', topic: 'var(--s3)', info: 'var(--muted)' };

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">대시보드</div>
        <div class="page-desc">전체 채널 발행 현황과 수익을 한눈에</div>
      </div>
      <div style="display:flex; gap:8px;">
        <a class="btn" href="#/queue">발행 큐 ${d.counts.pendingApproval ? `<span class="nav-badge">${d.counts.pendingApproval}</span>` : ''}</a>
        <a class="btn" href="#/studio">세부 옵션 실행 →</a>
      </div>
    </div>

    <div class="hero-run">
      <span class="hero-title">⚡ 원클릭 자동발행</span>
      <select id="hero-cat">
        ${d.categories.map((c) => `<option value="${c.id}" ${c.accounts ? '' : 'disabled'}>${esc(c.name)} — 계정 ${c.accounts}개 · 주제 ${c.topics}건</option>`).join('')}
      </select>
      <button class="btn btn-primary btn-lg" id="hero-run-btn">지금 발행</button>
      <div class="hint">클릭 한 번으로 주제 선정 → 원고 작성 → 정책 검사 → 플랫폼별 리라이팅 → ${d.settings.publish_mode === 'auto' ? '분산 예약 발행' : '승인 대기'}까지 자동 실행됩니다. 진행 상황은 아래에 실시간 표시됩니다.</div>
    </div>

    ${d.running.length ? `
      <div class="card" style="margin-bottom:16px; border-color: rgba(57,135,229,.35);">
        <div class="card-title">🔄 진행 중인 파이프라인 (${d.running.length}) <span style="font-weight:400; color:var(--muted)">실시간 갱신 중</span></div>
        ${d.running.map((c) => `
          <div class="variant-card" style="padding:12px 14px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:9px;">
              <span class="badge"><span class="bdot" style="background:${esc(c.category_color || '#888')}"></span>${esc(c.category_name || '-')}</span>
              <b style="font-size:13px; flex:1;">${esc(c.title || '(주제 선정 중…)')}</b>
              <a class="btn btn-sm" href="#/studio/content/${c.id}">상세 →</a>
            </div>
            ${renderStepper(c.progress, c.status)}
            ${c.progress.current ? `<div style="font-size:11.5px; color:var(--muted); margin-top:6px;">지금: ${esc(c.progress.current)} 리라이팅 중…</div>` : ''}
          </div>`).join('')}
      </div>` : ''}

    ${d.settings.llm_ready ? '' : `
      <div class="help-note" style="margin-bottom:16px;">
        현재 <b>데모 모드</b>입니다 — 콘텐츠는 자리표시 원고로 생성됩니다.
        <a href="#/settings" style="color:#9ec5f4; font-weight:600;">설정</a>에서 AI 엔진(Claude·Copilot·Gemini 중 하나)을 연결하면 실제 원고 작성·리라이팅이 수행되고,
        시뮬레이션 발행을 끄면 실제 채널로 배포됩니다.
      </div>`}

    <div class="grid grid-4">
      <div class="stat">
        <div class="stat-label">최근 30일 수익</div>
        <div class="stat-value">${fmt.won(rev.total30d)}</div>
        <div class="stat-sub">
          <span style="white-space:nowrap">${deltaPct !== null ? `<span class="${deltaPct >= 0 ? 'delta-up' : 'delta-down'}">${deltaPct >= 0 ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}%</span> 이전 30일 대비` : '비교 데이터 없음'}</span>
          <span style="margin-left:auto">${sparklineSVG(sparkVals, { width: 60 })}</span>
        </div>
      </div>
      <div class="stat">
        <div class="stat-label">오늘 발행</div>
        <div class="stat-value">${fmt.num(d.counts.publishedToday)}<span style="font-size:14px; color:var(--muted); font-weight:400;"> 건</span></div>
        <div class="stat-sub">최근 7일 ${fmt.num(d.counts.published7d)}건 발행</div>
      </div>
      <div class="stat">
        <div class="stat-label">대기 중인 작업</div>
        <div class="stat-value">${fmt.num(d.counts.pendingApproval + d.counts.scheduled + d.counts.manualQueue)}</div>
        <div class="stat-sub">승인 ${d.counts.pendingApproval} · 예약 ${d.counts.scheduled} · 수동 ${d.counts.manualQueue}${d.counts.failed ? ` · <span style="color:var(--critical)">실패 ${d.counts.failed}</span>` : ''}</div>
      </div>
      <div class="stat">
        <div class="stat-label">연결된 계정</div>
        <div class="stat-value">${fmt.num(d.counts.accounts)}</div>
        <div class="stat-sub">광고 플랫폼 ${d.counts.adAccounts}개 · 주제 풀 ${d.counts.topicsPool}건</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px;">
      <div class="card">
        <div class="card-title">일별 수익 추이 <span style="font-weight:400; color:var(--muted)">최근 30일 · 전체 광고 플랫폼 합산</span></div>
        <div class="chart-wrap" id="rev-line"></div>
      </div>
      <div class="card">
        <div class="card-title">광고 플랫폼별 수익 <span style="font-weight:400; color:var(--muted)">최근 30일</span></div>
        <div class="chart-wrap" id="rev-bars"></div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px;">
      <div class="card">
        <div class="card-title">카테고리 현황</div>
        <table class="tbl">
          <thead><tr><th>카테고리</th><th class="num">계정</th><th class="num">주제 풀</th><th class="num">7일 발행</th><th></th></tr></thead>
          <tbody>
            ${d.categories.map((c) => `
              <tr>
                <td><span class="badge"><span class="bdot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
                    ${c.auto_enabled ? '<span class="badge badge-violet" title="정기 자동발행 대상">자동</span>' : ''}</td>
                <td class="num">${c.accounts}</td>
                <td class="num">${c.topics}</td>
                <td class="num">${c.published7d}</td>
                <td style="text-align:right"><button class="btn btn-sm run-cat" data-id="${c.id}" ${c.accounts ? '' : 'disabled title="연결된 계정이 없습니다"'}>⚡ 발행</button></td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-title">최근 활동</div>
        <div>
          ${d.activity.length ? d.activity.map((a) => `
            <div class="activity-item">
              <span class="act-dot" style="background:${ACT_COLORS[a.type] || 'var(--muted)'}"></span>
              <span style="flex:1">${esc(a.message)}</span>
              <span class="activity-time">${fmt.datetime(a.created_at)}</span>
            </div>`).join('') : '<div class="empty">활동 내역이 없습니다</div>'}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">최근 콘텐츠 <a href="#/studio" style="font-weight:400; color:var(--muted); font-size:12px;">전체 보기 →</a></div>
      ${d.recentContents.length ? `
        <table class="tbl">
          <thead><tr><th>제목</th><th>카테고리</th><th>상태</th><th class="num">발행/변형</th><th>생성</th></tr></thead>
          <tbody>
            ${d.recentContents.map((c) => `
              <tr style="cursor:pointer" onclick="location.hash='#/studio/content/${c.id}'">
                <td style="font-weight:600">${esc(c.title || '(생성 중…)')}</td>
                <td><span class="badge"><span class="bdot" style="background:${esc(c.category_color || '#888')}"></span>${esc(c.category_name || '-')}</span></td>
                <td>${statusBadge(c.status)}</td>
                <td class="num">${c.published_count}/${c.variant_count}</td>
                <td style="color:var(--muted); font-size:12px;">${fmt.datetime(c.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">아직 생성된 콘텐츠가 없습니다. 콘텐츠 스튜디오에서 자동발행을 실행해 보세요.</div>'}
    </div>
  `;

  // 차트 렌더
  renderLineChart(document.getElementById('rev-line'), {
    points: rev.daily.map((r) => ({ label: fmt.date(r.date), fullLabel: r.date, value: r.amount })),
    formatValue: (v) => fmt.won(v),
    title: '수익',
  });
  renderBarChart(document.getElementById('rev-bars'), {
    items: rev.byAd.map((r) => ({
      label: r.name.length > 12 ? `${r.name.slice(0, 12)}…` : r.name,
      sub: '최근 30일 합계',
      value: r.amount,
      color: getComputedStyle(document.documentElement).getPropertyValue(({
        adsense: '--s1', adpost: '--s2', adfit: '--s3', coupang_partners: '--s4',
        taboola: '--s5', dable: '--s6', creator_rewards: '--s7', youtube_partner: '--s1', tenping: '--s2',
      })[r.platform] || '--s1').trim(),
    })),
    formatValue: (v) => fmt.won(v),
  });

  // 원클릭 자동발행 (히어로 바)
  const heroBtn = el.querySelector('#hero-run-btn');
  heroBtn.addEventListener('click', async () => {
    const catId = Number(el.querySelector('#hero-cat').value);
    if (!catId) { toast('카테고리를 선택하세요.', 'bad'); return; }
    heroBtn.disabled = true; heroBtn.textContent = '시작 중…';
    try {
      await API.post('/api/pipeline/run', { category_id: catId });
      toast('자동발행이 시작되었습니다 — 아래 진행 상황을 지켜보세요.', 'good');
      render(); // 진행 위젯 즉시 표시
    } catch (e) {
      toast(e.message, 'bad');
      heroBtn.disabled = false; heroBtn.textContent = '지금 발행';
    }
  });

  // 카테고리 즉시 발행
  el.querySelectorAll('.run-cat').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = '실행 중…';
      try {
        await API.post('/api/pipeline/run', { category_id: Number(btn.dataset.id) });
        toast('자동발행 파이프라인이 시작되었습니다.', 'good');
        render();
      } catch (e) {
        toast(e.message, 'bad');
        btn.disabled = false; btn.textContent = '⚡ 발행';
      }
    });
  });

  // 진행 중 파이프라인이 있으면 2.5초마다 자동 갱신
  if (d.running.length) {
    clearTimeout(window.__detailPoll);
    window.__detailPoll = setTimeout(() => {
      const hash = location.hash.replace(/^#/, '') || '/';
      if (hash === '/') render();
    }, 2500);
  }

  // 사이드바 모드 표시 갱신
  const mi = document.getElementById('mode-indicator');
  mi.innerHTML = `
    <div class="mode-line"><span class="dot" style="background:${d.settings.publish_mode === 'auto' ? 'var(--good)' : 'var(--warning)'}"></span>
      발행: ${d.settings.publish_mode === 'auto' ? '완전 자동' : '컨펌 후 발행'}</div>
    <div class="mode-line"><span class="dot" style="background:${d.settings.llm_ready ? 'var(--good)' : 'var(--muted)'}"></span>
      LLM: ${d.settings.llm_ready ? esc(d.settings.llm_label || '연결됨') : '데모 모드'}</div>
    <div class="mode-line"><span class="dot" style="background:${d.settings.simulate_publish === '1' ? 'var(--s4)' : 'var(--good)'}"></span>
      배포: ${d.settings.simulate_publish === '1' ? '시뮬레이션' : '실제 발행'}</div>`;
  const qb = document.getElementById('queue-badge');
  qb.textContent = d.counts.pendingApproval > 0 ? d.counts.pendingApproval : '';
}
