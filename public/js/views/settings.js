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

    <div class="card">
      <div class="card-title">정기 자동발행 스케줄</div>
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

    <div class="card">
      <div class="card-title">발행 안전장치 <span style="font-weight:400; color:var(--muted)">스팸·저품질 판정으로 수익이 막히는 것을 방지</span></div>
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

    <div class="card">
      <div class="card-title">AI 콘텐츠 엔진 (Claude)</div>
      <div class="field">
        <label>Anthropic API 키 ${s.anthropic_api_key_set ? '<span class="badge badge-ok">연결됨</span>' : '<span class="badge badge-warn">미등록 — 데모 모드</span>'}</label>
        <input type="password" id="api-key" value="${esc(s.anthropic_api_key)}" placeholder="sk-ant-..." autocomplete="off" />
        <div class="hint">키가 없으면 자리표시 데모 원고로 파이프라인이 동작합니다. 등록하면 Claude가 주제 발굴·원고 작성·플랫폼별 리라이팅을 수행합니다. (환경변수 ANTHROPIC_API_KEY로도 설정 가능)</div>
      </div>
      <div class="field" style="margin-bottom:0;">
        <label>모델</label>
        <select id="model">
          ${['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5'].map((m) => `<option value="${m}" ${s.llm_model === m ? 'selected' : ''}>${m}${m === 'claude-opus-4-8' ? ' (권장 — 최고 품질)' : m === 'claude-sonnet-5' ? ' (균형)' : ' (저비용·고속)'}</option>`).join('')}
        </select>
        <div class="hint">원고 품질이 수익을 좌우합니다. 리라이팅 차별화가 중요하므로 상위 모델을 권장합니다.</div>
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
      });
      toast('설정이 저장되었습니다.', 'good');
      render();
    } catch (e) { toast(e.message, 'bad'); }
  });
}
