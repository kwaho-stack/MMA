// 설정 — 발행 모드(자동/컨펌), 자동발행 스케줄, 발행 안전장치, LLM 연동

async function viewSettings(el) {
  const s = await API.get('/api/settings');

  el.innerHTML = `
    <div class="page-head">
      <div>
        <div class="page-title">설정</div>
        <div class="page-desc">발행 방식과 자동화 수준을 조정합니다</div>
      </div>
      <button class="btn btn-primary" id="save">설정 저장</button>
    </div>

    <div class="card">
      <div class="card-title">발행 모드</div>
      <div class="mode-cards">
        <div class="mode-card ${s.publish_mode === 'confirm' ? 'selected' : ''}" data-mode="confirm">
          <h4>🙋 컨펌 후 발행</h4>
          <p>리라이팅까지 자동으로 진행하고, 발행 큐에서 사용자가 검토·승인해야 배포됩니다. 품질·정책을 직접 확인하고 싶을 때.</p>
        </div>
        <div class="mode-card ${s.publish_mode === 'auto' ? 'selected' : ''}" data-mode="auto">
          <h4>⚡ 완전 자동</h4>
          <p>리라이팅 완료 즉시 계정별로 시간을 분산해 자동 배포합니다. 정책 검사를 통과한 콘텐츠가 알아서 나갑니다.</p>
        </div>
      </div>
    </div>

    <details class="adv">
      <summary>정기 자동발행 스케줄 <span class="sum-hint">${s.schedule_enabled === '1' ? `켜짐 — 매일 ${esc(s.schedule_times)}` : '꺼짐'}</span></summary>
      <div class="adv-body">
      <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
        <label class="switch"><input type="checkbox" id="sch-on" ${s.schedule_enabled === '1' ? 'checked' : ''} /><span class="track"></span></label>
        <div><b style="font-size:13px;">정해진 시간에 알아서 발행</b>
        <div class="hint">켜면 아래 시각마다, "정기 자동발행 ON"인 카테고리의 파이프라인(주제 선정→작성→리라이팅→배포)이 자동 실행됩니다.</div></div>
      </div>
      <div class="field">
        <label>자동발행 시각 (HH:MM, 콤마 구분)</label>
        <input id="sch-times" value="${esc(s.schedule_times)}" placeholder="09:30,19:30" />
        <div class="hint">예: 09:30,13:00,19:30 — 검색·피드 트래픽이 몰리는 출근/점심/저녁 시간대 권장</div>
      </div>
      </div>
    </details>

    <details class="adv">
      <summary>발행 안전장치 <span class="sum-hint">간격 ${esc(s.publish_gap_min)}분 · 일일 ${esc(s.daily_limit_per_account)}건 · ${s.simulate_publish === '1' ? '시뮬레이션' : '실제 발행'}</span></summary>
      <div class="adv-body">
      <div class="field-row">
        <div class="field">
          <label>계정 간 발행 간격 (분)</label>
          <input type="number" id="gap" value="${esc(s.publish_gap_min)}" min="1" />
          <div class="hint">자동 모드에서 여러 계정에 동시 발행하지 않고 이 간격으로 분산합니다(+무작위 지터).</div>
        </div>
        <div class="field">
          <label>계정별 1일 발행 상한</label>
          <input type="number" id="daily" value="${esc(s.daily_limit_per_account)}" min="1" />
          <div class="hint">과도한 발행은 저품질·스팸 판정 요인. 상한 도달 시 다음날로 자동 이월됩니다.</div>
        </div>
      </div>
      <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:0;">
        <label class="switch"><input type="checkbox" id="sim" ${s.simulate_publish === '1' ? 'checked' : ''} /><span class="track"></span></label>
        <div><b style="font-size:13px;">시뮬레이션 발행 모드</b>
        <div class="hint">켜져 있으면 외부 플랫폼 API를 호출하지 않고 발행 성공으로 처리합니다(전체 플로우 테스트용). 실계정 자격증명 등록 후 끄세요.</div></div>
      </div>
      </div>
    </details>

    <details class="adv">
      <summary>수익 자동 동기화 <span class="sum-hint">${s.revenue_sync_enabled === '1' ? `켜짐 — 매일 ${esc(s.revenue_sync_time)}` : '꺼짐'} · 애드센스·쿠팡·타불라·유튜브</span></summary>
      <div class="adv-body">
      <div class="field" style="display:flex; align-items:center; gap:10px; margin-bottom:16px;">
        <label class="switch"><input type="checkbox" id="rs-on" ${s.revenue_sync_enabled === '1' ? 'checked' : ''} /><span class="track"></span></label>
        <div><b style="font-size:13px;">매일 자동으로 수익 가져오기</b>
        <div class="hint">계정 · 매칭에 API 자격증명이 등록된 광고 계정의 일별 수익을 자동 반영합니다. 애드포스트·애드핏 등 API 미제공 플랫폼은 수동 입력.</div></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>동기화 시각 (HH:MM)</label>
          <input id="rs-time" value="${esc(s.revenue_sync_time)}" placeholder="06:10" />
          <div class="hint">전일 수치가 확정되는 새벽 시간대 권장</div>
        </div>
        <div class="field">
          <label>가져올 최근 일수</label>
          <input type="number" id="rs-days" value="${esc(s.revenue_sync_days)}" min="1" max="30" />
          <div class="hint">플랫폼이 확정치를 늦게 반영하는 경우를 대비해 매번 며칠치를 다시 덮어씁니다</div>
        </div>
        <div class="field">
          <label>USD→KRW 환율</label>
          <input type="number" id="rs-rate" value="${esc(s.usd_krw_rate)}" min="1" />
          <div class="hint">타불라 등 달러 정산 플랫폼의 원화 환산에 사용</div>
        </div>
      </div>
      </div>
    </details>

    <div class="card">
      <div class="card-title">AI 텍스트 엔진 <span style="font-weight:400; color:var(--muted)">현재: ${esc(s.engine?.label || '데모 모드')}</span></div>
      <div class="field">
        <label>우선 사용할 엔진</label>
        <select id="llm-provider">
          <option value="anthropic" ${s.llm_provider === 'anthropic' ? 'selected' : ''}>Claude API (Anthropic 키)</option>
          <option value="copilot" ${s.llm_provider === 'copilot' ? 'selected' : ''}>GitHub Copilot (구독 로그인)</option>
          <option value="google" ${s.llm_provider === 'google' ? 'selected' : ''}>Google Gemini (API 키 또는 계정 로그인)</option>
        </select>
        <div class="hint">선택한 엔진이 준비되지 않았으면 다른 엔진으로 자동 폴백, 모두 없으면 데모 모드로 동작합니다.</div>
      </div>
      <div class="field">
        <label>Anthropic API 키 ${s.anthropic_api_key_set ? '<span class="badge badge-ok">연결됨</span>' : '<span class="badge badge-warn">미등록</span>'}</label>
        <input type="password" id="api-key" value="${esc(s.anthropic_api_key)}" placeholder="sk-ant-..." autocomplete="off" />
        <div class="hint">환경변수 ANTHROPIC_API_KEY로도 설정 가능. 원고 품질이 수익을 좌우하므로 상위 모델 권장.</div>
      </div>
      <div class="field">
        <label>Claude 모델</label>
        <select id="model">
          ${['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'].map((m) => `<option value="${m}" ${s.llm_model === m ? 'selected' : ''}>${m}${m === 'claude-opus-4-8' ? ' (권장 — 최고 품질)' : m === 'claude-sonnet-5' ? ' (균형)' : ' (저비용·고속)'}</option>`).join('')}
        </select>
      </div>
      <div class="field" style="display:flex; align-items:center; gap:10px;">
        <label class="switch"><input type="checkbox" id="deai" ${s.deai_selfcritique !== '0' ? 'checked' : ''} /><span class="track"></span></label>
        <div><b style="font-size:13px;">AI 느낌 제거 (자기비평 2단 생성)</b>
        <div class="hint">마스터 원고 초안을 AI 느낌 점수로 자동 점검하고, 높으면 구체성·리듬을 살려 한 번 더 고쳐 씁니다. 원고당 토큰이 약 2배 들지만 사람 냄새가 확 올라갑니다. 끄면 초안 1회로 끝냅니다.</div></div>
      </div>
      <div class="field-row" style="margin-bottom:0;">
        <div class="field" style="margin-bottom:0;">
          <label>GitHub Copilot ${s.copilot?.connected ? `<span class="badge badge-ok">연결됨${s.copilot.user ? ` — @${esc(s.copilot.user)}` : ''}</span>` : '<span class="badge badge-warn">미연결</span>'}</label>
          ${s.copilot?.connected
            ? '<button class="btn btn-danger" id="copilot-logout" type="button">연결 해제</button>'
            : '<button class="btn btn-primary" id="copilot-login" type="button">🔑 GitHub로 로그인</button>'}
          <div class="hint">개인 Copilot 구독 계정으로 로그인하면 별도 API 키 없이 원고 작성·리라이팅을 수행합니다.</div>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Copilot 모델</label>
          <input id="copilot-model" value="${esc(s.copilot_model)}" placeholder="gpt-4o" />
          <div class="hint">구독 플랜에 따라 gpt-4o, gpt-4.1, o3-mini, claude-sonnet-4 등</div>
        </div>
      </div>
    </div>

    <details class="adv">
      <summary>Google 계정 연결 (OAuth) <span class="sum-hint">${s.google?.connected ? `연결됨${s.google.user ? ` — ${esc(s.google.user)}` : ''}` : 'API 키 대신 계정 로그인'}</span></summary>
      <div class="adv-body">
      <div class="field-row">
        <div class="field">
          <label>OAuth Client ID</label>
          <input id="g-client-id" value="${esc(s.google_client_id)}" placeholder="xxxx.apps.googleusercontent.com" autocomplete="off" />
        </div>
        <div class="field">
          <label>OAuth Client Secret</label>
          <input type="password" id="g-client-secret" value="${esc(s.google_client_secret)}" placeholder="GOCSPX-..." autocomplete="off" />
        </div>
      </div>
      <div class="hint" style="margin-top:-8px; margin-bottom:12px;">
        Google Cloud Console → API 및 서비스 → 사용자 인증 정보 → <b>OAuth 클라이언트(유형: TV 및 입력 제한 기기)</b>를 만들어 ID/시크릿을 입력하세요.
        해당 프로젝트에 <b>Generative Language API</b>를 사용 설정해야 합니다. Client ID/Secret을 저장한 뒤 로그인하세요.
      </div>
      <div class="field-row" style="align-items:flex-end; margin-bottom:0;">
        <div class="field" style="margin-bottom:0;">
          <label>연결 상태 ${s.google?.connected ? `<span class="badge badge-ok">연결됨${s.google.user ? ` — ${esc(s.google.user)}` : ''}</span>` : '<span class="badge badge-warn">미연결</span>'}</label>
          ${s.google?.connected
            ? '<button class="btn btn-danger" id="google-logout" type="button">연결 해제</button>'
            : '<button class="btn btn-primary" id="google-login" type="button">🔑 Google로 로그인</button>'}
          <div class="hint">로그인하면 별도 API 키 없이 Gemini 텍스트·이미지를 사용합니다. 개인 계정 사용을 권장합니다.</div>
        </div>
        <div class="field" style="margin-bottom:0;">
          <label>Gemini 텍스트 모델</label>
          <input id="g-text-model" value="${esc(s.google_text_model)}" placeholder="gemini-2.5-flash" />
          <div class="hint">gemini-2.5-flash(빠름) · gemini-2.5-pro(고품질)</div>
        </div>
      </div>
      </div>
    </details>

    <div class="card">
      <div class="card-title">이미지 엔진 (Gemini) · 카드뉴스 <span style="font-weight:400; color:var(--muted)">${s.gemini_auth ? `현재 인증: ${esc(s.gemini_auth)}` : '인증 필요'}</span></div>
      <div class="field">
        <label>Gemini API 키 ${s.gemini_api_key_set ? '<span class="badge badge-ok">연결됨</span>' : (s.google?.connected ? '<span class="badge badge-ok">Google 계정으로 사용 중</span>' : '<span class="badge badge-warn">미등록 — 삽화 생성 꺼짐</span>')}</label>
        <input type="password" id="gemini-key" value="${esc(s.gemini_api_key)}" placeholder="AIza..." autocomplete="off" />
        <div class="hint">Google AI Studio(aistudio.google.com)에서 발급. <b>비워두면 위의 Google 계정 연결로 대체됩니다.</b> 리라이팅 원고의 [이미지: …] 마커 위치에 삽화를 자동 생성해 발행 시 삽입합니다.</div>
      </div>
      <div class="field-row">
        <div class="field" style="display:flex; align-items:center; gap:10px;">
          <label class="switch"><input type="checkbox" id="img-on" ${s.image_gen_enabled === '1' ? 'checked' : ''} /><span class="track"></span></label>
          <div><b style="font-size:13px;">블로그 삽화 자동 생성</b>
          <div class="hint">네이버·티스토리·블로그스팟·워드프레스 본문 중간 이미지</div></div>
        </div>
        <div class="field" style="display:flex; align-items:center; gap:10px;">
          <label class="switch"><input type="checkbox" id="card-on" ${s.cardnews_enabled === '1' ? 'checked' : ''} /><span class="track"></span></label>
          <div><b style="font-size:13px;">인스타그램 카드뉴스 렌더링</b>
          <div class="hint">1080×1080 카드 이미지 자동 제작 → 캐러셀 업로드</div></div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>이미지 모델</label>
          <input id="gemini-model" value="${esc(s.gemini_image_model)}" placeholder="gemini-2.5-flash-image" />
        </div>
        <div class="field">
          <label>카드뉴스 브랜드 핸들</label>
          <input id="card-brand" value="${esc(s.cardnews_brand)}" placeholder="@mediadot" />
          <div class="hint">카드 상·하단에 표시되는 계정 핸들</div>
        </div>
      </div>
      <div class="field">
        <label>서버 공개 URL (public_base_url)</label>
        <input id="pub-url" value="${esc(s.public_base_url)}" placeholder="https://my-mediadot.example.com" />
        <div class="hint">인스타그램 API 업로드·블로그스팟/워드프레스 이미지 참조에는 외부 접근 가능한 이미지 URL이 필요합니다. 이 서버를 외부 공개(또는 터널링)한 주소를 입력하세요. 네이버·티스토리 브라우저 발행은 파일을 직접 업로드하므로 불필요.</div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>인스타그램 전역 대체 이미지 URL</label>
        <input id="ig-fallback" value="${esc(s.default_image_url)}" placeholder="https://.../fallback.jpg" />
        <div class="hint">서버 공개 URL이 없어 카드뉴스를 자동 업로드할 수 없을 때, 이 이미지 1장으로 대신 게시합니다. 공개 접근 가능한 https 이미지 주소여야 합니다(모든 인스타그램 계정 공통 · 계정별 대체 이미지 URL이 있으면 그쪽이 우선).</div>
      </div>
      <div class="variant-actions" style="margin-top:12px;">
        <button class="btn btn-sm" id="img-test" type="button">🎨 이미지 생성 테스트</button>
        <span id="img-test-result" style="font-size:12px; color:var(--muted)"></span>
      </div>
    </div>

    <div class="help-note">
      <b>수익화 전략 체크리스트</b><br>
      ① 리라이팅 차별화 — 같은 원고를 그대로 여러 곳에 올리면 중복 콘텐츠로 검색 노출이 막힙니다. 본 시스템은 플랫폼별로 제목·구조·문체를 재창작합니다.<br>
      ② 정책 검사 — 의료·금융 과장, 사행성 표현은 애드센스 게재 제한 사유. 파이프라인이 발행 전에 자동 검출합니다.<br>
      ③ 발행 분산 — 동시 대량 발행은 스팸 신호. 계정 간 간격과 일일 상한으로 자연스러운 발행 패턴을 유지합니다.<br>
      ④ 초기에는 컨펌 모드로 품질을 확인하고, 안정화되면 완전 자동으로 전환하는 것을 권장합니다.
    </div>
  `;

  let mode = s.publish_mode;
  el.querySelectorAll('.mode-card').forEach((card) => card.addEventListener('click', () => {
    mode = card.dataset.mode;
    el.querySelectorAll('.mode-card').forEach((c) => c.classList.toggle('selected', c === card));
  }));

  el.querySelector('#save').addEventListener('click', async () => {
    try {
      await API.put('/api/settings', {
        publish_mode: mode,
        schedule_enabled: el.querySelector('#sch-on').checked ? '1' : '0',
        schedule_times: el.querySelector('#sch-times').value.trim(),
        publish_gap_min: el.querySelector('#gap').value,
        daily_limit_per_account: el.querySelector('#daily').value,
        simulate_publish: el.querySelector('#sim').checked ? '1' : '0',
        anthropic_api_key: el.querySelector('#api-key').value.trim(),
        llm_model: el.querySelector('#model').value,
        deai_selfcritique: el.querySelector('#deai').checked ? '1' : '0',
        llm_provider: el.querySelector('#llm-provider').value,
        copilot_model: el.querySelector('#copilot-model').value.trim() || 'gpt-4o',
        google_client_id: el.querySelector('#g-client-id').value.trim(),
        google_client_secret: el.querySelector('#g-client-secret').value.trim(),
        google_text_model: el.querySelector('#g-text-model').value.trim() || 'gemini-2.5-flash',
        gemini_api_key: el.querySelector('#gemini-key').value.trim(),
        gemini_image_model: el.querySelector('#gemini-model').value.trim() || 'gemini-2.5-flash-image',
        image_gen_enabled: el.querySelector('#img-on').checked ? '1' : '0',
        cardnews_enabled: el.querySelector('#card-on').checked ? '1' : '0',
        cardnews_brand: el.querySelector('#card-brand').value.trim(),
        public_base_url: el.querySelector('#pub-url').value.trim(),
        default_image_url: el.querySelector('#ig-fallback').value.trim(),
        revenue_sync_enabled: el.querySelector('#rs-on').checked ? '1' : '0',
        revenue_sync_time: el.querySelector('#rs-time').value.trim(),
        revenue_sync_days: el.querySelector('#rs-days').value,
        usd_krw_rate: el.querySelector('#rs-rate').value,
      });
      toast('설정이 저장되었습니다.', 'good');
      render();
    } catch (e) { toast(e.message, 'bad'); }
  });

  // ---- GitHub Copilot 디바이스 플로우 로그인 ----
  const loginBtn = el.querySelector('#copilot-login');
  if (loginBtn) loginBtn.addEventListener('click', async () => {
    loginBtn.disabled = true;
    try {
      const d = await API.post('/api/copilot/device-start');
      openModal({
        title: 'GitHub Copilot 로그인',
        body: `
          <p style="font-size:13px; color:var(--text-2); margin-bottom:14px;">아래 코드를 복사한 뒤 GitHub 인증 페이지에 입력하세요. 인증이 끝나면 자동으로 연결됩니다.</p>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
            <code id="cp-code" style="font-size:26px; font-weight:800; letter-spacing:3px; padding:10px 18px; background:rgba(255,255,255,.05); border-radius:8px;">${esc(d.user_code)}</code>
            <button class="btn btn-sm" id="cp-copy" type="button">복사</button>
          </div>
          <a class="btn btn-primary" href="${esc(d.verification_uri)}" target="_blank" rel="noopener">GitHub 인증 페이지 열기 ↗</a>
          <div class="hint" style="margin-top:12px;" id="cp-status">인증 대기 중… (${Math.round(d.expires_in / 60)}분 안에 입력)</div>`,
        footer: `<button class="btn" data-close>닫기</button>`,
      });
      document.getElementById('cp-copy').addEventListener('click', async () => {
        await navigator.clipboard.writeText(d.user_code);
        toast('코드가 복사되었습니다.', 'good');
      });
      const timer = setInterval(async () => {
        if (!document.getElementById('cp-status')) { clearInterval(timer); return; } // 모달 닫힘
        try {
          const r = await API.post('/api/copilot/device-poll', { device_code: d.device_code });
          if (r.ok) {
            clearInterval(timer);
            closeModal();
            toast(`GitHub Copilot 연결 완료${r.user ? ` — @${r.user}` : ''}`, 'good');
            render();
          }
        } catch (e) {
          clearInterval(timer);
          const st = document.getElementById('cp-status');
          if (st) { st.textContent = `실패: ${e.message}`; st.style.color = 'var(--critical)'; }
        }
      }, (d.interval || 5) * 1000 + 500);
    } catch (e) {
      toast(e.message, 'bad');
      loginBtn.disabled = false;
    }
  });

  const logoutBtn = el.querySelector('#copilot-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', async () => {
    if (!confirm('GitHub Copilot 연결을 해제할까요?')) return;
    await API.post('/api/copilot/logout');
    toast('연결이 해제되었습니다.');
    render();
  });

  // ---- Google 계정 디바이스 플로우 로그인 (텍스트·이미지 공용) ----
  const gLoginBtn = el.querySelector('#google-login');
  if (gLoginBtn) gLoginBtn.addEventListener('click', async () => {
    const cid = el.querySelector('#g-client-id').value.trim();
    const csec = el.querySelector('#g-client-secret').value.trim();
    if (!cid) { toast('먼저 OAuth Client ID를 입력하세요.', 'bad'); return; }
    gLoginBtn.disabled = true;
    try {
      // 로그인 전에 Client ID/Secret을 저장한다(서버가 설정값으로 디바이스 코드를 발급).
      const patch = { google_client_id: cid };
      if (csec && csec !== '********') patch.google_client_secret = csec;
      await API.put('/api/settings', patch);

      const d = await API.post('/api/google/device-start');
      openModal({
        title: 'Google 계정 로그인',
        body: `
          <p style="font-size:13px; color:var(--text-2); margin-bottom:14px;">아래 코드를 복사한 뒤 Google 인증 페이지에 입력하세요. 인증이 끝나면 자동으로 연결됩니다.</p>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px;">
            <code id="gg-code" style="font-size:26px; font-weight:800; letter-spacing:3px; padding:10px 18px; background:rgba(255,255,255,.05); border-radius:8px;">${esc(d.user_code)}</code>
            <button class="btn btn-sm" id="gg-copy" type="button">복사</button>
          </div>
          <a class="btn btn-primary" href="${esc(d.verification_uri)}" target="_blank" rel="noopener">Google 인증 페이지 열기 ↗</a>
          <div class="hint" style="margin-top:12px;" id="gg-status">인증 대기 중… (${Math.round(d.expires_in / 60)}분 안에 입력)</div>`,
        footer: `<button class="btn" data-close>닫기</button>`,
      });
      document.getElementById('gg-copy').addEventListener('click', async () => {
        await navigator.clipboard.writeText(d.user_code);
        toast('코드가 복사되었습니다.', 'good');
      });
      const timer = setInterval(async () => {
        if (!document.getElementById('gg-status')) { clearInterval(timer); return; }
        try {
          const r = await API.post('/api/google/device-poll', { device_code: d.device_code });
          if (r.ok) {
            clearInterval(timer);
            closeModal();
            toast(`Google 계정 연결 완료${r.user ? ` — ${r.user}` : ''}`, 'good');
            render();
          }
        } catch (e) {
          clearInterval(timer);
          const st = document.getElementById('gg-status');
          if (st) { st.textContent = `실패: ${e.message}`; st.style.color = 'var(--critical)'; }
        }
      }, (d.interval || 5) * 1000 + 500);
    } catch (e) {
      toast(e.message, 'bad');
      gLoginBtn.disabled = false;
    }
  });

  const gLogoutBtn = el.querySelector('#google-logout');
  if (gLogoutBtn) gLogoutBtn.addEventListener('click', async () => {
    if (!confirm('Google 계정 연결을 해제할까요?')) return;
    await API.post('/api/google/logout');
    toast('연결이 해제되었습니다.');
    render();
  });

  // ---- 이미지 생성 테스트 ----
  el.querySelector('#img-test').addEventListener('click', async () => {
    const btn = el.querySelector('#img-test');
    const out = el.querySelector('#img-test-result');
    btn.disabled = true; out.textContent = '생성 중… (수 초 소요)'; out.style.color = 'var(--muted)';
    try {
      const r = await API.post('/api/images/test', {});
      out.innerHTML = `✓ 성공 — <a href="${esc(r.file)}" target="_blank" rel="noopener" style="color:var(--good)">생성된 이미지 보기 ↗</a>`;
    } catch (e) {
      out.textContent = `실패: ${e.message}`;
      out.style.color = 'var(--critical)';
    }
    btn.disabled = false;
  });
}
