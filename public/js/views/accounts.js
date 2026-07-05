// 계정 · 매칭 — 미디어 플랫폼 계정, 광고 플랫폼 계정 등록 및 상호 매칭

async function viewAccounts(el) {
  const [catalog, media, ads, categories] = await Promise.all([
    API.get('/api/catalog'),
    API.get('/api/media-accounts'),
    API.get('/api/ad-accounts'),
    API.get('/api/categories'),
  ]);

  const catName = (id) => categories.find((c) => c.id === id)?.name || '-';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">계정 · 매칭</div>
        <div class="page-desc">발행할 미디어 계정과 수익이 나오는 광고 플랫폼을 등록하고 서로 연결합니다</div>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn" id="export-accounts">⤓ 내보내기</button>
        <button class="btn" id="import-accounts">⤒ 가져오기</button>
        <input type="file" id="import-file" accept="application/json,.json" hidden />
        <button class="btn" id="add-ad">+ 광고 플랫폼</button>
        <button class="btn btn-primary" id="add-media">+ 미디어 계정</button>
      </div>
    </div>

    <div class="card">
      <div class="card-title">미디어 계정 (${media.length}) <span style="font-weight:400; color:var(--muted)">카테고리를 지정하면 해당 카테고리 자동발행 대상이 됩니다</span></div>
      ${media.length ? `
        <table class="tbl">
          <thead><tr><th>플랫폼</th><th>계정</th><th>카테고리</th><th>발행 방식</th><th>매칭된 광고</th><th></th></tr></thead>
          <tbody>
            ${media.map((m) => {
              const def = catalog.media[m.platform] || {};
              const pubMode = def.publish ? def.publish.mode : 'manual';
              const isAuto = ['api', 'browser'].includes(pubMode);
              const credsOk = isAuto && def.publish.credentialFields.filter((f) => f.required).every((f) => m.credentials[f.key]);
              return `
                <tr style="${m.active ? '' : 'opacity:.45'}">
                  <td><span class="badge badge-info">${esc(def.name || m.platform)}</span></td>
                  <td>
                    <div style="font-weight:600">${esc(m.name)}</div>
                    ${m.url ? `<div style="font-size:11.5px; color:var(--muted)">${esc(m.url)}</div>` : ''}
                  </td>
                  <td><span class="badge"><span class="bdot" style="background:${esc(m.category_color || '#555')}"></span>${esc(m.category_name || '미지정')}</span></td>
                  <td>${isAuto
                    ? (credsOk
                      ? (pubMode === 'browser' ? '<span class="badge badge-violet">브라우저 자동</span>' : '<span class="badge badge-ok">API 자동</span>')
                      : `<span class="badge badge-warn" title="${pubMode === 'browser' ? '로그인 정보 미등록 — 등록 전까지 수동/시뮬레이션 발행' : '자격증명 미등록 — 등록 전까지 수동/시뮬레이션 발행'}">${pubMode === 'browser' ? '자동 (로그인 필요)' : 'API (인증 필요)'}</span>`)
                    : '<span class="badge">반자동(복사)</span>'}</td>
                  <td>${m.matchings.length
                    ? m.matchings.map((mt) => `<span class="badge" style="margin:1px"><span class="bdot" style="background:${AD_COLORS[mt.ad_platform] || 'var(--s1)'}"></span>${esc(mt.ad_name)}</span>`).join(' ')
                    : '<span style="color:var(--muted); font-size:12px">없음</span>'}</td>
                  <td style="text-align:right; white-space:nowrap">
                    <button class="btn btn-sm match-media" data-id="${m.id}">🔗 매칭</button>
                    <button class="btn btn-sm edit-media" data-id="${m.id}">수정</button>
                    <button class="btn btn-sm btn-danger del-media" data-id="${m.id}">✕</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>` : '<div class="empty">등록된 미디어 계정이 없습니다</div>'}
    </div>

    <div class="card">
      <div class="card-title">광고 플랫폼 계정 (${ads.length})</div>
      ${ads.length ? `
        <table class="tbl">
          <thead><tr><th>플랫폼</th><th>계정</th><th>상태</th><th class="num">30일 수익</th><th>수익 연동</th><th>게재 미디어</th><th></th></tr></thead>
          <tbody>
            ${ads.map((a) => {
              const def = catalog.ad[a.platform] || {};
              let syncCell;
              if (!a.sync_available) {
                syncCell = '<span class="badge" title="공식 리포트 API가 없는 플랫폼 — 수익 화면에서 수동 입력">수동 입력</span>';
              } else if (a.sync_ready) {
                syncCell = `<span class="badge badge-ok" title="${esc(def.sync?.api || '')}">자동 연동</span>
                  ${a.last_sync_at ? `<div style="font-size:10.5px; color:var(--muted); margin-top:2px;">최근 ${fmt.datetime(a.last_sync_at)}</div>` : ''}
                  ${a.sync_error ? `<div style="font-size:10.5px; color:var(--critical); margin-top:2px;" title="${esc(a.sync_error)}">최근 동기화 실패</div>` : ''}`;
              } else {
                syncCell = `<span class="badge badge-warn" title="${esc((def.sync?.guide || '') + ' 필요 항목: ' + (def.sync?.required || []).join(', '))}">연동 가능 — 키 필요</span>`;
              }
              return `
                <tr>
                  <td><span class="badge"><span class="bdot" style="background:${AD_COLORS[a.platform] || 'var(--s1)'}"></span>${esc(def.name || a.platform)}</span></td>
                  <td style="font-weight:600">${esc(a.name)}
                    <div style="font-size:11px; color:var(--muted); font-weight:400">${esc(def.payout || '')}</div></td>
                  <td>${a.status === 'active' ? '<span class="badge badge-ok">활성</span>' : a.status === 'pending' ? '<span class="badge badge-warn">심사 중</span>' : `<span class="badge">${esc(a.status)}</span>`}</td>
                  <td class="num" style="font-weight:600">${fmt.won(a.revenue30d)}</td>
                  <td>${syncCell}</td>
                  <td>${a.matchings.length ? `${a.matchings.length}개 채널` : '<span style="color:var(--muted); font-size:12px">없음</span>'}</td>
                  <td style="text-align:right; white-space:nowrap">
                    ${a.sync_available && a.sync_ready ? `<button class="btn btn-sm btn-good sync-ad" data-id="${a.id}">⟳ 동기화</button>` : ''}
                    <button class="btn btn-sm edit-ad" data-id="${a.id}">수정</button>
                    <button class="btn btn-sm btn-danger del-ad" data-id="${a.id}">✕</button>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>` : '<div class="empty">등록된 광고 플랫폼이 없습니다</div>'}
    </div>

    <div class="help-note">
      <b>플랫폼 × 광고 궁합 가이드</b><br>
      ${Object.entries(catalog.ad).map(([k, a]) =>
        `<span class="badge" style="margin:2px"><span class="bdot" style="background:${AD_COLORS[k] || 'var(--s1)'}"></span>${esc(a.name)}</span> ${esc(a.note)}`,
      ).join('<br>')}
    </div>
  `;

  // ---- 미디어 계정 추가/수정 ----
  function credFieldsHTML(def, existing = {}) {
    return (def.publish.credentialFields || []).map((f) => `
      <div class="field">
        <label>${esc(f.label)}${f.required ? ' *' : ''}</label>
        <input data-cred="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${esc(existing[f.key] || '')}" autocomplete="off" />
      </div>`).join('');
  }

  function mediaModal(existing = null) {
    const platforms = Object.entries(catalog.media);
    openModal({
      title: existing ? '미디어 계정 수정' : '미디어 계정 등록',
      body: `
        <div class="field"><label>플랫폼</label>
          <select id="m-platform" ${existing ? 'disabled' : ''}>
            ${platforms.map(([k, p]) => `<option value="${k}" ${existing && existing.platform === k ? 'selected' : ''}>${esc(p.name)} — ${p.publish.mode === 'api' ? 'API 자동발행' : p.publish.mode === 'browser' ? '브라우저 자동발행' : '반자동(복사)'}</option>`).join('')}
          </select></div>
        <div class="field"><label>계정 이름 *</label><input id="m-name" value="${esc(existing?.name || '')}" placeholder="예: 이슈스팟 블로그" /></div>
        <div class="field"><label>담당 카테고리</label>
          <select id="m-cat">
            <option value="">미지정</option>
            ${categories.map((c) => `<option value="${c.id}" ${existing?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
          <div class="hint">이슈 계정에는 이슈만, 생활정보 계정에는 생활정보만 — 카테고리 지정 시 해당 주제만 발행됩니다.</div></div>
        <div class="field"><label>URL</label><input id="m-url" value="${esc(existing?.url || '')}" placeholder="https://" /></div>
        <div id="m-creds">${credFieldsHTML(catalog.media[existing?.platform || platforms[0][0]], existing?.credentials || {})}</div>
        <div class="hint" id="m-mode-hint"></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="m-save">${existing ? '저장' : '등록'}</button>`,
    });
    const sel = document.getElementById('m-platform');
    const updateHint = () => {
      const def = catalog.media[sel.value];
      document.getElementById('m-mode-hint').textContent = def.publish.mode === 'api'
        ? `이 플랫폼은 ${def.publish.api}로 자동 발행됩니다. 자격증명이 없으면 등록 전까지 수동 발행으로 처리됩니다.`
        : def.publish.mode === 'browser'
          ? `${def.publish.manualReason || ''} 로그인 세션은 이 서버에만 저장되며, 첫 발행 시 자동 로그인합니다.`
          : (def.publish.manualReason || '');
    };
    sel.addEventListener('change', () => {
      document.getElementById('m-creds').innerHTML = credFieldsHTML(catalog.media[sel.value]);
      updateHint();
    });
    updateHint();
    document.getElementById('m-save').addEventListener('click', async () => {
      const credentials = {};
      document.querySelectorAll('#m-creds [data-cred]').forEach((i) => { if (i.value.trim()) credentials[i.dataset.cred] = i.value.trim(); });
      const payload = {
        platform: sel.value,
        name: document.getElementById('m-name').value.trim(),
        category_id: document.getElementById('m-cat').value ? Number(document.getElementById('m-cat').value) : null,
        url: document.getElementById('m-url').value.trim(),
        credentials,
        active: 1,
      };
      try {
        if (existing) await API.put(`/api/media-accounts/${existing.id}`, payload);
        else await API.post('/api/media-accounts', payload);
        closeModal(); toast('저장되었습니다.', 'good'); render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }

  el.querySelector('#add-media').addEventListener('click', () => mediaModal());
  el.querySelectorAll('.edit-media').forEach((b) => b.addEventListener('click', () => {
    mediaModal(media.find((m) => m.id === Number(b.dataset.id)));
  }));
  el.querySelectorAll('.del-media').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 미디어 계정을 삭제할까요? 매칭도 함께 삭제됩니다.')) return;
    await API.del(`/api/media-accounts/${b.dataset.id}`); toast('삭제되었습니다.'); render();
  }));

  // ---- 광고 계정 추가/수정 ----
  function adModal(existing = null) {
    const platforms = Object.entries(catalog.ad);
    openModal({
      title: existing ? '광고 플랫폼 수정' : '광고 플랫폼 등록',
      body: `
        <div class="field"><label>광고 플랫폼</label>
          <select id="a-platform" ${existing ? 'disabled' : ''}>
            ${platforms.map(([k, p]) => `<option value="${k}" ${existing && existing.platform === k ? 'selected' : ''}>${esc(p.name)} (${esc(p.payout)})</option>`).join('')}
          </select></div>
        <div class="field"><label>계정 이름 *</label><input id="a-name" value="${esc(existing?.name || '')}" placeholder="예: 애드센스 메인" /></div>
        <div class="field"><label>상태</label>
          <select id="a-status">
            ${['active', 'pending', 'suspended'].map((s) => `<option value="${s}" ${existing?.status === s ? 'selected' : ''}>${s === 'active' ? '활성' : s === 'pending' ? '심사 중' : '중지'}</option>`).join('')}
          </select></div>
        <div id="a-creds"></div>
        <div class="hint" id="a-note"></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="a-save">${existing ? '저장' : '등록'}</button>`,
    });
    const sel = document.getElementById('a-platform');
    const fillCreds = () => {
      const def = catalog.ad[sel.value];
      document.getElementById('a-creds').innerHTML = (def.credentialFields || []).map((f) => `
        <div class="field"><label>${esc(f.label)}</label>
          <input data-cred="${f.key}" type="${f.secret ? 'password' : 'text'}" value="${esc(existing?.credentials?.[f.key] || '')}" autocomplete="off" /></div>`).join('');
      document.getElementById('a-note').textContent = def.note || '';
    };
    sel.addEventListener('change', fillCreds);
    fillCreds();
    document.getElementById('a-save').addEventListener('click', async () => {
      const credentials = {};
      document.querySelectorAll('#a-creds [data-cred]').forEach((i) => { if (i.value.trim()) credentials[i.dataset.cred] = i.value.trim(); });
      const payload = {
        platform: sel.value,
        name: document.getElementById('a-name').value.trim(),
        status: document.getElementById('a-status').value,
        credentials,
      };
      try {
        if (existing) await API.put(`/api/ad-accounts/${existing.id}`, payload);
        else await API.post('/api/ad-accounts', payload);
        closeModal(); toast('저장되었습니다.', 'good'); render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }

  el.querySelector('#add-ad').addEventListener('click', () => adModal());
  el.querySelectorAll('.edit-ad').forEach((b) => b.addEventListener('click', () => {
    adModal(ads.find((a) => a.id === Number(b.dataset.id)));
  }));

  // ---- 내보내기 / 가져오기 ----
  el.querySelector('#export-accounts').addEventListener('click', () => {
    openModal({
      title: '계정·매칭 내보내기',
      body: `
        <p style="font-size:12.5px; color:var(--text-2); margin-bottom:14px;">현재 등록된 미디어 계정 ${media.length}개, 광고 계정 ${ads.length}개와 매칭·카테고리 연결을 JSON 파일로 저장합니다.</p>
        <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
          <label class="switch"><input type="checkbox" id="exp-creds" checked /><span class="track"></span></label>
          <div><b style="font-size:13px;">자격증명 포함</b>
          <div class="hint">비밀번호·API 키·토큰이 파일에 평문으로 담깁니다. 백업·기기 이전용으로만 안전하게 보관하세요. 끄면 계정 목록만 내보냅니다.</div></div>
        </div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="exp-go">내보내기</button>`,
    });
    document.getElementById('exp-go').addEventListener('click', async () => {
      const withCreds = document.getElementById('exp-creds').checked;
      try {
        const data = await API.get(`/api/accounts/export?credentials=${withCreds ? '1' : '0'}`);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mediadot-accounts-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(url);
        closeModal();
        toast(`내보내기 완료 — 미디어 ${data.counts.media} · 광고 ${data.counts.ad} · 매칭 ${data.counts.matchings}`, 'good');
      } catch (e) { toast(e.message, 'bad'); }
    });
  });

  const importFile = el.querySelector('#import-file');
  el.querySelector('#import-accounts').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch { toast('JSON 파일을 읽을 수 없습니다.', 'bad'); importFile.value = ''; return; }
    if (data.type !== 'mediadot-accounts') { toast('미디어닷 계정 내보내기 파일이 아닙니다.', 'bad'); importFile.value = ''; return; }

    const c = data.counts || {};
    openModal({
      title: '계정·매칭 가져오기',
      body: `
        <p style="font-size:12.5px; color:var(--text-2); margin-bottom:12px;">
          파일: 미디어 ${c.media || 0}개 · 광고 ${c.ad || 0}개 · 매칭 ${c.matchings || 0}개
          ${data.includes_credentials ? '<span class="badge badge-ok" style="margin-left:4px">자격증명 포함</span>' : '<span class="badge" style="margin-left:4px">자격증명 없음</span>'}
        </p>
        <p style="font-size:12px; color:var(--muted); margin-bottom:14px;">같은 플랫폼·이름의 계정이 이미 있으면 새로 만들지 않고 갱신합니다. 카테고리는 이름으로 연결(없으면 생성)됩니다.</p>
        <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
          <label class="switch"><input type="checkbox" id="imp-over" ${data.includes_credentials ? 'checked' : ''} ${data.includes_credentials ? '' : 'disabled'} /><span class="track"></span></label>
          <div><b style="font-size:13px;">기존 계정의 자격증명 덮어쓰기</b>
          <div class="hint">끄면 이미 등록된 계정의 비밀번호·키는 그대로 두고 카테고리·매칭만 갱신합니다.</div></div>
        </div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="imp-go">가져오기</button>`,
    });
    const cleanup = () => { importFile.value = ''; };
    document.querySelector('.modal-overlay').addEventListener('click', (ev) => {
      if (ev.target.classList.contains('modal-overlay') || ev.target.hasAttribute('data-close')) cleanup();
    });
    document.getElementById('imp-go').addEventListener('click', async () => {
      const overwriteCredentials = document.getElementById('imp-over').checked;
      try {
        const r = await API.post('/api/accounts/import', { data, overwriteCredentials });
        closeModal(); cleanup();
        const w = r.warnings && r.warnings.length ? ` (경고 ${r.warnings.length}건)` : '';
        toast(`가져오기 완료 — 미디어 +${r.media.created}/갱신 ${r.media.updated}, 광고 +${r.ad.created}/갱신 ${r.ad.updated}, 매칭 +${r.matchings.created}${w}`, 'good');
        render();
      } catch (e) { toast(e.message, 'bad'); }
    });
  });
  el.querySelectorAll('.del-ad').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('이 광고 계정을 삭제할까요? 수익 기록도 함께 삭제됩니다.')) return;
    await API.del(`/api/ad-accounts/${b.dataset.id}`); toast('삭제되었습니다.'); render();
  }));

  el.querySelectorAll('.sync-ad').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '동기화 중…';
    try {
      const r = await API.post(`/api/ad-accounts/${b.dataset.id}/sync`);
      toast(`동기화 완료 — 최근 ${r.days}일 중 ${r.saved}일치, 합계 ${fmt.wonFull(r.total)}`, 'good');
    } catch (e) {
      toast(e.message, 'bad');
    }
    render();
  }));

  // ---- 매칭 ----
  el.querySelectorAll('.match-media').forEach((b) => b.addEventListener('click', () => {
    const m = media.find((x) => x.id === Number(b.dataset.id));
    const def = catalog.media[m.platform];
    const matchedIds = new Set(m.matchings.map((mt) => mt.ad_account_id));
    const compatible = ads.filter((a) => (catalog.ad[a.platform]?.attach || []).includes(m.platform));
    const others = ads.filter((a) => !(catalog.ad[a.platform]?.attach || []).includes(m.platform));
    const row = (a, warn) => `
      <div class="variant-card" style="padding:10px 14px; display:flex; align-items:center; gap:10px;">
        <span class="badge"><span class="bdot" style="background:${AD_COLORS[a.platform] || 'var(--s1)'}"></span>${esc(a.name)}</span>
        ${warn ? '<span class="badge badge-warn" title="이 플랫폼 조합은 일반적이지 않습니다">비권장</span>' : ''}
        <span style="flex:1"></span>
        ${matchedIds.has(a.id)
          ? `<button class="btn btn-sm btn-danger unmatch" data-mid="${m.matchings.find((mt) => mt.ad_account_id === a.id)?.id}">연결 해제</button>`
          : `<button class="btn btn-sm btn-good do-match" data-ad="${a.id}">연결</button>`}
      </div>`;
    openModal({
      title: `광고 매칭 — ${m.name} (${def.name})`,
      wide: true,
      body: `
        <p style="font-size:12.5px; color:var(--muted); margin-bottom:12px;">이 미디어 계정에서 발생하는 수익을 어느 광고 플랫폼과 연결할지 설정합니다.</p>
        ${compatible.length ? `<div style="font-size:12px; color:var(--text-2); font-weight:600; margin-bottom:6px;">권장 조합</div>${compatible.map((a) => row(a, false)).join('')}` : ''}
        ${others.length ? `<div style="font-size:12px; color:var(--muted); font-weight:600; margin:12px 0 6px;">기타</div>${others.map((a) => row(a, true)).join('')}` : ''}
        ${!ads.length ? '<div class="empty">먼저 광고 플랫폼 계정을 등록하세요</div>' : ''}`,
      footer: `<button class="btn" data-close>닫기</button>`,
    });
    document.querySelectorAll('.do-match').forEach((mb) => mb.addEventListener('click', async () => {
      const r = await API.post('/api/matchings', { media_account_id: m.id, ad_account_id: Number(mb.dataset.ad) });
      if (r.warning) toast(r.warning, 'info'); else toast('매칭되었습니다.', 'good');
      closeModal(); render();
    }));
    document.querySelectorAll('.unmatch').forEach((mb) => mb.addEventListener('click', async () => {
      await API.del(`/api/matchings/${mb.dataset.mid}`); toast('연결이 해제되었습니다.');
      closeModal(); render();
    }));
  }));
}
