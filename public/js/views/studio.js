// 콘텐츠 스튜디오 — 주제 관리 + 자동발행 실행 + 콘텐츠 목록/상세

async function viewStudio(el, sub) {
  if (sub && sub[0] === 'content' && sub[1]) return viewContentDetail(el, Number(sub[1]));

  const [categories, topics, contents, settings, history] = await Promise.all([
    API.get('/api/categories'),
    API.get('/api/topics?status=pool'),
    API.get('/api/contents'),
    API.get('/api/settings'),
    API.get('/api/topics/history'),
  ]);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">콘텐츠 스튜디오</div>
        <div class="page-desc">주제 선정 → 원고 작성 → 플랫폼별 리라이팅 → 배포까지 자동화</div>
      </div>
    </div>

    <div class="card" style="border-color: rgba(57,135,229,.35);">
      <div class="card-title" style="color:var(--text)">⚡ 자동발행 실행</div>
      <div class="pipe-steps">
        <span class="pipe-step active"><span class="pnum">1</span>주제 선정</span><span class="pipe-arrow">─►</span>
        <span class="pipe-step"><span class="pnum">2</span>원고 작성</span><span class="pipe-arrow">─►</span>
        <span class="pipe-step"><span class="pnum">3</span>플랫폼별 리라이팅</span><span class="pipe-arrow">─►</span>
        <span class="pipe-step"><span class="pnum">4</span>정책 검사</span><span class="pipe-arrow">─►</span>
        <span class="pipe-step"><span class="pnum">5</span>${settings.publish_mode === 'auto' ? '분산 예약 발행' : '승인 후 발행'}</span>
      </div>
      <div class="field-row" style="margin-top:14px;">
        <div class="field">
          <label>카테고리</label>
          <select id="run-category">
            ${categories.map((c) => `<option value="${c.id}">${esc(c.name)} (계정 ${c.accounts}개 · 주제 ${c.topics}건)</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label>주제</label>
          <select id="run-topic"><option value="">자동 선택 (풀에서 꺼내거나 새로 생성)</option></select>
        </div>
        <div class="field">
          <label>발행 방식</label>
          <select id="run-mode">
            <option value="">기본 설정 (${settings.publish_mode === 'auto' ? '완전 자동' : '컨펌 후 발행'})</option>
            <option value="confirm">이번만: 컨펌 후 발행</option>
            <option value="auto">이번만: 자동 분산 발행</option>
          </select>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:12px;">
        <button class="btn btn-primary btn-lg" id="run-pipeline">⚡ 자동발행 시작</button>
        <span style="font-size:12px; color:var(--muted);">
          ${settings.publish_mode === 'auto'
            ? `자동 모드: 리라이팅 완료 후 계정별 ${esc(settings.publish_gap_min)}분 간격으로 분산 예약됩니다.`
            : '컨펌 모드: 리라이팅 완료 후 발행 큐에서 검토·승인해야 발행됩니다.'}
        </span>
      </div>
      <div class="checklist" id="preflight"></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px;">
      <div class="card">
        <div class="card-title">주제 풀 (${topics.length})
          <span style="display:flex; gap:6px;">
            <button class="btn btn-sm" id="add-topic">+ 직접 추가</button>
            <button class="btn btn-sm btn-primary" id="gen-topics">✦ AI 주제 발굴</button>
          </span>
        </div>
        <div id="topic-list">
          ${topics.length ? topics.map((t) => `
            <div class="variant-card" style="padding:11px 14px;">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="badge"><span class="bdot" style="background:${esc(t.category_color || '#888')}"></span>${esc(t.category_name || '-')}</span>
                <b style="flex:1; font-size:13px;">${esc(t.title)}</b>
                <button class="btn btn-sm use-topic" data-cat="${t.category_id}" data-id="${t.id}">이 주제로 발행</button>
                <button class="btn btn-sm btn-danger del-topic" data-id="${t.id}">✕</button>
              </div>
              ${t.keywords ? `<div style="font-size:11.5px; color:var(--muted); margin-top:4px;">${esc(t.keywords)}${t.angle ? ` — ${esc(t.angle)}` : ''}</div>` : ''}
            </div>`).join('') : '<div class="empty">주제 풀이 비어 있습니다. AI 주제 발굴을 눌러보세요.</div>'}
        </div>
      </div>

      <div class="card">
        <div class="card-title">생성된 콘텐츠 (${contents.length})</div>
        ${contents.length ? `
          <table class="tbl">
            <thead><tr><th>제목</th><th>상태</th><th class="num">발행</th><th></th></tr></thead>
            <tbody>
              ${contents.map((c) => `
                <tr>
                  <td>
                    <div style="font-weight:600">${esc(c.title || '(생성 중…)')}</div>
                    <div style="font-size:11.5px; color:var(--muted)">${esc(c.category_name || '')} · ${fmt.datetime(c.created_at)}</div>
                  </td>
                  <td>${statusBadge(c.status)}</td>
                  <td class="num">${c.published_count}/${c.variant_count}</td>
                  <td style="text-align:right"><a class="btn btn-sm" href="#/studio/content/${c.id}">상세</a></td>
                </tr>`).join('')}
            </tbody>
          </table>` : '<div class="empty">아직 콘텐츠가 없습니다</div>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px;">
      <div class="card-title">📚 발행 이력 (${history.length})
        <span style="font-weight:400; color:var(--muted)">이미 다룬 주제 — AI 주제 발굴과 자동발행에서 자동으로 중복이 걸러집니다</span>
      </div>
      ${history.length ? `
        <table class="tbl">
          <thead><tr><th>주제</th><th>카테고리</th><th>발행일</th><th class="num">발행 채널</th><th>상태</th><th></th></tr></thead>
          <tbody>
            ${history.map((h) => `
              <tr>
                <td>
                  <div style="font-weight:600">${esc(h.title)}</div>
                  ${h.keywords ? `<div style="font-size:11px; color:var(--muted)">${esc(h.keywords)}</div>` : ''}
                </td>
                <td><span class="badge"><span class="bdot" style="background:${esc(h.category_color || '#888')}"></span>${esc(h.category_name || '-')}</span></td>
                <td style="font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums;">${h.last_published_at ? fmt.datetime(h.last_published_at) : '<span style="color:var(--muted)">미발행</span>'}</td>
                <td class="num">${h.published_channels || 0}</td>
                <td>${h.content_status ? statusBadge(h.content_status) : '<span class="badge">사용됨</span>'}</td>
                <td style="text-align:right">${h.content_id ? `<a class="btn btn-sm" href="#/studio/content/${h.content_id}">콘텐츠 →</a>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : '<div class="empty">아직 발행한 주제가 없습니다</div>'}
    </div>
  `;

  // 카테고리 변경 시 주제 목록 필터
  const catSel = el.querySelector('#run-category');
  const topicSel = el.querySelector('#run-topic');
  function fillTopics() {
    const cid = Number(catSel.value);
    topicSel.innerHTML = '<option value="">자동 선택 (풀에서 꺼내거나 새로 생성)</option>' +
      topics.filter((t) => t.category_id === cid)
        .map((t) => `<option value="${t.id}">${esc(t.title)}</option>`).join('');
  }
  // 발행 전 자동 점검 (프리플라이트) — 실패 요인을 실행 전에 체크리스트로 보여준다
  async function loadPreflight() {
    const box = el.querySelector('#preflight');
    if (!catSel.value) { box.innerHTML = ''; return; }
    try {
      const pf = await API.get(`/api/preflight?category_id=${catSel.value}`);
      box.innerHTML = pf.items.map((i) => `
        <div class="check-item ${i.ok ? 'ok' : (i.level || 'warn')}">
          <span class="ck">${i.ok ? '✓' : i.level === 'error' ? '✕' : '⚠'}</span>
          <span><b>${esc(i.label)}</b> — ${esc(i.detail)}</span>
          ${i.fix ? `<a class="fix-link" href="${esc(i.fix)}">해결하러 가기 →</a>` : ''}
        </div>`).join('');
      el.querySelector('#run-pipeline').disabled = !pf.ok;
    } catch { box.innerHTML = ''; }
  }

  catSel.addEventListener('change', () => { fillTopics(); loadPreflight(); });
  fillTopics();
  loadPreflight();

  el.querySelector('#run-pipeline').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '파이프라인 시작 중…';
    try {
      const r = await API.post('/api/pipeline/run', {
        category_id: Number(catSel.value),
        topic_id: topicSel.value ? Number(topicSel.value) : null,
        mode: el.querySelector('#run-mode').value || null,
      });
      toast('자동발행이 시작되었습니다.', 'good');
      location.hash = `#/studio/content/${r.content_id}`;
    } catch (err) {
      toast(err.message, 'bad');
      btn.disabled = false; btn.textContent = '⚡ 자동발행 시작';
    }
  });

  el.querySelector('#gen-topics').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true; btn.textContent = '발굴 중…';
    try {
      const r = await API.post('/api/topics/generate', { category_id: Number(catSel.value), count: 5 });
      toast(`주제 ${r.ids.length}건이 추가되었습니다.${r.demo ? ' (데모 모드 — API 키 등록 시 실제 주제 발굴)' : ''}`, 'good');
      render();
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = '✦ AI 주제 발굴'; }
  });

  el.querySelector('#add-topic').addEventListener('click', () => {
    openModal({
      title: '주제 직접 추가',
      body: `
        <div class="field"><label>카테고리</label>
          <select id="m-cat">${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label>주제 제목 *</label><input id="m-title" placeholder="예: 여름 전기요금 아끼는 에어컨 설정법" /></div>
        <div class="field"><label>핵심 키워드</label><input id="m-kw" placeholder="콤마로 구분" /></div>
        <div class="field"><label>다룰 관점</label><input id="m-angle" placeholder="남들과 다르게 다룰 포인트" /></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="m-save">추가</button>`,
    });
    document.getElementById('m-save').addEventListener('click', async () => {
      const payload = {
        category_id: Number(document.getElementById('m-cat').value),
        title: document.getElementById('m-title').value.trim(),
        keywords: document.getElementById('m-kw').value.trim(),
        angle: document.getElementById('m-angle').value.trim(),
      };
      try {
        await API.post('/api/topics', payload);
        closeModal(); toast('주제가 추가되었습니다.', 'good'); render();
      } catch (err) {
        // 중복 주제 경고 — 사용자가 원하면 그대로 등록(force)
        if (String(err.message).includes('비슷한 주제')) {
          if (confirm(`${err.message}\n\n같은 주제를 다시 발행하면 중복 콘텐츠로 노출이 떨어질 수 있습니다. 그래도 추가할까요?`)) {
            try {
              await API.post('/api/topics', { ...payload, force: true });
              closeModal(); toast('주제가 추가되었습니다. (중복 경고 무시)', 'info'); render();
            } catch (e2) { toast(e2.message, 'bad'); }
          }
        } else { toast(err.message, 'bad'); }
      }
    });
  });

  el.querySelectorAll('.del-topic').forEach((btn) => btn.addEventListener('click', async () => {
    await API.del(`/api/topics/${btn.dataset.id}`); render();
  }));
  el.querySelectorAll('.use-topic').forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = '실행 중…';
    try {
      const r = await API.post('/api/pipeline/run', { category_id: Number(btn.dataset.cat), topic_id: Number(btn.dataset.id) });
      location.hash = `#/studio/content/${r.content_id}`;
    } catch (err) { toast(err.message, 'bad'); btn.disabled = false; btn.textContent = '이 주제로 발행'; }
  }));
}

