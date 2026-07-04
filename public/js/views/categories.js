// 카테고리 — 이슈/생활정보 등 주제 카테고리 관리. 계정과 주제가 카테고리 단위로 묶인다.

async function viewCategories(el) {
  const [categories, media] = await Promise.all([
    API.get('/api/categories'),
    API.get('/api/media-accounts'),
  ]);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">카테고리</div>
        <div class="page-desc">이슈는 이슈 계정으로, 생활정보는 생활정보 계정으로 — 주제와 채널을 카테고리로 묶습니다</div>
      </div>
      <button class="btn btn-primary" id="add-cat">+ 카테고리 추가</button>
    </div>

    <div class="grid grid-3">
      ${categories.map((c) => {
        const accs = media.filter((m) => m.category_id === c.id);
        return `
          <div class="card" style="border-top: 3px solid ${esc(c.color)}; margin-top:0;">
            <div class="card-title" style="color:var(--text); font-size:15px;">
              ${esc(c.name)}
              <span style="display:flex; gap:6px;">
                <button class="btn btn-sm edit-cat" data-id="${c.id}">수정</button>
                <button class="btn btn-sm btn-danger del-cat" data-id="${c.id}">✕</button>
              </span>
            </div>
            <p style="font-size:12.5px; color:var(--muted); margin-bottom:12px; min-height:36px;">${esc(c.description || '설명 없음')}</p>
            <div style="display:flex; gap:14px; font-size:12.5px; margin-bottom:12px;">
              <span>계정 <b>${c.accounts}</b></span>
              <span>주제 풀 <b>${c.topics}</b></span>
              <span>${c.auto_enabled ? '<span class="badge badge-violet">정기 자동발행 ON</span>' : '<span class="badge">정기 자동발행 OFF</span>'}</span>
            </div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; min-height:26px;">
              ${accs.length ? accs.map((m) => `<span class="badge badge-info">${esc(PLATFORM_NAMES[m.platform] || m.platform)} · ${esc(m.name.length > 10 ? m.name.slice(0, 10) + '…' : m.name)}</span>`).join('')
                : '<span style="font-size:12px; color:var(--muted)">연결된 계정 없음 — 계정 · 매칭에서 카테고리를 지정하세요</span>'}
            </div>
          </div>`;
      }).join('')}
    </div>

    <div class="help-note" style="margin-top:16px;">
      <b>운영 팁</b> — 카테고리마다 전용 계정을 두면 채널 정체성이 명확해져 검색 노출과 팔로워 충성도에 유리합니다.
      "정기 자동발행"을 켠 카테고리는 설정의 자동발행 시각마다 파이프라인이 자동 실행됩니다.
    </div>
  `;

  function catModal(existing = null) {
    const palette = ['#3987e5', '#199e70', '#c98500', '#9085e9', '#e66767', '#d55181', '#d95926'];
    openModal({
      title: existing ? '카테고리 수정' : '카테고리 추가',
      body: `
        <div class="field"><label>이름 *</label><input id="c-name" value="${esc(existing?.name || '')}" placeholder="예: 이슈, 생활정보, 재테크" /></div>
        <div class="field"><label>설명</label><textarea id="c-desc" placeholder="이 카테고리에서 다룰 콘텐츠 성격 — AI 주제 발굴과 원고 작성에 참고됩니다">${esc(existing?.description || '')}</textarea></div>
        <div class="field"><label>색상</label>
          <div style="display:flex; gap:8px;" id="c-colors">
            ${palette.map((p) => `<span data-color="${p}" style="width:26px; height:26px; border-radius:50%; background:${p}; cursor:pointer; border:2px solid ${existing?.color === p ? '#fff' : 'transparent'};"></span>`).join('')}
          </div></div>
        <div class="field" style="display:flex; align-items:center; gap:10px;">
          <label class="switch"><input type="checkbox" id="c-auto" ${existing?.auto_enabled ? 'checked' : ''} /><span class="track"></span></label>
          <div><b style="font-size:13px;">정기 자동발행 대상</b><div class="hint">설정의 자동발행 시각마다 이 카테고리의 파이프라인이 자동 실행됩니다.</div></div>
        </div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="c-save">${existing ? '저장' : '추가'}</button>`,
    });
    let color = existing?.color || palette[0];
    document.querySelectorAll('#c-colors [data-color]').forEach((s) => s.addEventListener('click', () => {
      color = s.dataset.color;
      document.querySelectorAll('#c-colors [data-color]').forEach((x) => { x.style.borderColor = 'transparent'; });
      s.style.borderColor = '#fff';
    }));
    document.getElementById('c-save').addEventListener('click', async () => {
      const payload = {
        name: document.getElementById('c-name').value.trim(),
        description: document.getElementById('c-desc').value.trim(),
        color,
        auto_enabled: document.getElementById('c-auto').checked ? 1 : 0,
      };
      try {
        if (existing) await API.put(`/api/categories/${existing.id}`, payload);
        else await API.post('/api/categories', payload);
        closeModal(); toast('저장되었습니다.', 'good'); render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }

  el.querySelector('#add-cat').addEventListener('click', () => catModal());
  el.querySelectorAll('.edit-cat').forEach((b) => b.addEventListener('click', () => {
    catModal(categories.find((c) => c.id === Number(b.dataset.id)));
  }));
  el.querySelectorAll('.del-cat').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('카테고리를 삭제할까요? 소속 주제는 함께 삭제되고 계정은 미지정 상태가 됩니다.')) return;
    await API.del(`/api/categories/${b.dataset.id}`); toast('삭제되었습니다.'); render();
  }));
}
