// 발행 큐 — 승인 대기 / 예약 / 수동 발행 / 실패 관리

async function viewQueue(el) {
  const rows = await API.get('/api/queue');
  const groups = {
    ready: rows.filter((v) => ['ready', 'approved'].includes(v.status)),
    scheduled: rows.filter((v) => v.status === 'scheduled'),
    manual: rows.filter((v) => v.status === 'manual'),
    failed: rows.filter((v) => v.status === 'failed'),
  };

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">발행 큐</div>
        <div class="page-desc">최종 컨펌, 예약 발행, 수동(복사·붙여넣기) 발행을 관리합니다</div>
      </div>
      ${groups.ready.length ? `<button class="btn btn-good" id="approve-all">✓ 전체 승인 후 발행 (${groups.ready.length})</button>` : ''}
    </div>

    <div class="card">
      <div class="card-title">승인 대기 (${groups.ready.length}) <span style="font-weight:400; color:var(--muted)">검토 후 발행하세요 — 컨펌 모드의 최종 관문</span></div>
      ${groups.ready.length ? groups.ready.map((v) => renderVariantCard(v, { showContent: true })).join('') : '<div class="empty">승인 대기 중인 콘텐츠가 없습니다</div>'}
    </div>

    <div class="card">
      <div class="card-title">발행 예약 (${groups.scheduled.length}) <span style="font-weight:400; color:var(--muted)">스팸 판정 방지를 위해 시간 분산 배치됨 — 매분 자동 처리</span></div>
      ${groups.scheduled.length ? `
        <table class="tbl">
          <thead><tr><th>플랫폼 / 계정</th><th>제목</th><th>예약 시각</th><th></th></tr></thead>
          <tbody>
            ${groups.scheduled.map((v) => `
              <tr>
                <td><span class="badge badge-info">${esc(PLATFORM_NAMES[v.platform] || v.platform)}</span> <span style="color:var(--muted); font-size:12px">${esc(v.account_name || '')}</span></td>
                <td style="font-weight:600">${esc(v.title)}</td>
                <td style="font-variant-numeric:tabular-nums">${fmt.datetime(v.scheduled_at)}</td>
                <td style="text-align:right">
                  <button class="btn btn-sm btn-good act-approve" data-id="${v.id}">지금 발행</button>
                  <button class="btn btn-sm btn-danger act-reject" data-id="${v.id}">취소</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">예약된 발행이 없습니다</div>'}
    </div>

    <div class="card">
      <div class="card-title">수동 발행 대기 (${groups.manual.length}) <span style="font-weight:400; color:var(--muted)">네이버·티스토리 등 API 미지원 플랫폼 — 원고 복사 후 붙여넣기</span></div>
      ${groups.manual.length ? groups.manual.map((v) => renderVariantCard(v, { showContent: true })).join('') : '<div class="empty">수동 발행 대기 건이 없습니다</div>'}
    </div>

    ${groups.failed.length ? `
      <div class="card">
        <div class="card-title" style="color:var(--critical)">실패 (${groups.failed.length})</div>
        ${groups.failed.map((v) => renderVariantCard(v, { showContent: true })).join('')}
      </div>` : ''}
  `;

  bindVariantActions(el, render);

  const allBtn = el.querySelector('#approve-all');
  if (allBtn) allBtn.addEventListener('click', async () => {
    allBtn.disabled = true; allBtn.textContent = '일괄 발행 중…';
    let ok = 0, fail = 0;
    for (const v of groups.ready) {
      try { await API.post(`/api/variants/${v.id}/approve`); ok++; } catch { fail++; }
    }
    toast(`일괄 처리 완료 — 성공 ${ok}건${fail ? `, 실패 ${fail}건` : ''}`, fail ? 'info' : 'good');
    render();
  });
}