// ---------- 콘텐츠 상세 ----------
async function viewContentDetail(el, id) {
  const c = await API.get(`/api/contents/${id}`);
  const inProgress = ['generating', 'rewriting'].includes(c.status);
  const policy = c.policy_report || {};
  const policyBadge = policy.level === 'high' ? '<span class="badge badge-danger">정책 위험 높음</span>'
    : policy.level === 'medium' ? '<span class="badge badge-warn">정책 주의</span>'
    : policy.level === 'low' ? '<span class="badge badge-warn">확인 필요</span>'
    : policy.level === 'ok' ? '<span class="badge badge-ok">정책 통과</span>' : '';

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title" style="font-size:18px;">${esc(c.title || '(원고 생성 중…)')}</div>
        <div class="page-desc">
          <span class="badge"><span class="bdot" style="background:${esc(c.category_color || '#888')}"></span>${esc(c.category_name || '-')}</span>
          ${statusBadge(c.status)} ${policyBadge}
          <span style="margin-left:6px;">${fmt.datetime(c.created_at)}</span>
        </div>
      </div>
      <a class="btn" href="#/studio">← 스튜디오</a>
    </div>

    <div class="card">
      ${renderStepper(c.progress || {}, c.status)}
      ${inProgress && c.progress?.current ? `<div style="font-size:12.5px; color:#9ec5f4; margin-top:9px;">⏳ 지금: ${esc(c.progress.current)} 리라이팅 중 — 자동으로 새로고침됩니다.</div>`
        : inProgress ? '<div style="font-size:12.5px; color:#9ec5f4; margin-top:9px;">⏳ 파이프라인 진행 중 — 자동으로 새로고침됩니다.</div>' : ''}
      ${c.status === 'failed' ? `<div style="font-size:12.5px; color:var(--critical); margin-top:9px;">✕ 실패: ${esc(c.error)}</div>` : ''}
    </div>

    ${policy.hits && policy.hits.length ? `
      <div class="card">
        <div class="card-title">정책 검사 결과 — 광고 게재 제한 위험 표현 ${policy.level === 'high' ? '<span class="badge badge-danger">자동 발행 차단됨 — 수정 후 발행하세요</span>' : ''}</div>
        ${policy.hits.map((h) => `
          <div class="policy-hit">
            <b>"${esc(h.word)}"</b> — ${esc(h.category)} (${h.level === 'high' ? '높음' : h.level === 'medium' ? '중간' : '낮음'})
            ${h.context ? `<div style="color:var(--muted); font-size:11.5px; margin-top:3px;">…문맥: ${esc(h.context)}</div>` : ''}
            ${h.suggestion ? `<div style="margin-top:3px;">💡 이렇게 바꿔보세요: <span style="color:var(--good)">"${esc(h.suggestion)}"</span></div>` : ''}
            <div style="color:var(--muted); margin-top:3px;">${esc(h.advice)}</div>
          </div>`).join('')}
      </div>` : ''}

    ${c.body ? `
      <div class="card">
        <div class="card-title">마스터 원고 <span style="font-weight:400; color:var(--muted)">모든 플랫폼 리라이팅의 원본</span></div>
        ${c.summary ? `<p style="font-size:13px; color:var(--text-2); margin-bottom:10px;">${esc(c.summary)}</p>` : ''}
        <div class="variant-body" id="master-body">${esc(c.body)}</div>
        <div class="variant-actions">
          <button class="btn btn-sm" onclick="this.closest('.card').querySelector('.variant-body').classList.toggle('expanded'); this.textContent = this.textContent === '전체 보기' ? '접기' : '전체 보기';">전체 보기</button>
          ${c.tags ? `<span style="font-size:12px; color:var(--muted)">태그: ${esc(c.tags)}</span>` : ''}
        </div>
      </div>` : ''}

    <div class="card">
      <div class="card-title">플랫폼별 변형 (${c.variants.length})</div>
      ${c.variants.length ? c.variants.map((v) => renderVariantCard(v)).join('') : '<div class="empty">리라이팅 대기 중…</div>'}
    </div>
  `;

  bindVariantActions(el, () => viewContentDetail(el, id));

  if (inProgress) {
    clearTimeout(window.__detailPoll);
    window.__detailPoll = setTimeout(() => {
      if (location.hash === `#/studio/content/${id}`) viewContentDetail(el, id);
    }, 2500);
  }
}

