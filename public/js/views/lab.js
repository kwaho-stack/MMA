// 리라이팅 랩 — 발행/저장 없이 주제로 마스터 원고(+선택 플랫폼 리라이팅)를 생성하고
// AI 느낌 점수·근거를 눈으로 확인하는 실험 도구. 원고 품질 고도화의 측정 화면.

async function viewLab(el) {
  const [catalog, categories] = await Promise.all([
    API.get('/api/catalog'),
    API.get('/api/categories'),
  ]);
  const platforms = Object.entries(catalog.media);

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">리라이팅 랩 <span class="badge badge-violet" style="vertical-align:middle">미리보기 · 평가</span></div>
        <div class="page-desc">발행하지 않고 원고를 실험합니다. 주제를 넣으면 마스터 원고와 선택 플랫폼 리라이팅을 생성하고, <b>AI 느낌 점수</b>로 사람 같은지 채점합니다.</div>
      </div>
    </div>

    <div class="lab-grid">
      <div class="card lab-controls">
        <div class="card-title">실험 설정</div>
        <div class="field">
          <label>주제(제목) *</label>
          <input id="lab-title" placeholder="예: 여름철 전기요금 아끼는 법" />
        </div>
        <div class="field">
          <label>핵심 키워드</label>
          <input id="lab-keywords" placeholder="전기요금, 절약, 누진구간" />
        </div>
        <div class="field">
          <label>다룰 관점</label>
          <input id="lab-angle" placeholder="직접 한 달 해보고 알게 된 것" />
        </div>
        <div class="field-row">
          <div class="field">
            <label>카테고리(선택)</label>
            <select id="lab-cat">
              <option value="">지정 안 함</option>
              ${categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>대상</label>
            <select id="lab-platform">
              <option value="_master">마스터 원고만</option>
              ${platforms.map(([k, p]) => `<option value="${k}">마스터 → ${esc(p.name)} 리라이팅</option>`).join('')}
            </select>
          </div>
        </div>
        <button class="btn btn-primary" id="lab-run" style="width:100%">✦ 생성 &amp; 평가</button>
        <div class="hint" style="margin-top:8px;">저장·발행되지 않습니다. 실제 원고 품질을 보려면 설정에서 AI 텍스트 엔진(키/로그인)을 연결하세요 — 미연결 시 데모 원고로 화면만 확인됩니다.</div>
      </div>

      <div id="lab-result" class="lab-result">
        <div class="empty">왼쪽에서 주제를 입력하고 <b>생성 &amp; 평가</b>를 누르세요.</div>
      </div>
    </div>
  `;

  el.querySelector('#lab-run').addEventListener('click', runPreview);
  el.querySelector('#lab-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') runPreview(); });

  async function runPreview() {
    const title = el.querySelector('#lab-title').value.trim();
    if (!title) { toast('주제(제목)를 입력하세요.', 'bad'); return; }
    const payload = {
      title,
      keywords: el.querySelector('#lab-keywords').value.trim(),
      angle: el.querySelector('#lab-angle').value.trim(),
      category_id: el.querySelector('#lab-cat').value ? Number(el.querySelector('#lab-cat').value) : null,
      platform: el.querySelector('#lab-platform').value,
    };
    const btn = el.querySelector('#lab-run');
    const box = el.querySelector('#lab-result');
    btn.disabled = true; btn.textContent = '생성 중… (모델 호출)';
    box.innerHTML = '<div class="lab-loading">원고를 생성하고 AI 느낌을 채점하는 중입니다…</div>';
    try {
      const r = await API.post('/api/lab/preview', payload);
      box.innerHTML = renderResult(r);
    } catch (e) {
      box.innerHTML = `<div class="empty">생성 실패: ${esc(e.message)}</div>`;
    } finally {
      btn.disabled = false; btn.innerHTML = '✦ 생성 &amp; 평가';
    }
  }
}

// ── 렌더 헬퍼 ──────────────────────────────────────────────────────────
function labAiColor(score) {
  return score >= 55 ? 'var(--critical)' : score >= 30 ? 'var(--warning)' : 'var(--good)';
}
function labVerdict(score) {
  return score >= 55 ? 'AI 느낌 강함' : score >= 30 ? '다소 AI스러움' : '사람에 가까움';
}

function labMeter(ai) {
  const color = labAiColor(ai.score);
  return `
    <div class="ai-meter">
      <div class="ai-num" style="color:${color}">${ai.score}<span>/100</span></div>
      <div class="ai-meta">
        <div class="ai-verdict" style="color:${color}">${labVerdict(ai.score)}</div>
        <div class="ai-sub">AI 느낌 점수 · <b>낮을수록 사람 같음</b></div>
        <div class="ai-track"><div class="ai-fill" style="width:${ai.score}%; background:${color}"></div></div>
      </div>
    </div>`;
}

function labSignals(ai) {
  const shown = ai.signals.filter((s) => s.viol >= 0.1).slice(0, 6);
  if (!shown.length) return '<div class="lab-clean">✓ 두드러진 AI 신호 없음 — 깔끔합니다.</div>';
  return `<div class="sig-list">${shown.map((s) => {
    const pct = Math.round(s.viol * 100);
    const c = pct >= 60 ? 'var(--critical)' : pct >= 34 ? 'var(--warning)' : 'var(--muted)';
    return `
      <div class="sig">
        <div class="sig-head"><span>${esc(s.label)}</span><span class="sig-pct" style="color:${c}">${pct}%</span></div>
        <div class="sig-track"><div class="sig-fill" style="width:${pct}%; background:${c}"></div></div>
        ${s.hits && s.hits.length ? `<div class="sig-hits">${s.hits.slice(0, 8).map((h) => `<span class="chip">${esc(h)}</span>`).join('')}</div>` : `<div class="sig-detail">${esc(s.detail || '')}</div>`}
      </div>`;
  }).join('')}</div>`;
}

function labBody(text) {
  return String(text || '').split(/\n{2,}/).map((block) => {
    const b = block.trim();
    if (!b) return '';
    if (/^#{2,}\s+/.test(b)) return `<h4 class="lab-h">${esc(b.replace(/^#+\s*/, ''))}</h4>`;
    if (/^#\s+/.test(b)) return `<h3 class="lab-h">${esc(b.replace(/^#+\s*/, ''))}</h3>`;
    return `<p>${esc(b).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

function labStages(stages, demo) {
  if (demo) return '<div class="stage-line stage-demo">데모 모드 — AI 엔진 미연결. 실제 자기비평은 키/로그인 연결 후 동작합니다.</div>';
  if (!stages || !stages.selfcritique) return '<div class="stage-line">자기비평 꺼짐 (설정에서 켜면 초안을 한 번 더 다듬습니다).</div>';
  if (stages.draftScore == null) return '';
  if (stages.revisedScore == null) {
    return `<div class="stage-line stage-ok">초안 AI점수 ${stages.draftScore} — 이미 낮아 개정 생략.</div>`;
  }
  const improved = stages.applied;
  return `<div class="stage-line ${improved ? 'stage-ok' : 'stage-warn'}">
    자기비평: 초안 <b>${stages.draftScore}</b> → 개정 <b>${stages.revisedScore}</b>
    ${improved ? '<span class="badge badge-ok" style="margin-left:6px">개정 적용</span>' : '<span class="badge" style="margin-left:6px">초안 유지(개선 없음)</span>'}
  </div>`;
}

function renderResult(r) {
  const m = r.master;
  const engine = r.demo ? '데모 모드' : (r.engine?.label || '엔진');
  let html = `
    <div class="card">
      <div class="lab-res-head">
        <div class="card-title" style="margin:0">마스터 원고</div>
        <span class="badge ${r.demo ? 'badge-warn' : 'badge-info'}">${esc(engine)}</span>
      </div>
      ${labMeter(m.ai)}
      ${labStages(m.stages, r.demo)}
      ${labSignals(m.ai)}
      <div class="lab-metrics">문장 ${m.ai.metrics.sentences} · 어절 ${m.ai.metrics.words} · 리듬변주 ${m.ai.metrics.burstiness} · 구체성 ${(m.ai.metrics.concreteness * 100).toFixed(1)}%</div>
      <div class="lab-doc">
        <div class="lab-doc-title">${esc(m.title)}</div>
        ${m.summary ? `<div class="lab-summary">${esc(m.summary)}</div>` : ''}
        <div class="lab-content">${labBody(m.body)}</div>
        ${(m.tags && m.tags.length) ? `<div class="lab-tags">${m.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;

  if (r.rewrite) {
    const w = r.rewrite;
    html += `
    <div class="card">
      <div class="lab-res-head">
        <div class="card-title" style="margin:0">${esc(w.platform_name)} 리라이팅</div>
        <span class="badge ${w.demo ? 'badge-warn' : 'badge-violet'}">${w.demo ? '데모' : '리라이팅'}</span>
      </div>
      ${labMeter(w.ai)}
      ${labSignals(w.ai)}
      <div class="lab-doc">
        <div class="lab-doc-title">${esc(w.title)}</div>
        <div class="lab-content">${labBody(w.body)}</div>
        ${(w.hashtags && w.hashtags.length) ? `<div class="lab-tags">${w.hashtags.map((t) => `<span class="chip">${esc(String(t).replace(/^#/, '#'))}</span>`).join('')}</div>` : ''}
        ${w.cta ? `<div class="lab-extra"><b>CTA</b> ${esc(w.cta)}</div>` : ''}
        ${w.pinned_comment ? `<div class="lab-extra"><b>고정 댓글</b> ${esc(w.pinned_comment)}</div>` : ''}
        ${w.ad_snippet ? `<div class="lab-extra"><b>광고 문구</b> ${esc(w.ad_snippet)}</div>` : ''}
      </div>
    </div>`;
  }

  return html;
}
