// 포토 오토 블로깅 — 다녀온 장소·여행·맛집 사진 + 사진별 설명으로 방문 후기를 자동 생성해 발행 큐로 보낸다.

let PB_PHOTOS = []; // [{ id, file(File), url, caption }]

async function viewPhotoBlog(el) {
  const [categories, settings] = await Promise.all([API.get('/api/categories'), API.get('/api/settings')]);
  PB_PHOTOS = [];

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">포토 오토 블로깅</div>
        <div class="page-desc">다녀온 장소·여행·맛집 사진과 간단한 설명만 넣으면, 방문 후기를 자동 생성해 발행 큐로 보냅니다</div>
      </div>
    </div>

    <div class="card" style="border-color: rgba(57,135,229,.35);">
      <div class="card-title" style="color:var(--text)">📸 사진으로 후기 만들기</div>
      <div class="field-row" style="margin-top:6px;">
        <div class="field" style="flex:2;">
          <label>제목 / 주제 <span style="color:var(--muted)">(어디를 다녀왔나요?)</span></label>
          <input id="pb-title" placeholder="예: 수원 화성 근처 국밥 맛집 'OO집' 다녀온 후기" />
        </div>
        <div class="field">
          <label>카테고리</label>
          <select id="pb-category">
            ${categories.length
              ? categories.map((c) => `<option value="${c.id}">${esc(c.name)} (계정 ${c.accounts}개)</option>`).join('')
              : '<option value="">카테고리를 먼저 만드세요</option>'}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field" style="flex:2;">
          <label>키워드 <span style="color:var(--muted)">(선택, 쉼표로 구분)</span></label>
          <input id="pb-keywords" placeholder="예: 수원맛집, 국밥, 화성행궁 근처" />
        </div>
        <div class="field">
          <label>발행 방식</label>
          <select id="pb-mode">
            <option value="">기본 설정 (${settings.publish_mode === 'auto' ? '완전 자동' : '컨펌 후 발행'})</option>
            <option value="confirm">이번만: 컨펌 후 발행</option>
            <option value="auto">이번만: 자동 분산 발행</option>
          </select>
        </div>
      </div>

      <div class="field">
        <label>사진 <span style="color:var(--muted)">(1장 이상 — 위에서 아래 순서대로 이야기가 흐릅니다)</span></label>
        <div class="pb-drop">
          <input type="file" id="pb-file" accept="image/*" multiple hidden />
          <button class="btn" id="pb-add">＋ 사진 추가</button>
          <span style="font-size:12px; color:var(--muted); margin-left:8px;">사진마다 간단한 설명을 달면 후기가 훨씬 자연스러워집니다</span>
        </div>
        <div id="pb-photos" class="pb-grid"></div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin-top:6px;">
        <button class="btn btn-primary btn-lg" id="pb-run">✨ 후기 생성 시작</button>
        <span id="pb-hint" style="font-size:12px; color:var(--muted);"></span>
      </div>
    </div>
  `;

  const fileInput = el.querySelector('#pb-file');
  el.querySelector('#pb-add').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    for (const f of fileInput.files) {
      if (!f.type.startsWith('image/')) continue;
      PB_PHOTOS.push({ id: Math.random().toString(36).slice(2), file: f, url: URL.createObjectURL(f), caption: '' });
    }
    fileInput.value = '';
    renderPhotoItems(el);
  });
  el.querySelector('#pb-run').addEventListener('click', () => submitPhotoBlog(el));
  renderPhotoItems(el);
}

function renderPhotoItems(el) {
  const wrap = el.querySelector('#pb-photos');
  if (!PB_PHOTOS.length) {
    wrap.innerHTML = '<div class="empty" style="margin-top:8px;">아직 추가된 사진이 없습니다</div>';
    return;
  }
  wrap.innerHTML = PB_PHOTOS.map((p, i) => `
    <div class="pb-photo" data-id="${p.id}">
      <div class="pb-thumb"><img src="${p.url}" alt="" /><span class="pb-idx">${i + 1}</span></div>
      <textarea class="pb-cap" data-id="${p.id}" rows="2" placeholder="사진 설명 (예: 입구 간판 / 대표 메뉴 국밥 한 그릇)">${esc(p.caption)}</textarea>
      <div class="pb-photo-actions">
        <button class="btn btn-sm pb-up" data-id="${p.id}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn btn-sm pb-down" data-id="${p.id}" ${i === PB_PHOTOS.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn btn-sm btn-danger pb-del" data-id="${p.id}">삭제</button>
      </div>
    </div>`).join('');

  wrap.querySelectorAll('.pb-cap').forEach((t) => t.addEventListener('input', () => {
    const p = PB_PHOTOS.find((x) => x.id === t.dataset.id);
    if (p) p.caption = t.value;
  }));
  wrap.querySelectorAll('.pb-del').forEach((b) => b.addEventListener('click', () => {
    PB_PHOTOS = PB_PHOTOS.filter((x) => x.id !== b.dataset.id);
    renderPhotoItems(el);
  }));
  wrap.querySelectorAll('.pb-up').forEach((b) => b.addEventListener('click', () => movePhotoItem(el, b.dataset.id, -1)));
  wrap.querySelectorAll('.pb-down').forEach((b) => b.addEventListener('click', () => movePhotoItem(el, b.dataset.id, 1)));
}

function movePhotoItem(el, id, dir) {
  const i = PB_PHOTOS.findIndex((x) => x.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= PB_PHOTOS.length) return;
  [PB_PHOTOS[i], PB_PHOTOS[j]] = [PB_PHOTOS[j], PB_PHOTOS[i]];
  renderPhotoItems(el);
}

async function submitPhotoBlog(el) {
  const title = el.querySelector('#pb-title').value.trim();
  const category_id = Number(el.querySelector('#pb-category').value);
  const keywords = el.querySelector('#pb-keywords').value.trim();
  const mode = el.querySelector('#pb-mode').value || null;
  if (!title) { toast('제목(주제)을 입력하세요.', 'bad'); return; }
  if (!category_id) { toast('카테고리를 선택하세요.', 'bad'); return; }
  if (!PB_PHOTOS.length) { toast('사진을 1장 이상 추가하세요.', 'bad'); return; }

  const btn = el.querySelector('#pb-run');
  const hint = el.querySelector('#pb-hint');
  btn.disabled = true;
  try {
    // 1) 사진 업로드 (한 장씩 바이너리 전송)
    const photos = [];
    for (let i = 0; i < PB_PHOTOS.length; i++) {
      const p = PB_PHOTOS[i];
      hint.textContent = `사진 업로드 중… (${i + 1}/${PB_PHOTOS.length})`;
      const res = await fetch('/api/photos/upload', {
        method: 'POST',
        headers: { 'Content-Type': p.file.type || 'application/octet-stream' },
        body: p.file,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '사진 업로드 실패');
      photos.push({ file: data.file, caption: p.caption || '' });
    }
    // 2) 콘텐츠 생성 요청 → 스튜디오 상세로 이동해 진행 확인
    hint.textContent = '후기 생성 중…';
    const r = await API.post('/api/photo-blog', { title, keywords, category_id, mode, photos });
    toast('후기 생성을 시작했습니다. 진행 상황을 확인하세요.', 'good');
    location.hash = `#/studio/content/${r.content_id}`;
  } catch (e) {
    toast(e.message, 'bad');
    btn.disabled = false;
    hint.textContent = '';
  }
}