function renderVariantCard(v, { showContent = false } = {}) {
  const extra = v.extra || {};
  const isDemo = extra.demo;
  const vPolicy = extra.policy || {};
  return `
    <div class="variant-card" data-vid="${v.id}">
      <div class="variant-head">
        <span class="badge badge-info">${esc(PLATFORM_NAMES[v.platform] || v.platform)}</span>
        <span style="font-size:12px; color:var(--muted)">${esc(v.account_name || '')}</span>
        ${statusBadge(v.status)}
        ${v.simulated ? '<span class="badge badge-violet">시뮬레이션</span>' : ''}
        ${isDemo ? '<span class="badge">데모 원고</span>' : ''}
        ${vPolicy.level && vPolicy.level !== 'ok' ? `<span class="badge badge-warn">정책 ${vPolicy.level === 'high' ? '위험' : '주의'}</span>` : ''}
        ${v.scheduled_at && v.status === 'scheduled' ? `<span style="font-size:11.5px; color:var(--muted)">예약: ${fmt.datetime(v.scheduled_at)}</span>` : ''}
        ${showContent && v.content_title ? `<span style="font-size:11.5px; color:var(--muted)">원본: ${esc(v.content_title)}</span>` : ''}
      </div>
      <div class="variant-title">${esc(v.title)}</div>
      ${v.body ? `<div class="variant-body">${esc(v.body)}</div>` : ''}
      ${(extra.cards || []).length ? `
        <div style="display:flex; gap:6px; margin-top:8px; overflow-x:auto; padding-bottom:4px;">
          ${extra.cards.map((c, i) => `<a href="${esc(c)}" target="_blank" rel="noopener" title="카드 ${i + 1} — 클릭해 원본 보기(다운로드해 수동 업로드 가능)"><img src="${esc(c)}" alt="카드 ${i + 1}" style="width:72px; height:72px; border-radius:6px; border:1px solid rgba(255,255,255,.08); object-fit:cover;" loading="lazy" /></a>`).join('')}
          <span style="font-size:11px; color:var(--muted); align-self:center; white-space:nowrap;">카드뉴스 ${extra.cards.length}장</span>
        </div>` : ''}
      ${(extra.images || []).length ? `
        <div style="display:flex; gap:6px; margin-top:8px; overflow-x:auto; padding-bottom:4px;">
          ${extra.images.map((im) => `<a href="${esc(im.file)}" target="_blank" rel="noopener" title="${esc(im.prompt)}"><img src="${esc(im.file)}" alt="${esc(im.prompt)}" style="width:96px; height:54px; border-radius:6px; border:1px solid rgba(255,255,255,.08); object-fit:cover;" loading="lazy" /></a>`).join('')}
          <span style="font-size:11px; color:var(--muted); align-self:center; white-space:nowrap;">본문 삽화 ${extra.images.length}장 — 발행 시 마커 위치에 삽입</span>
        </div>` : ''}
      ${extra.cta || extra.pinned_comment || extra.ad_snippet ? `
        <div class="variant-extras">
          ${extra.cta ? `<div class="extra-line"><span class="xk">CTA</span><span class="xv">${esc(extra.cta)}</span></div>` : ''}
          ${extra.pinned_comment ? `<div class="extra-line"><span class="xk">고정 댓글</span><span class="xv">${esc(extra.pinned_comment)}</span><button class="btn btn-sm act-copy-text" data-copy="${esc(extra.pinned_comment)}">복사</button></div>` : ''}
          ${extra.ad_snippet ? `<div class="extra-line"><span class="xk">광고 문구</span><span class="xv">${esc(extra.ad_snippet)}</span><button class="btn btn-sm act-copy-text" data-copy="${esc(extra.ad_snippet)}">복사</button></div>` : ''}
        </div>` : ''}
      ${v.error ? `<div style="color:var(--critical); font-size:12px; margin-top:6px;">✕ ${esc(v.error)}</div>` : ''}
      <div class="variant-actions">
        ${v.body ? `<button class="btn btn-sm act-expand">전체 보기</button>` : ''}
        ${['ready', 'approved'].includes(v.status) ? `
          <button class="btn btn-sm btn-good act-approve" data-id="${v.id}">✓ 승인 후 발행</button>
          <button class="btn btn-sm act-schedule" data-id="${v.id}">🕑 예약</button>
          <button class="btn btn-sm btn-danger act-reject" data-id="${v.id}">반려</button>` : ''}
        ${v.status === 'scheduled' ? `<button class="btn btn-sm btn-good act-approve" data-id="${v.id}">지금 발행</button>` : ''}
        ${v.status === 'manual' ? `
          <button class="btn btn-sm btn-primary act-copy" data-id="${v.id}">📋 원고 복사</button>
          <button class="btn btn-sm btn-good act-mark" data-id="${v.id}">발행 완료로 표시</button>` : ''}
        ${v.status === 'failed' ? `<button class="btn btn-sm act-approve" data-id="${v.id}">재시도</button>` : ''}
        ${v.status === 'published' && v.published_url ? `<a class="btn btn-sm" href="${esc(v.published_url)}" target="_blank" rel="noopener">발행 링크 ↗</a>` : ''}
        ${extra.notes ? `<span style="font-size:11.5px; color:var(--muted)">💡 ${esc(extra.notes)}</span>` : ''}
      </div>
    </div>`;
}

