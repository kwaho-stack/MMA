// 수익 — 광고 플랫폼별 수익 집계, 추이, 수동 기록 입력

async function viewRevenue(el) {
  const [data, ads, media] = await Promise.all([
    API.get('/api/revenues?days=30'),
    API.get('/api/ad-accounts'),
    API.get('/api/media-accounts'),
  ]);
  const total = data.daily.reduce((s, r) => s + r.amount, 0);
  const avg = data.daily.length ? total / data.daily.length : 0;
  const best = data.byAd[0];

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">수익</div>
        <div class="page-desc">광고 플랫폼별 수익을 기록하고 추이를 확인합니다 (수동 입력 · API 연동 준비)</div>
      </div>
      <button class="btn btn-primary" id="add-rev">+ 수익 기록</button>
    </div>

    <div class="grid grid-3">
      <div class="stat">
        <div class="stat-label">최근 30일 합계</div>
        <div class="stat-value">${fmt.wonFull(total)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">일평균</div>
        <div class="stat-value">${fmt.won(avg)}</div>
        <div class="stat-sub">월 환산 약 ${fmt.won(avg * 30)}</div>
      </div>
      <div class="stat">
        <div class="stat-label">최고 수익원</div>
        <div class="stat-value" style="font-size:19px;">${best ? esc(best.name) : '-'}</div>
        <div class="stat-sub">${best ? `${fmt.won(best.amount)} · 전체의 ${total ? Math.round((best.amount / total) * 100) : 0}%` : ''}</div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px;">
      <div class="card">
        <div class="card-title">일별 수익 추이 <span style="font-weight:400; color:var(--muted)">최근 30일</span></div>
        <div class="chart-wrap" id="rv-line"></div>
      </div>
      <div class="card">
        <div class="card-title">플랫폼별 비중 <span style="font-weight:400; color:var(--muted)">최근 30일</span></div>
        <div class="chart-wrap" id="rv-bars"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">최근 수익 기록</div>
      ${data.recent.length ? `
        <table class="tbl">
          <thead><tr><th>날짜</th><th>광고 플랫폼</th><th>미디어</th><th class="num">금액</th><th>메모</th><th></th></tr></thead>
          <tbody>
            ${data.recent.map((r) => `
              <tr>
                <td style="font-variant-numeric:tabular-nums">${esc(r.date)}</td>
                <td><span class="badge"><span class="bdot" style="background:${AD_COLORS[r.ad_platform] || 'var(--s1)'}"></span>${esc(r.ad_name)}</span></td>
                <td style="color:var(--muted); font-size:12px">${esc(r.media_name || '전체')}</td>
                <td class="num" style="font-weight:600">${fmt.wonFull(r.amount)}</td>
                <td style="color:var(--muted); font-size:12px">${esc(r.memo || '')}</td>
                <td style="text-align:right"><button class="btn btn-sm btn-danger del-rev" data-id="${r.id}">✕</button></td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">수익 기록이 없습니다</div>'}
    </div>

    <div class="help-note" style="margin-top:16px;">
      <b>수익 데이터 연동</b> — 애드센스·애드포스트 등은 정산 리포트 CSV/화면 값을 이 화면에서 날짜별로 기록하면 대시보드에 반영됩니다.
      플랫폼별 리포팅 API 연동(애드센스 Management API 등)은 자격증명 등록 후 확장할 수 있는 구조로 설계되어 있습니다.
    </div>
  `;

  renderLineChart(document.getElementById('rv-line'), {
    points: data.daily.map((r) => ({ label: fmt.date(r.date), fullLabel: r.date, value: r.amount })),
    formatValue: (v) => fmt.won(v),
    title: '수익',
  });
  renderBarChart(document.getElementById('rv-bars'), {
    items: data.byAd.map((r) => ({
      label: r.name.length > 12 ? `${r.name.slice(0, 12)}…` : r.name,
      sub: `기록 ${r.entries}건`,
      value: r.amount,
      color: getComputedStyle(document.documentElement).getPropertyValue(({
        adsense: '--s1', adpost: '--s2', adfit: '--s3', coupang_partners: '--s4',
        taboola: '--s5', dable: '--s6', creator_rewards: '--s7', youtube_partner: '--s1', tenping: '--s2',
      })[r.platform] || '--s1').trim(),
    })),
    formatValue: (v) => fmt.won(v),
  });

  el.querySelector('#add-rev').addEventListener('click', () => {
    const today = new Date().toISOString().slice(0, 10);
    openModal({
      title: '수익 기록 추가',
      body: `
        <div class="field"><label>광고 플랫폼 *</label>
          <select id="r-ad">${ads.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
        <div class="field"><label>미디어 계정 (선택)</label>
          <select id="r-media"><option value="">전체/미지정</option>${media.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select></div>
        <div class="field-row">
          <div class="field"><label>날짜 *</label><input type="date" id="r-date" value="${today}" /></div>
          <div class="field"><label>금액(원) *</label><input type="number" id="r-amount" placeholder="12000" /></div>
        </div>
        <div class="field"><label>메모</label><input id="r-memo" placeholder="예: 6월 정산분" /></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="r-save">저장</button>`,
    });
    document.getElementById('r-save').addEventListener('click', async () => {
      try {
        await API.post('/api/revenues', {
          ad_account_id: Number(document.getElementById('r-ad').value),
          media_account_id: document.getElementById('r-media').value ? Number(document.getElementById('r-media').value) : null,
          date: document.getElementById('r-date').value,
          amount: Number(document.getElementById('r-amount').value),
          memo: document.getElementById('r-memo').value.trim(),
        });
        closeModal(); toast('수익이 기록되었습니다.', 'good'); render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  });

  el.querySelectorAll('.del-rev').forEach((b) => b.addEventListener('click', async () => {
    await API.del(`/api/revenues/${b.dataset.id}`); render();
  }));
}
