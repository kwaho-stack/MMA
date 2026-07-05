// 지침 — 플랫폼별 글쓰기·리라이팅 지침을 표출하고 수정한다.
// 기본 지침은 카탈로그에 내장되어 있고, 수정하면 리라이팅 프롬프트에 수정본이 적용된다.

const GUIDE_FIELD_LABELS = {
  format: '형식',
  tone: '톤',
  structure: '구조',
  length: '분량',
  notes: '전략',
  extra: '추가 지침',
};

async function viewGuidelines(el) {
  const rows = await API.get('/api/guidelines');
  const master = rows.find((r) => r.platform === '_master');
  const platforms = rows.filter((r) => r.platform !== '_master');

  const modeBadge = (m) => m === 'api' ? '<span class="badge badge-ok">API 자동</span>'
    : m === 'browser' ? '<span class="badge badge-violet">브라우저 자동</span>'
    : '<span class="badge">반자동(복사)</span>';

  const fieldRow = (label, value, isCustom) => value ? `
    <div style="display:flex; gap:10px; margin-bottom:7px; font-size:12.5px; line-height:1.55;">
      <span style="flex:0 0 52px; color:var(--muted); font-weight:600;">${label}</span>
      <span style="color:var(--text-2);">${esc(value)}${isCustom ? ' <span class="badge badge-warn" style="margin-left:4px">수정됨</span>' : ''}</span>
    </div>` : '';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">글쓰기 · 리라이팅 지침</div>
        <div class="page-desc">플랫폼별 재창작 전략 — 수정하면 다음 자동발행부터 즉시 적용됩니다</div>
      </div>
    </div>

    <div class="card">
      <div class="card-title">✍ 마스터 원고 지침 <span style="font-weight:400; color:var(--muted)">모든 플랫폼 리라이팅의 원본이 되는 원고의 작성 원칙</span></div>
      <div style="white-space:pre-wrap; font-size:12.5px; color:var(--text-2); line-height:1.7;">${esc(master.override?.notes || master.default.notes)}</div>
      ${master.override?.extra ? `<div style="margin-top:10px; padding:10px 12px; border-left:3px solid var(--warning); background:rgba(255,255,255,.02); font-size:12.5px; white-space:pre-wrap;"><b>운영자 추가 지침</b><br>${esc(master.override.extra)}</div>` : ''}
      <div class="variant-actions" style="margin-top:12px;">
        <button class="btn btn-sm edit-guide" data-platform="_master">지침 수정</button>
        ${master.override ? `<button class="btn btn-sm btn-danger reset-guide" data-platform="_master">기본값 복원</button>
          <span style="font-size:11.5px; color:var(--muted)">수정: ${fmt.datetime(master.updated_at)}</span>` : ''}
      </div>
    </div>

    ${platforms.map((p) => {
      const eff = p.effective;
      const ovKeys = new Set(Object.keys(p.override || {}).filter((k) => String(p.override[k]).trim() !== ''));
      return `
      <div class="card">
        <div class="card-title" style="display:flex; align-items:center; gap:8px;">
          ${esc(p.name)} ${modeBadge(p.publish_mode)}
          ${p.override ? '<span class="badge badge-warn">사용자 수정</span>' : '<span class="badge">기본 지침</span>'}
        </div>
        ${['format', 'tone', 'structure', 'length', 'notes'].map((k) => fieldRow(GUIDE_FIELD_LABELS[k], eff[k], ovKeys.has(k))).join('')}
        ${eff.extra ? `<div style="margin-top:8px; padding:10px 12px; border-left:3px solid var(--warning); background:rgba(255,255,255,.02); font-size:12.5px; white-space:pre-wrap;"><b>추가 지침</b><br>${esc(eff.extra)}</div>` : ''}
        <div class="variant-actions" style="margin-top:10px;">
          <button class="btn btn-sm edit-guide" data-platform="${p.platform}">지침 수정</button>
          ${p.override ? `<button class="btn btn-sm btn-danger reset-guide" data-platform="${p.platform}">기본값 복원</button>
            <span style="font-size:11.5px; color:var(--muted)">수정: ${fmt.datetime(p.updated_at)}</span>` : ''}
        </div>
      </div>`;
    }).join('')}

    <div class="help-note">
      <b>지침이 수익을 좌우합니다</b><br>
      ① 같은 원고를 여러 플랫폼에 그대로 올리면 중복 콘텐츠로 검색 노출이 막힙니다 — 플랫폼마다 톤·구조를 다르게 유지하세요.<br>
      ② 블로그 지침의 [이미지: …] 마커 지시를 지우면 삽화 자동 생성·삽입이 되지 않습니다.<br>
      ③ 인스타그램은 "=== 카드 N ===" 구분을 유지해야 카드뉴스가 장별로 렌더링됩니다.<br>
      ④ 추가 지침에는 브랜드 말투, 금지 표현, 꼭 넣을 CTA 문구 등을 자유롭게 적으세요.
    </div>
  `;

  function editModal(g) {
    const isMaster = g.platform === '_master';
    const cur = { ...(isMaster ? { notes: g.override?.notes || g.default.notes } : g.effective), extra: (g.override?.extra || g.effective?.extra || '') };
    const ta = (key, label, value, rows = 2, hint = '') => `
      <div class="field">
        <label>${label}</label>
        <textarea data-gk="${key}" rows="${rows}" style="width:100%; resize:vertical;">${esc(value || '')}</textarea>
        ${hint ? `<div class="hint">${hint}</div>` : ''}
      </div>`;
    openModal({
      title: `지침 수정 — ${esc(g.name)}`,
      wide: true,
      body: isMaster
        ? ta('notes', '작성 원칙', cur.notes, 6) +
          ta('extra', '운영자 추가 지침', cur.extra, 4, '예: 우리 블로그 말투는 ~해요체, 마지막 문단에 뉴스레터 구독 유도 문구를 넣는다 등')
        : ta('format', GUIDE_FIELD_LABELS.format, cur.format, 1, 'html · text · cards · thread · script 중 하나') +
          ta('tone', GUIDE_FIELD_LABELS.tone, cur.tone) +
          ta('structure', GUIDE_FIELD_LABELS.structure, cur.structure, 3) +
          ta('length', GUIDE_FIELD_LABELS.length, cur.length, 1) +
          ta('notes', GUIDE_FIELD_LABELS.notes, cur.notes, 3) +
          ta('extra', GUIDE_FIELD_LABELS.extra, cur.extra, 3, '기본 프로파일에 더해 반드시 지킬 지시사항 (말투·금지어·CTA 등)'),
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="g-save">저장</button>`,
    });
    document.getElementById('g-save').addEventListener('click', async () => {
      const data = {};
      document.querySelectorAll('[data-gk]').forEach((t) => { data[t.dataset.gk] = t.value.trim(); });
      try {
        await API.put(`/api/guidelines/${g.platform}`, data);
        closeModal(); toast('지침이 저장되었습니다. 다음 발행부터 적용됩니다.', 'good'); render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }

  el.querySelectorAll('.edit-guide').forEach((b) => b.addEventListener('click', () => {
    editModal(rows.find((r) => r.platform === b.dataset.platform));
  }));
  el.querySelectorAll('.reset-guide').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 플랫폼의 지침을 기본값으로 복원할까요?')) return;
    await API.del(`/api/guidelines/${b.dataset.platform}`);
    toast('기본 지침으로 복원되었습니다.'); render();
  }));
}