const PLATFORM_NAMES = {
  blogger: '블로그스팟', naver_blog: '네이버 블로그', tistory: '티스토리', wordpress: '워드프레스',
  instagram: '인스타그램', facebook: '페이스북', threads: '스레드', x_twitter: 'X(트위터)',
  tiktok: '틱톡', youtube: '유튜브',
};

function bindVariantActions(el, refresh) {
  el.querySelectorAll('.act-copy-text').forEach((b) => b.addEventListener('click', async () => {
    await navigator.clipboard.writeText(b.dataset.copy || '');
    toast('클립보드에 복사되었습니다.', 'good');
  }));
  el.querySelectorAll('.act-expand').forEach((b) => b.addEventListener('click', () => {
    const body = b.closest('.variant-card').querySelector('.variant-body');
    body.classList.toggle('expanded');
    b.textContent = body.classList.contains('expanded') ? '접기' : '전체 보기';
  }));
  el.querySelectorAll('.act-approve').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true; b.textContent = '발행 중…';
    try {
      const r = await API.post(`/api/variants/${b.dataset.id}/approve`);
      if (r.published) toast(`발행 완료${r.simulated ? ' (시뮬레이션)' : ''}`, 'good');
      else if (r.manual) toast(`수동 발행으로 전환: ${r.reason}`, 'info');
      else if (r.deferred) toast('일일 발행 상한 도달 — 내일로 예약되었습니다.', 'info');
      refresh();
    } catch (e) { toast(e.message, 'bad'); refresh(); }
  }));
  el.querySelectorAll('.act-reject').forEach((b) => b.addEventListener('click', async () => {
    await API.post(`/api/variants/${b.dataset.id}/reject`); toast('반려되었습니다.'); refresh();
  }));
  el.querySelectorAll('.act-schedule').forEach((b) => b.addEventListener('click', () => {
    const now = new Date(Date.now() + 60 * 60 * 1000);
    now.setMinutes(0, 0, 0);
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    openModal({
      title: '발행 예약',
      body: `<div class="field"><label>예약 시각</label><input type="datetime-local" id="m-at" value="${local}" /></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-primary" id="m-ok">예약</button>`,
    });
    document.getElementById('m-ok').addEventListener('click', async () => {
      try {
        await API.post(`/api/variants/${b.dataset.id}/schedule`, { at: document.getElementById('m-at').value });
        closeModal(); toast('예약되었습니다.', 'good'); refresh();
      } catch (e) { toast(e.message, 'bad'); }
    });
  }));
  el.querySelectorAll('.act-copy').forEach((b) => b.addEventListener('click', async () => {
    const card = b.closest('.variant-card');
    const title = card.querySelector('.variant-title')?.textContent || '';
    const body = card.querySelector('.variant-body')?.textContent || '';
    await navigator.clipboard.writeText(`${title}\n\n${body}`);
    toast('원고가 클립보드에 복사되었습니다. 플랫폼 에디터에 붙여넣으세요.', 'good');
  }));
  el.querySelectorAll('.act-mark').forEach((b) => b.addEventListener('click', () => {
    openModal({
      title: '발행 완료 처리',
      body: `<div class="field"><label>발행된 글 URL (선택)</label><input id="m-url" placeholder="https://..." /></div>`,
      footer: `<button class="btn" data-close>취소</button><button class="btn btn-good" id="m-ok">완료 처리</button>`,
    });
    document.getElementById('m-ok').addEventListener('click', async () => {
      await API.post(`/api/variants/${b.dataset.id}/mark-published`, { url: document.getElementById('m-url').value.trim() });
      closeModal(); toast('발행 완료로 처리되었습니다.', 'good'); refresh();
    });
  }));
}
