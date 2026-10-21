// ============================================================
// rnd_product.js — 연구관리 > 제품개발 4개 화면
//
//   RndPlanPage     제품기획      — 기획서 작성·검토·승인. 승인하면 개발과제로 전환된다.
//   RndProjectPage  개발과제관리  — 개발의 중심 엔티티. 단계·진척·산출물 집계
//   RndSpecPage     제품규격      — 개발 결과물의 규격. 개정 시 새 버전을 만든다.
//   RndSchedulePage 개발일정      — 과제별 마일스톤 간트(계획 vs 실적)
//
//   네 화면이 같은 과제(project)를 축으로 돌아가므로 한 파일에 둔다.
// ============================================================

// ============================================================
// 제품기획
// ============================================================
const RndPlanPage = (() => {
  const U = () => RndUI;
  let q = '', fStatus = '';
  let editId = null;

  const list = () => {
    const u = U();
    return RndDB.getPlansBy(u.fac())
      .filter(p => !fStatus || p.status === fStatus)
      .filter(p => u.matches(q, p.title, p.code, p.species, p.concept, p.proposer));
  };

  const card = (p) => {
    const u = U();
    const proj = p.projectId ? RndDB.getProjectById(p.projectId) : null;
    return `
      <div class="card rnd-card">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(p.code)} · ${u.esc(u.facName(p.factory))}</div>
            <h4 class="rnd-card-title">${u.esc(p.title)}</h4>
          </div>
          <div class="rnd-card-badges">
            ${u.badge(RndDB.PLAN_STATUS, p.status)}
            ${p.species ? `<span class="rnd-chip">${u.esc(p.species)}</span>` : ''}
            ${p.category ? `<span class="rnd-chip">${u.esc(p.category)}</span>` : ''}
            ${u.fileChip(p.files)}
          </div>
        </div>

        <div class="rnd-kv">
          ${p.background ? `<div><label>기획 배경</label><span>${u.nl2br(p.background)}</span></div>` : ''}
          ${p.marketResearch ? `<div><label>시장조사 <em>5.1</em></label><span>${u.nl2br(p.marketResearch)}</span></div>` : ''}
          ${p.claimAnalysis ? `<div><label>소비자 Claim 분석 <em>5.1</em></label><span>${u.nl2br(p.claimAnalysis)}</span></div>` : ''}
          ${p.ideaSource ? `<div><label>제안·계획 출처 <em>5.1</em></label><span>${u.nl2br(p.ideaSource)}</span></div>` : ''}
          ${p.concept ? `<div><label>제품 컨셉</label><span>${u.nl2br(p.concept)}</span></div>` : ''}
          ${p.target ? `<div><label>목표 성능</label><span>${u.nl2br(p.target)}</span></div>` : ''}
          ${p.consumer || p.season ? `<div><label>대상 / 출시시점 <em>5.2</em></label><span>${u.esc(p.consumer || '-')} / ${u.esc(p.season || '-')}</span></div>` : ''}
          ${p.productForm || p.productWeight || p.packaging ? `<div><label>형태 / 중량 / 포장 <em>5.2</em></label><span>${u.esc(p.productForm || '-')} / ${u.esc(p.productWeight || '-')} / ${u.esc(p.packaging || '-')}</span></div>` : ''}
          ${p.competitor ? `<div><label>타사 유사제품 <em>5.2</em></label><span>${u.nl2br(p.competitor)}</span></div>` : ''}
          ${p.legalReview ? `<div><label>사료관리법 검토 <em>5.2</em></label><span>${u.nl2br(p.legalReview)}</span></div>` : ''}
          <div><label>목표 물량 / 가격 / 예산</label><span>${u.esc(p.volumeTarget || '-')} / ${u.esc(p.priceTarget || '-')} / ${p.budget ? p.budget.toLocaleString() + ' 천원' : '-'}</span></div>
          <div><label>기안</label><span>${u.esc(p.proposer || '-')} · ${u.esc(u.dateOnly(p.proposedAt))} · 목표연도 ${u.esc(p.dueYear || '-')}</span></div>
          ${p.decision ? `<div><label>검토의견</label><span>${u.nl2br(p.decision)}${p.decidedBy ? ` <em>(${u.esc(p.decidedBy)} · ${u.esc(u.dateOnly(p.decidedAt))})</em>` : ''}</span></div>` : ''}
          ${proj ? `<div><label>전환된 과제</label><span><a href="javascript:void(0)" onclick="App.navigate('rndProject')">${u.esc(proj.code)} · ${u.esc(proj.name)}</a></span></div>` : ''}
        </div>

        ${u.fileStrip(p.files, { hideEmpty: true })}

        <div class="rnd-card-actions">
          ${p.status !== 'APPROVED' ? `<button class="btn btn-sm btn-primary" onclick="RndPlanPage.approve('${p.id}')">승인 · 과제 생성</button>` : ''}
          ${p.status !== 'APPROVED' && p.status !== 'HOLD' ? `<button class="btn btn-sm" onclick="RndPlanPage.setStatus('${p.id}','HOLD')">보류</button>` : ''}
          ${p.status !== 'APPROVED' && p.status !== 'REJECT' ? `<button class="btn btn-sm" onclick="RndPlanPage.setStatus('${p.id}','REJECT')">반려</button>` : ''}
          <button class="btn btn-sm" onclick="RndPlanPage.openEdit('${p.id}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="RndPlanPage.remove('${p.id}')">삭제</button>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getPlansBy(u.fac());
    const rows = list();
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 제품개발</div>
            <h2>제품기획</h2>
            <p>절차서 5.1 제품 개발계획 · 5.2 제품설계(입력) 단계입니다. 승인하면 개발과제와 5.1~5.13 일정이 자동 생성됩니다.</p>
            <div class="rnd-docref">근거 ${RndDB.PROCEDURE.docNo} ${RndDB.PROCEDURE.title} · 기록 ${RndDB.RECORDS.PLAN_DOC.docNo} ${RndDB.RECORDS.PLAN_DOC.label} (${RndDB.RECORDS.PLAN_DOC.dept} · 보존 ${RndDB.RECORDS.PLAN_DOC.keep})</div>
          </div>
          <div class="module-metrics">
            <div><span>${all.length}</span><label>전체 기획</label></div>
            <div><span>${all.filter(x => x.status === 'REVIEW').length}</span><label>검토중</label></div>
            <div><span>${all.filter(x => x.status === 'APPROVED').length}</span><label>승인</label></div>
            <div><span>${all.filter(x => x.status === 'HOLD' || x.status === 'REJECT').length}</span><label>보류·반려</label></div>
          </div>
        </div>

        ${u.toolbar('rnd-plan', {
          placeholder: '제품명 · 축종 · 컨셉 · 기안자 검색',
          q,
          onSearch: 'RndPlanPage.onSearch',
          onAdd: 'RndPlanPage.openAdd()',
          addLabel: '기획 등록',
          filters: u.selectFilter('rnd-plan-status', RndDB.PLAN_STATUS, fStatus, 'RndPlanPage.onStatus', '전체 상태'),
        })}

        <div class="rnd-list">
          ${rows.length ? rows.map(card).join('')
            : u.emptyState('등록된 제품기획이 없습니다', '＋ 기획 등록으로 첫 기획서를 작성하십시오.')}
        </div>

        ${modal()}
      </div>`;
  };

  const modal = () => {
    const u = U();
    const p = editId ? RndDB.getPlanById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-plan-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${p ? '제품기획 수정' : '제품기획 등록'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-plan-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">제품(가칭) <em>*</em></label>
                <input type="text" class="form-input" id="pl-title" value="${u.esc(p?.title || '')}" placeholder="예: 저단백 친환경 육성돈 사료"></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="pl-factory">${u.factoryOptions(p?.factory || u.defaultFactory())}</select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">축종</label>
                <input type="text" class="form-input" id="pl-species" value="${u.esc(p?.species || '')}" placeholder="양돈 / 양계 / 낙농 / 양어 / 반려"></div>
              <div class="form-group"><label class="form-label">구분</label>
                <input type="text" class="form-input" id="pl-category" value="${u.esc(p?.category || '')}" placeholder="신제품 / 개선 / 원가절감 / 규제대응"></div>
              <div class="form-group"><label class="form-label">목표 연도</label>
                <input type="text" class="form-input" id="pl-dueyear" value="${u.esc(p?.dueYear || String(new Date().getFullYear()))}"></div>
            </div>
            <div class="form-group"><label class="form-label">기획 배경</label>
              <textarea class="form-input" id="pl-background" rows="2" placeholder="왜 지금 필요한가 — 시장·규제·고객 요구">${u.esc(p?.background || '')}</textarea></div>

            <div class="rnd-formsec">5.1 제품 개발계획</div>
            <div class="form-group"><label class="form-label">시장조사 결과</label>
              <textarea class="form-input" id="pl-market" rows="3" placeholder="소비자 의식수준 · 소비방향 · 거래처 요구사항 · 주요 경쟁상품 판매방향">${u.esc(p?.marketResearch || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">제안·계획 출처</label>
                <input type="text" class="form-input" id="pl-idea" value="${u.esc(p?.ideaSource || '')}" placeholder="경영진 지시 / 사업계획안 / 직원 제안 / 외부 기술자료"></div>
              <div class="form-group"><label class="form-label">소비자 Claim 분석</label>
                <input type="text" class="form-input" id="pl-claim" value="${u.esc(p?.claimAnalysis || '')}" placeholder="VOC 역추적 화면의 클레임 분석 요약"></div>
            </div>
            <div class="form-group"><label class="form-label">제품 컨셉</label>
              <textarea class="form-input" id="pl-concept" rows="2" placeholder="어떻게 만들 것인가 — 핵심 아이디어">${u.esc(p?.concept || '')}</textarea></div>

            <div class="rnd-formsec">5.2 제품설계(입력)</div>
            <div class="form-group"><label class="form-label">목표 성능·스펙</label>
              <textarea class="form-input" id="pl-target" rows="2" placeholder="측정 가능한 목표로 적습니다. 예: 조단백 14% 이하 · 일당증체 동등">${u.esc(p?.target || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">주 소비 대상</label>
                <input type="text" class="form-input" id="pl-consumer" value="${u.esc(p?.consumer || '')}" placeholder="축종 · 일령/체중 구간 · 용도"></div>
              <div class="form-group"><label class="form-label">출시 시점·계절 요인</label>
                <input type="text" class="form-input" id="pl-season" value="${u.esc(p?.season || '')}" placeholder="하절기 출시 — 고온기 섭취 저하 고려"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">형태</label>
                <input type="text" class="form-input" id="pl-form" value="${u.esc(p?.productForm || '')}" placeholder="펠릿 / 매쉬 / EP / 크럼블"></div>
              <div class="form-group"><label class="form-label">중량·포장단위</label>
                <input type="text" class="form-input" id="pl-weight" value="${u.esc(p?.productWeight || '')}" placeholder="25kg 지대"></div>
              <div class="form-group"><label class="form-label">포장방법</label>
                <input type="text" class="form-input" id="pl-packaging" value="${u.esc(p?.packaging || '')}" placeholder="지대 / 벌크 / 톤백"></div>
            </div>
            <div class="form-group"><label class="form-label">타사 유사제품 시장 판매가</label>
              <textarea class="form-input" id="pl-competitor" rows="2">${u.esc(p?.competitor || '')}</textarea></div>
            <div class="form-group"><label class="form-label">사료관리법 비교 검토</label>
              <textarea class="form-input" id="pl-legal" rows="2" placeholder="성분등록 대상 여부 · 사용 가능 원료/첨가물 범위 · 표시사항">${u.esc(p?.legalReview || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">목표 물량</label>
                <input type="text" class="form-input" id="pl-volume" value="${u.esc(p?.volumeTarget || '')}" placeholder="예: 연 3,000톤"></div>
              <div class="form-group"><label class="form-label">목표 가격</label>
                <input type="text" class="form-input" id="pl-price" value="${u.esc(p?.priceTarget || '')}" placeholder="예: 기존 대비 +2% 이내"></div>
              <div class="form-group"><label class="form-label">개발 소요 예산(천원)</label>
                <input type="number" class="form-input" id="pl-budget" value="${p?.budget || ''}"></div>
              <div class="form-group"><label class="form-label">상태</label>
                <select class="form-input" id="pl-status">${u.options(RndDB.PLAN_STATUS, p?.status || 'DRAFT')}</select></div>
            </div>

            <div class="rnd-formsec">5.4 제품심의(검토)</div>
            <div class="form-group"><label class="form-label">검토 의견</label>
              <textarea class="form-input" id="pl-decision" rows="2">${u.esc(p?.decision || '')}</textarea></div>
            <div class="form-group"><label class="form-label">기안자</label>
              <input type="text" class="form-input" id="pl-proposer" value="${u.esc(p?.proposer || u.actorName())}" readonly>
              <div class="form-hint">로그인 계정에서 자동 기록됩니다.</div></div>
            ${u.attachBox('plan', '시장자료·경쟁사 제품사진·요구사항 문서 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-plan-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndPlanPage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => { editId = null; App.refreshPage(); RndUI.resetBucket('plan', []); RndUI.openModal('rnd-plan-modal'); RndUI.renderBucket('plan'); };
  const openEdit = (id) => {
    editId = id;
    const p = RndDB.getPlanById(id);
    App.refreshPage();
    RndUI.resetBucket('plan', (p?.files || []).slice());
    RndUI.openModal('rnd-plan-modal');
    RndUI.renderBucket('plan');
  };

  const submit = () => {
    const u = U();
    const title = u.val('pl-title');
    if (!title) { App.toast('제품(가칭)을 입력하십시오', 'warning'); return; }
    const data = {
      title,
      factory: u.val('pl-factory'),
      species: u.val('pl-species'),
      category: u.val('pl-category'),
      dueYear: u.val('pl-dueyear'),
      background: u.val('pl-background'),
      marketResearch: u.val('pl-market'),
      ideaSource: u.val('pl-idea'),
      claimAnalysis: u.val('pl-claim'),
      concept: u.val('pl-concept'),
      target: u.val('pl-target'),
      consumer: u.val('pl-consumer'),
      season: u.val('pl-season'),
      productForm: u.val('pl-form'),
      productWeight: u.val('pl-weight'),
      packaging: u.val('pl-packaging'),
      competitor: u.val('pl-competitor'),
      legalReview: u.val('pl-legal'),
      volumeTarget: u.val('pl-volume'),
      priceTarget: u.val('pl-price'),
      budget: u.num('pl-budget'),
      status: u.val('pl-status'),
      decision: u.val('pl-decision'),
      proposer: u.val('pl-proposer') || u.actorName(),
      files: u.bucket('plan').slice(),
    };
    if (editId) RndDB.updatePlan(editId, data); else RndDB.addPlan(data);
    editId = null;
    RndUI.closeModal('rnd-plan-modal');
    App.toast('제품기획을 저장했습니다', 'success');
    App.refreshPage();
  };

  const approve = (id) => {
    const p = RndDB.getPlanById(id);
    if (!p) return;
    if (!confirm(`"${p.title}" 기획을 승인하고 개발과제로 전환합니다.\n절차서 5.1~5.13 기본 일정이 함께 생성됩니다. 계속할까요?`)) return;
    const proj = RndDB.approvePlanToProject(id, { decidedBy: RndUI.actorName(), leader: RndUI.actorName() });
    if (proj) {
      RndDB.seedMilestones(proj.id, proj.factory, proj.startDate);
      App.toast(`개발과제 ${proj.code} 를 생성했습니다`, 'success');
    }
    App.refreshPage();
  };

  const setStatus = (id, status) => { RndDB.updatePlan(id, { status }); App.refreshPage(); };
  const remove = (id) => {
    if (!RndUI.confirmDelete('제품기획')) return;
    RndDB.removePlan(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const onSearch = (v) => { q = v; repaintList(); };
  const onStatus = (v) => { fStatus = v; repaintList(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const rows = list();
    el.innerHTML = rows.length ? rows.map(card).join('')
      : RndUI.emptyState('조건에 맞는 기획이 없습니다', '검색어나 상태 필터를 바꿔보십시오.');
  };

  return { render, afterRender: () => {}, openAdd, openEdit, submit, approve, setStatus, remove, onSearch, onStatus };
})();


// ============================================================
// 개발과제관리
// ============================================================
const RndProjectPage = (() => {
  const U = () => RndUI;
  let q = '', fStage = '', fStatus = '';
  let editId = null;

  const list = () => {
    const u = U();
    return RndDB.getProjectsBy(u.fac())
      .filter(p => !fStage || p.stage === fStage)
      .filter(p => !fStatus || p.status === fStatus)
      .filter(p => u.matches(q, p.name, p.code, p.species, p.leader, p.members, p.goal));
  };

  // 단계 진행바 — 절차서 5.1~5.13 을 4개 프로세스 구간으로 묶어 보여준다.
  //   지금 어느 단계이고 그 단계의 절차 체크가 몇 개 남았는지가 과제 카드의 핵심 정보다.
  const stageBar = (p) => {
    const u = RndUI;
    const cur = RndDB.stageMeta(p.stage).order;
    return `<div class="rnd-phasewrap">${RndDB.phaseList().map(([pk, pv]) => `
      <div class="rnd-phase">
        <div class="rnd-phase-title" title="${u.esc(RndDB.phaseOwner(pk))}">${u.esc(pv.label)}</div>
        <div class="rnd-stagebar">${RndDB.stagesOfPhase(pk).map(([k, v]) => {
          const st = RndDB.checkState(p, k);
          const cls = v.order < cur ? 'done' : v.order === cur ? 'cur' : '';
          return `<button class="rnd-stage ${cls}" title="${u.esc(v.no + ' ' + v.label + ' — ' + RndDB.stageOwner(k))}"
                    onclick="RndProjectPage.openChecks('${p.id}','${k}')">
            <i></i><span>${u.esc(v.label)}</span>
            ${st.total ? `<em class="${st.done >= st.total ? 'ok' : ''}">${st.done}/${st.total}</em>` : ''}
          </button>`;
        }).join('')}</div>
      </div>`).join('')}</div>`;
  };

  const card = (p) => {
    const u = U();
    const c = RndDB.projectCounts(p.id);
    const auto = RndDB.calcProgress(p.id);
    const prog = auto === null ? (Number(p.progress) || 0) : auto;
    const cs = RndDB.overallChecks(p);
    const cur = RndDB.stageMeta(p.stage);
    return `
      <div class="card rnd-card">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(p.code)} · ${u.esc(u.facName(p.factory))} · 현재 ${u.esc(cur.no)} ${u.esc(cur.label)}</div>
            <h4 class="rnd-card-title">${u.esc(p.name)}</h4>
          </div>
          <div class="rnd-card-badges">
            ${u.badge(RndDB.PROJ_STATUS, p.status)}
            ${u.badge(RndDB.PRIORITY, p.priority)}
            ${p.species ? `<span class="rnd-chip">${u.esc(p.species)}</span>` : ''}
            ${u.fileChip(p.files)}
          </div>
        </div>

        ${stageBar(p)}

        <div class="rnd-progress">
          <div class="rnd-progress-bar"><i style="width:${Math.max(0, Math.min(100, prog))}%"></i></div>
          <span>일정 ${prog}%${auto === null ? '' : ' <em>(마일스톤 실적)</em>'}</span>
        </div>
        <div class="rnd-progress">
          <div class="rnd-progress-bar"><i class="alt" style="width:${cs.pct}%"></i></div>
          <span>절차 이행 ${cs.pct}% <em>(${cs.done}/${cs.total} 항목)</em></span>
        </div>

        <div class="rnd-kv">
          ${p.goal ? `<div><label>목표</label><span>${u.nl2br(p.goal)}</span></div>` : ''}
          <div><label>현재 단계 담당</label><span>${u.esc(RndDB.stageOwner(p.stage))}</span></div>
          <div><label>책임 / 참여</label><span>${u.esc(p.leader || '-')}${p.members ? ` / ${u.esc(p.members)}` : ''}</span></div>
          <div><label>기간</label><span>${u.esc(p.startDate || '-')} ~ ${u.esc(p.dueDate || '-')} ${p.dueDate && p.status === 'ACTIVE' ? u.ddayText(p.dueDate) : ''}</span></div>
          ${p.budget ? `<div><label>예산 / 집행</label><span>${p.budget.toLocaleString()} / ${(Number(p.spent) || 0).toLocaleString()} 천원</span></div>` : ''}
          ${p.result ? `<div><label>개발결과 <em>${RndDB.RECORDS.RESULT_DOC.docNo}</em></label><span>${u.nl2br(p.result)}</span></div>` : ''}
          ${p.resultCost || p.resultSpecNo ? `<div><label>사전원가 / 성분등록</label><span>${u.esc(p.resultCost || '-')} / ${u.esc(p.resultSpecNo || '-')}</span></div>` : ''}
        </div>

        <div class="rnd-linkrow">
          <a href="javascript:void(0)" onclick="App.navigate('rndSchedule')">일정 ${c.miles}</a>
          <a href="javascript:void(0)" onclick="App.navigate('rndSpec')">규격 ${c.specs}</a>
          <a href="javascript:void(0)" onclick="App.navigate('rndNote')">연구기록 ${c.notes}</a>
          <a href="javascript:void(0)" onclick="App.navigate('rndKnowledge')">지식자산 ${c.knows}</a>
          <a href="javascript:void(0)" onclick="App.navigate('rndCollab')">협업 ${c.collabs}</a>
        </div>

        ${u.fileStrip(p.files, { hideEmpty: true })}

        <div class="rnd-card-actions">
          <button class="btn btn-sm btn-primary" onclick="RndProjectPage.openChecks('${p.id}','${p.stage}')">현재 단계 절차 체크</button>
          <button class="btn btn-sm" onclick="RndProjectPage.advance('${p.id}')">다음 단계로</button>
          <button class="btn btn-sm" onclick="RndProjectPage.openEdit('${p.id}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="RndProjectPage.remove('${p.id}')">삭제</button>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getProjectsBy(u.fac());
    const rows = list();
    const overdue = all.filter(p => p.status === 'ACTIVE' && p.dueDate && p.dueDate < RndDB.todayStr()).length;
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 제품개발</div>
            <h2>개발과제관리</h2>
            <p>절차서 5.1~5.13 업무절차를 따라 과제를 진행합니다. 단계를 누르면 그 단계의 절차 체크항목이 열립니다.</p>
            <div class="rnd-docref">근거 ${RndDB.PROCEDURE.docNo} ${RndDB.PROCEDURE.title} (Rev.${RndDB.PROCEDURE.rev}) · 적용범위 ${RndDB.PROCEDURE.scope}</div>
          </div>
          <div class="module-metrics">
            <div><span>${all.filter(x => x.status === 'ACTIVE').length}</span><label>진행중</label></div>
            <div><span>${all.filter(x => x.status === 'DONE').length}</span><label>완료</label></div>
            <div><span>${all.filter(x => x.status === 'HOLD').length}</span><label>보류</label></div>
            <div><span>${overdue}</span><label>기한 초과</label></div>
          </div>
        </div>

        ${u.toolbar('rnd-proj', {
          placeholder: '과제명 · 코드 · 책임자 · 목표 검색',
          q,
          onSearch: 'RndProjectPage.onSearch',
          onAdd: 'RndProjectPage.openAdd()',
          addLabel: '과제 등록',
          extra: '<button class="btn btn-sm" onclick="RndProjectPage.openOwners()">담당 부서 설정</button>',
          filters: `<select class="form-input rnd-filter" onchange="RndProjectPage.onStage(this.value)">
                      <option value="">전체 단계</option>
                      ${RndDB.stageList().map(([k, v]) => `<option value="${k}" ${fStage === k ? 'selected' : ''}>${u.esc(v.no)} ${u.esc(v.label)}</option>`).join('')}
                    </select>`
                 + u.selectFilter('rnd-proj-status', RndDB.PROJ_STATUS, fStatus, 'RndProjectPage.onStatus', '전체 상태'),
        })}

        <div class="rnd-list">
          ${rows.length ? rows.map(card).join('')
            : u.emptyState('등록된 개발과제가 없습니다', '제품기획에서 승인하거나 ＋ 과제 등록으로 직접 만드십시오.')}
        </div>

        ${modal()}
        ${checkModal()}
        ${ownerModal()}
      </div>`;
  };

  // 담당 부서 설정 — 절차서 문구(브랜드전략팀·제품혁신팀 등)를 실제 조직 팀명으로 바꿔 쓴다.
  //   비워두면 절차서 기본값으로 되돌아간다.
  const ownerModal = () => {
    const u = U();
    const s = RndDB.getSettings();
    return `
      <div class="modal-overlay" id="rnd-owner-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>담당 부서 설정</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-owner-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="rnd-notice">
              기본값은 ${u.esc(RndDB.PROCEDURE.docNo)} 절차서에 적힌 부서명입니다.
              조직 개편으로 팀명이 달라졌으면 여기서 바꾸십시오. 화면 전체(단계 표시·일정 담당·안내 문구)에 함께 반영됩니다.
              <strong>칸을 비우면 절차서 기본값으로 되돌아갑니다.</strong>
            </div>

            <div class="rnd-formsec">프로세스 구간 (설계개발관리 PROCESS)</div>
            <div class="rnd-ownerlist">
              ${RndDB.phaseList().map(([k, v]) => `
                <div class="rnd-ownerrow">
                  <label>${u.esc(v.label)}</label>
                  <input type="text" class="form-input" id="ow-p-${k}"
                         value="${u.esc(s.phaseOwners[k] || '')}" placeholder="${u.esc(v.owner)}">
                </div>`).join('')}
            </div>

            <div class="rnd-formsec">업무절차 단계 (5.1 ~ 5.13)</div>
            <div class="rnd-ownerlist">
              ${RndDB.stageList().map(([k, v]) => `
                <div class="rnd-ownerrow">
                  <label><em>${u.esc(v.no)}</em> ${u.esc(v.label)}</label>
                  <input type="text" class="form-input" id="ow-s-${k}"
                         value="${u.esc(s.stageOwners[k] || '')}" placeholder="${u.esc(v.owner)}">
                </div>`).join('')}
            </div>

            ${s.updatedAt ? `<div class="form-hint mt-8">최종 수정 ${u.esc(u.dateOnly(s.updatedAt))}${s.updatedBy ? ` · ${u.esc(s.updatedBy)}` : ''}</div>` : ''}
          </div>
          <div class="modal-footer">
            <button class="btn btn-danger" onclick="RndProjectPage.resetOwners()">전체 기본값 복원</button>
            <button class="btn" onclick="RndUI.closeModal('rnd-owner-modal')">취소</button>
            <button class="btn btn-primary" onclick="RndProjectPage.saveOwners()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openOwners = () => { App.refreshPage(); RndUI.openModal('rnd-owner-modal'); };

  const saveOwners = () => {
    const stageOwners = {}, phaseOwners = {};
    RndDB.stageList().forEach(([k]) => { stageOwners[k] = RndUI.val('ow-s-' + k); });
    RndDB.phaseList().forEach(([k]) => { phaseOwners[k] = RndUI.val('ow-p-' + k); });
    RndDB.saveSettings({ stageOwners, phaseOwners }, RndUI.actorName());
    RndUI.closeModal('rnd-owner-modal');
    App.toast('담당 부서를 저장했습니다', 'success');
    App.refreshPage();
  };

  const resetOwners = () => {
    if (!confirm('담당 부서를 절차서 기본값으로 모두 되돌립니다.\n계속할까요?')) return;
    RndDB.resetOwners();
    RndUI.closeModal('rnd-owner-modal');
    App.toast('절차서 기본값으로 복원했습니다', 'success');
    App.refreshPage();
  };

  // 단계별 절차 체크 — 절차서 조항을 그대로 띄우고 이행 여부를 남긴다
  let checkFor = null, checkStage = null;
  const checkModal = () => {
    const u = U();
    const p = checkFor ? RndDB.getProjectById(checkFor) : null;
    const stage = checkStage || p?.stage || 'S01';
    const v = RndDB.stageMeta(stage);
    const items = RndDB.checksOf(stage);
    const arr = (p?.checks || {})[stage] || [];
    return `
      <div class="modal-overlay" id="rnd-check-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${u.esc(v.no)} ${u.esc(v.label)} — 절차 체크</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-check-modal')">✕</button>
          </div>
          <div class="modal-body">
            ${p ? `
              <div class="rnd-checkhead">
                <div><label>과제</label><span>${u.esc(p.code)} · ${u.esc(p.name)}</span></div>
                <div><label>프로세스 구간</label><span>${u.esc(RndDB.phaseMeta(v.phase).label)}</span></div>
                <div><label>담당</label><span>${u.esc(RndDB.stageOwner(stage))}</span></div>
                <div><label>근거</label><span>${u.esc(RndDB.PROCEDURE.docNo)} ${u.esc(RndDB.PROCEDURE.title)} ${u.esc(v.no)}</span></div>
              </div>
              <div class="rnd-checklist">
                ${items.map((t, i) => `
                  <label class="rnd-checkrow ${arr[i] ? 'on' : ''}">
                    <input type="checkbox" ${arr[i] ? 'checked' : ''}
                           onchange="RndProjectPage.toggleCheck('${p.id}','${stage}',${i},this.checked)">
                    <span>${u.esc(t)}</span>
                  </label>`).join('')}
              </div>
              <div class="rnd-stagenav">
                ${RndDB.stageList().map(([k, sv]) => `
                  <button class="rnd-stagenav-btn ${k === stage ? 'active' : ''}"
                          onclick="RndProjectPage.openChecks('${p.id}','${k}')">${u.esc(sv.no)}</button>`).join('')}
              </div>
            ` : '<div class="rnd-files-empty">과제를 찾을 수 없습니다</div>'}
          </div>
          <div class="modal-footer">
            ${p && stage === p.stage ? `<button class="btn" onclick="RndProjectPage.advance('${p.id}')">다음 단계로</button>` : ''}
            <button class="btn btn-primary" onclick="RndUI.closeModal('rnd-check-modal')">닫기</button>
          </div>
        </div>
      </div>`;
  };

  const openChecks = (id, stage) => {
    checkFor = id; checkStage = stage;
    App.refreshPage();
    RndUI.openModal('rnd-check-modal');
  };
  const toggleCheck = (id, stage, idx, on) => {
    RndDB.toggleCheck(id, stage, idx, on);
    // 모달은 다시 그리지 않는다 — 체크할 때마다 모달이 닫히면 연속 입력이 안 된다.
    // 카드 목록만 갱신해 진행률을 반영한다.
    repaintList();
    const row = document.querySelectorAll('#rnd-check-modal .rnd-checkrow')[idx];
    if (row) row.classList.toggle('on', !!on);
  };

  const modal = () => {
    const u = U();
    const p = editId ? RndDB.getProjectById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-proj-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${p ? '개발과제 수정' : '개발과제 등록'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-proj-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">과제명 <em>*</em></label>
                <input type="text" class="form-input" id="pj-name" value="${u.esc(p?.name || '')}"></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="pj-factory">${u.factoryOptions(p?.factory || u.defaultFactory())}</select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">축종</label>
                <input type="text" class="form-input" id="pj-species" value="${u.esc(p?.species || '')}"></div>
              <div class="form-group"><label class="form-label">업무절차 단계</label>
                <select class="form-input" id="pj-stage">
                  ${RndDB.stageList().map(([k, v]) => `<option value="${k}" ${(p?.stage || 'S01') === k ? 'selected' : ''}>${u.esc(v.no)} ${u.esc(v.label)}</option>`).join('')}
                </select></div>
              <div class="form-group"><label class="form-label">중요도</label>
                <select class="form-input" id="pj-priority">${u.options(RndDB.PRIORITY, p?.priority || 'MID')}</select></div>
              <div class="form-group"><label class="form-label">상태</label>
                <select class="form-input" id="pj-status">${u.options(RndDB.PROJ_STATUS, p?.status || 'ACTIVE')}</select></div>
            </div>
            <div class="form-group"><label class="form-label">개발 목표</label>
              <textarea class="form-input" id="pj-goal" rows="2">${u.esc(p?.goal || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">책임자</label>
                <input type="text" class="form-input" id="pj-leader" value="${u.esc(p?.leader || u.actorName())}"></div>
              <div class="form-group"><label class="form-label">참여자</label>
                <input type="text" class="form-input" id="pj-members" value="${u.esc(p?.members || '')}" placeholder="쉼표로 구분"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">시작일</label>
                <input type="date" class="form-input" id="pj-start" value="${u.esc(p?.startDate || RndDB.todayStr())}"></div>
              <div class="form-group"><label class="form-label">목표 완료일</label>
                <input type="date" class="form-input" id="pj-due" value="${u.esc(p?.dueDate || '')}"></div>
              <div class="form-group"><label class="form-label">예산(천원)</label>
                <input type="number" class="form-input" id="pj-budget" value="${p?.budget || ''}"></div>
              <div class="form-group"><label class="form-label">집행(천원)</label>
                <input type="number" class="form-input" id="pj-spent" value="${p?.spent || ''}"></div>
            </div>
            <div class="form-group"><label class="form-label">진척률(%)</label>
              <input type="number" class="form-input" id="pj-progress" min="0" max="100" value="${p?.progress || 0}">
              <div class="form-hint">마일스톤이 등록되면 실적 기준으로 자동 계산된 값이 우선 표시됩니다.</div></div>

            <div class="rnd-formsec">${RndDB.RECORDS.RESULT_DOC.docNo} 개발결과보고서 (${RndDB.RECORDS.RESULT_DOC.dept} · 보존 ${RndDB.RECORDS.RESULT_DOC.keep})</div>
            <div class="form-group"><label class="form-label">개발 결과</label>
              <textarea class="form-input" id="pj-result" rows="3" placeholder="목표 대비 달성 수준 · 관능/사양테스트 결과 · 미해결 사항">${u.esc(p?.result || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">사전원가(제품 원단위)</label>
                <input type="text" class="form-input" id="pj-rcost" value="${u.esc(p?.resultCost || '')}" placeholder="예: 톤당 000,000원"></div>
              <div class="form-group"><label class="form-label">사료성분등록 번호</label>
                <input type="text" class="form-input" id="pj-rspec" value="${u.esc(p?.resultSpecNo || '')}" placeholder="도청 축산과 등록번호"></div>
              <div class="form-group"><label class="form-label">보고자</label>
                <input type="text" class="form-input" id="pj-rby" value="${u.esc(p?.resultReporter || '')}"></div>
              <div class="form-group"><label class="form-label">보고일</label>
                <input type="date" class="form-input" id="pj-rdate" value="${u.esc(p?.resultDate || '')}"></div>
            </div>
            ${p ? '' : `<div class="form-group">
              <label class="rnd-check"><input type="checkbox" id="pj-seed" checked> 절차서 5.1~5.13 기본 일정 13단계를 함께 생성</label></div>`}
            ${u.attachBox('proj', '과제 계획서·중간보고·결과보고 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-proj-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndProjectPage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => { editId = null; App.refreshPage(); RndUI.resetBucket('proj', []); RndUI.openModal('rnd-proj-modal'); RndUI.renderBucket('proj'); };
  const openEdit = (id) => {
    editId = id;
    const p = RndDB.getProjectById(id);
    App.refreshPage();
    RndUI.resetBucket('proj', (p?.files || []).slice());
    RndUI.openModal('rnd-proj-modal');
    RndUI.renderBucket('proj');
  };

  const submit = () => {
    const u = U();
    const name = u.val('pj-name');
    if (!name) { App.toast('과제명을 입력하십시오', 'warning'); return; }
    const data = {
      name,
      factory: u.val('pj-factory'),
      species: u.val('pj-species'),
      stage: u.val('pj-stage'),
      priority: u.val('pj-priority'),
      status: u.val('pj-status'),
      goal: u.val('pj-goal'),
      leader: u.val('pj-leader'),
      members: u.val('pj-members'),
      startDate: u.val('pj-start'),
      dueDate: u.val('pj-due'),
      budget: u.num('pj-budget'),
      spent: u.num('pj-spent'),
      progress: u.num('pj-progress'),
      result: u.val('pj-result'),
      resultCost: u.val('pj-rcost'),
      resultSpecNo: u.val('pj-rspec'),
      resultReporter: u.val('pj-rby'),
      resultDate: u.val('pj-rdate'),
      files: u.bucket('proj').slice(),
    };
    if (editId) {
      RndDB.updateProject(editId, data);
    } else {
      const proj = RndDB.addProject(data);
      if (u.checked('pj-seed')) RndDB.seedMilestones(proj.id, proj.factory, proj.startDate);
    }
    editId = null;
    RndUI.closeModal('rnd-proj-modal');
    App.toast('개발과제를 저장했습니다', 'success');
    App.refreshPage();
  };

  const advance = (id) => {
    const p = RndDB.getProjectById(id);
    if (!p) return;
    // 절차 체크가 남았어도 막지는 않는다 — 현장에서 순서가 뒤집히는 일이 실제로 있다.
    // 다만 무엇이 남았는지는 반드시 알린다.
    if (!RndDB.canAdvance(p)) {
      const s = RndDB.checkState(p, p.stage);
      const v = RndDB.stageMeta(p.stage);
      if (!confirm(`${v.no} ${v.label} 절차 체크가 ${s.total - s.done}건 남아 있습니다.\n(${s.done}/${s.total} 완료)\n\n그래도 다음 단계로 넘어갈까요?`)) return;
    }
    const seq = RndDB.stageList().map(([k]) => k);
    const i = seq.indexOf(p.stage);
    if (i < 0 || i >= seq.length - 1) {
      RndDB.updateProject(id, { status: 'DONE' });
      App.toast('5.13 상업생산까지 완료 — 과제를 완료 처리했습니다', 'success');
    } else {
      const nx = RndDB.stageMeta(seq[i + 1]);
      RndDB.updateProject(id, { stage: seq[i + 1] });
      App.toast(`${nx.no} ${nx.label} 단계로 이동했습니다 (담당: ${RndDB.stageOwner(seq[i + 1])})`, 'success');
    }
    RndUI.closeModal('rnd-check-modal');
    App.refreshPage();
  };

  const remove = (id) => {
    if (!RndUI.confirmDelete('개발과제')) return;
    RndDB.removeProject(id);
    App.toast('삭제했습니다 — 연결된 일정·규격·기록은 그대로 남습니다', 'success');
    App.refreshPage();
  };

  const onSearch = (v) => { q = v; repaintList(); };
  const onStage = (v) => { fStage = v; repaintList(); };
  const onStatus = (v) => { fStatus = v; repaintList(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const rows = list();
    el.innerHTML = rows.length ? rows.map(card).join('')
      : RndUI.emptyState('조건에 맞는 과제가 없습니다', '검색어나 필터를 바꿔보십시오.');
  };

  return {
    render, afterRender: () => {}, openAdd, openEdit, submit, advance, remove,
    openChecks, toggleCheck, openOwners, saveOwners, resetOwners,
    onSearch, onStage, onStatus,
  };
})();


// ============================================================
// 제품규격
// ============================================================
const RndSpecPage = (() => {
  const U = () => RndUI;
  let q = '', fStatus = '';
  let editId = null;
  let rows = [];   // 모달에서 편집 중인 규격 항목

  const DEFAULT_ROWS = [
    { name: '수분', unit: '%', target: '', lower: '', upper: '13.0', method: 'AOAC 930.15' },
    { name: '조단백', unit: '%', target: '', lower: '', upper: '', method: 'AOAC 990.03' },
    { name: '조지방', unit: '%', target: '', lower: '', upper: '', method: 'AOAC 920.39' },
    { name: '조섬유', unit: '%', target: '', lower: '', upper: '', method: 'AOAC 962.09' },
    { name: '조회분', unit: '%', target: '', lower: '', upper: '', method: 'AOAC 942.05' },
    { name: '칼슘', unit: '%', target: '', lower: '', upper: '', method: 'ICP' },
    { name: '인', unit: '%', target: '', lower: '', upper: '', method: 'ICP' },
    { name: 'PDI(펠렛 내구도)', unit: '%', target: '', lower: '90', upper: '', method: 'Holmen' },
  ];

  const specs = () => {
    const u = U();
    return RndDB.getSpecsBy(u.fac())
      .filter(s => !fStatus || s.status === fStatus)
      .filter(s => u.matches(q, s.productName, s.productCode, s.code, s.version, u.projectLabel(s.projectId)));
  };

  const rangeText = (it) => {
    const lo = String(it.lower ?? '').trim(), hi = String(it.upper ?? '').trim(), tg = String(it.target ?? '').trim();
    if (lo && hi) return `${lo} ~ ${hi}`;
    if (lo) return `${lo} 이상`;
    if (hi) return `${hi} 이하`;
    if (tg) return `${tg} (목표)`;
    return '-';
  };

  const card = (s) => {
    const u = U();
    return `
      <div class="card rnd-card">
        <div class="rnd-card-head">
          <div>
            <div class="rnd-card-code">${u.esc(s.code)} · ${u.esc(s.version)} · ${u.esc(u.facName(s.factory))}</div>
            <h4 class="rnd-card-title">${u.esc(s.productName || '(제품명 미입력)')}${s.productCode ? ` <em>${u.esc(s.productCode)}</em>` : ''}</h4>
          </div>
          <div class="rnd-card-badges">
            ${u.badge(RndDB.SPEC_STATUS, s.status)}
            ${s.form ? `<span class="rnd-chip">${u.esc(s.form)}</span>` : ''}
            ${u.fileChip(s.files)}
          </div>
        </div>

        <div class="rnd-kv">
          ${s.projectId ? `<div><label>연결 과제</label><span>${u.esc(u.projectLabel(s.projectId))}</span></div>` : ''}
          ${s.appearance ? `<div><label>외관 기준</label><span>${u.nl2br(s.appearance)}</span></div>` : ''}
          <div><label>포장 / 유통기한 / 보관</label><span>${u.esc(s.packaging || '-')} / ${u.esc(s.shelfLife || '-')} / ${u.esc(s.storage || '-')}</span></div>
          <div><label>작성 / 승인 / 시행</label><span>${u.esc(s.author || '-')} / ${u.esc(s.approver || '-')} / ${u.esc(s.effDate || '-')}</span></div>
          ${s.revisionNote ? `<div><label>개정 사유</label><span>${u.nl2br(s.revisionNote)}</span></div>` : ''}
        </div>

        ${(s.items || []).length ? `
          <div class="table-wrap">
            <table class="data-table rnd-spec-table">
              <thead><tr><th>항목</th><th>단위</th><th class="td-right">기준</th><th class="td-right">목표</th><th>분석법</th></tr></thead>
              <tbody>${s.items.map(it => `<tr>
                <td>${u.esc(it.name)}</td>
                <td>${u.esc(it.unit || '')}</td>
                <td class="td-right mono">${u.esc(rangeText(it))}</td>
                <td class="td-right mono">${u.esc(it.target || '-')}</td>
                <td class="text-sm text-muted">${u.esc(it.method || '')}</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : '<div class="rnd-files-empty">규격 항목이 없습니다</div>'}

        ${u.fileStrip(s.files, { hideEmpty: true })}

        <div class="rnd-card-actions">
          ${s.status === 'DRAFT' ? `<button class="btn btn-sm btn-primary" onclick="RndSpecPage.approve('${s.id}')">승인</button>` : ''}
          ${s.status !== 'OBSOLETE' ? `<button class="btn btn-sm" onclick="RndSpecPage.revise('${s.id}')">개정</button>` : ''}
          <button class="btn btn-sm" onclick="RndSpecPage.openEdit('${s.id}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="RndSpecPage.remove('${s.id}')">삭제</button>
        </div>
      </div>`;
  };

  const render = () => {
    const u = U();
    const all = RndDB.getSpecsBy(u.fac());
    const list = specs();
    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 제품개발</div>
            <h2>제품규격</h2>
            <p>절차서 5.11 규격확정 단계의 산출물입니다. 고칠 때는 덮어쓰지 않고 새 버전을 만들어 이력을 남깁니다.</p>
            <div class="rnd-docref">규격확정품은 도청 축산과 사료성분등록 신청 대상입니다 — 인증관리·품질 워크스페이스의 사료성분등록증 화면과 함께 확인하십시오.</div>
          </div>
          <div class="module-metrics">
            <div><span>${all.length}</span><label>전체 규격</label></div>
            <div><span>${all.filter(x => x.status === 'DRAFT').length}</span><label>초안</label></div>
            <div><span>${all.filter(x => x.status === 'APPROVED').length}</span><label>승인</label></div>
            <div><span>${all.filter(x => x.status === 'OBSOLETE').length}</span><label>구버전</label></div>
          </div>
        </div>

        ${u.toolbar('rnd-spec', {
          placeholder: '제품명 · 제품코드 · 버전 · 과제 검색',
          q,
          onSearch: 'RndSpecPage.onSearch',
          onAdd: 'RndSpecPage.openAdd()',
          addLabel: '규격 등록',
          filters: u.selectFilter('rnd-spec-status', RndDB.SPEC_STATUS, fStatus, 'RndSpecPage.onStatus', '전체 상태'),
        })}

        <div class="rnd-list">
          ${list.length ? list.map(card).join('')
            : u.emptyState('등록된 제품규격이 없습니다', '＋ 규격 등록으로 기준 항목부터 정의하십시오.')}
        </div>

        ${modal()}
      </div>`;
  };

  const rowHtml = (r, i) => `
    <tr>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.name || '')}" oninput="RndSpecPage.onRow(${i},'name',this.value)" placeholder="항목명"></td>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.unit || '')}" oninput="RndSpecPage.onRow(${i},'unit',this.value)" placeholder="%"></td>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.lower || '')}" oninput="RndSpecPage.onRow(${i},'lower',this.value)" placeholder="하한"></td>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.upper || '')}" oninput="RndSpecPage.onRow(${i},'upper',this.value)" placeholder="상한"></td>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.target || '')}" oninput="RndSpecPage.onRow(${i},'target',this.value)" placeholder="목표"></td>
      <td><input type="text" class="form-input" value="${RndUI.esc(r.method || '')}" oninput="RndSpecPage.onRow(${i},'method',this.value)" placeholder="분석법"></td>
      <td><button class="btn btn-sm" onclick="RndSpecPage.delRow(${i})">✕</button></td>
    </tr>`;

  const modal = () => {
    const u = U();
    const s = editId ? RndDB.getSpecById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-spec-modal">
        <div class="modal modal-lg">
          <div class="modal-header">
            <h3>${s ? '제품규격 수정' : '제품규격 등록'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-spec-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-row">
              <div class="form-group"><label class="form-label">제품명 <em>*</em></label>
                <input type="text" class="form-input" id="sp-name" value="${u.esc(s?.productName || '')}"></div>
              <div class="form-group"><label class="form-label">제품코드</label>
                <input type="text" class="form-input" id="sp-code" value="${u.esc(s?.productCode || '')}"></div>
              <div class="form-group"><label class="form-label">공장·소속</label>
                <select class="form-input" id="sp-factory">${u.factoryOptions(s?.factory || u.defaultFactory())}</select></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">연결 과제</label>
                <select class="form-input" id="sp-project">${u.projectOptions(s?.projectId || '')}</select></div>
              <div class="form-group"><label class="form-label">버전</label>
                <input type="text" class="form-input" id="sp-version" value="${u.esc(s?.version || 'V1.0')}"></div>
              <div class="form-group"><label class="form-label">상태</label>
                <select class="form-input" id="sp-status">${u.options(RndDB.SPEC_STATUS, s?.status || 'DRAFT')}</select></div>
              <div class="form-group"><label class="form-label">성상</label>
                <input type="text" class="form-input" id="sp-form" value="${u.esc(s?.form || '')}" placeholder="펠릿 / 매쉬 / 크럼블 / EP"></div>
            </div>

            <div class="form-group">
              <label class="form-label">규격 항목</label>
              <div class="table-wrap">
                <table class="data-table rnd-spec-edit">
                  <thead><tr><th>항목</th><th>단위</th><th>하한</th><th>상한</th><th>목표</th><th>분석법</th><th></th></tr></thead>
                  <tbody id="sp-rows">${rows.map(rowHtml).join('')}</tbody>
                </table>
              </div>
              <div class="flex gap-8 mt-8">
                <button class="btn btn-sm" onclick="RndSpecPage.addRow()">＋ 항목 추가</button>
                <button class="btn btn-sm" onclick="RndSpecPage.loadDefaults()">기본 항목 불러오기</button>
              </div>
            </div>

            <div class="form-group"><label class="form-label">외관 기준</label>
              <textarea class="form-input" id="sp-appearance" rows="2" placeholder="색상·형상·이물 허용 한도 등">${u.esc(s?.appearance || '')}</textarea></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">포장</label>
                <input type="text" class="form-input" id="sp-packaging" value="${u.esc(s?.packaging || '')}" placeholder="25kg 지대 / 톤백"></div>
              <div class="form-group"><label class="form-label">유통기한</label>
                <input type="text" class="form-input" id="sp-shelf" value="${u.esc(s?.shelfLife || '')}" placeholder="제조일로부터 3개월"></div>
              <div class="form-group"><label class="form-label">보관 조건</label>
                <input type="text" class="form-input" id="sp-storage" value="${u.esc(s?.storage || '')}" placeholder="직사광선을 피한 건냉소"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">작성자</label>
                <input type="text" class="form-input" id="sp-author" value="${u.esc(s?.author || u.actorName())}" readonly></div>
              <div class="form-group"><label class="form-label">승인자</label>
                <input type="text" class="form-input" id="sp-approver" value="${u.esc(s?.approver || '')}"></div>
              <div class="form-group"><label class="form-label">시행일</label>
                <input type="date" class="form-input" id="sp-eff" value="${u.esc(s?.effDate || '')}"></div>
            </div>
            <div class="form-group"><label class="form-label">개정 사유</label>
              <input type="text" class="form-input" id="sp-revnote" value="${u.esc(s?.revisionNote || '')}"></div>
            ${u.attachBox('spec', '규격서 원본·성적서·승인 문서 등')}
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-spec-modal')">취소</button>
            <button class="btn btn-primary" data-upload-lock onclick="RndSpecPage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const openAdd = () => {
    editId = null; rows = JSON.parse(JSON.stringify(DEFAULT_ROWS));
    App.refreshPage(); RndUI.resetBucket('spec', []); RndUI.openModal('rnd-spec-modal'); RndUI.renderBucket('spec');
  };
  const openEdit = (id) => {
    editId = id;
    const s = RndDB.getSpecById(id);
    rows = JSON.parse(JSON.stringify(s?.items || []));
    App.refreshPage();
    RndUI.resetBucket('spec', (s?.files || []).slice());
    RndUI.openModal('rnd-spec-modal'); RndUI.renderBucket('spec');
  };

  // 항목 표는 모달을 다시 그리면 입력 포커스가 날아간다. tbody 만 갈아끼운다.
  const repaintRows = () => {
    const el = document.getElementById('sp-rows');
    if (el) el.innerHTML = rows.map(rowHtml).join('');
  };
  const onRow = (i, field, v) => { if (rows[i]) rows[i][field] = v; };
  const addRow = () => { rows.push({ name: '', unit: '', lower: '', upper: '', target: '', method: '' }); repaintRows(); };
  const delRow = (i) => { rows.splice(i, 1); repaintRows(); };
  const loadDefaults = () => { rows = JSON.parse(JSON.stringify(DEFAULT_ROWS)); repaintRows(); };

  const submit = () => {
    const u = U();
    const productName = u.val('sp-name');
    if (!productName) { App.toast('제품명을 입력하십시오', 'warning'); return; }
    const data = {
      productName,
      productCode: u.val('sp-code'),
      factory: u.val('sp-factory'),
      projectId: u.val('sp-project'),
      version: u.val('sp-version') || 'V1.0',
      status: u.val('sp-status'),
      form: u.val('sp-form'),
      items: rows.filter(r => String(r.name || '').trim()),
      appearance: u.val('sp-appearance'),
      packaging: u.val('sp-packaging'),
      shelfLife: u.val('sp-shelf'),
      storage: u.val('sp-storage'),
      author: u.val('sp-author') || u.actorName(),
      approver: u.val('sp-approver'),
      effDate: u.val('sp-eff'),
      revisionNote: u.val('sp-revnote'),
      files: u.bucket('spec').slice(),
    };
    if (editId) RndDB.updateSpec(editId, data); else RndDB.addSpec(data);
    editId = null;
    RndUI.closeModal('rnd-spec-modal');
    App.toast('제품규격을 저장했습니다', 'success');
    App.refreshPage();
  };

  const approve = (id) => {
    RndDB.updateSpec(id, { status: 'APPROVED', approver: RndUI.actorName(), effDate: RndDB.todayStr() });
    App.toast('규격을 승인했습니다', 'success');
    App.refreshPage();
  };

  const revise = (id) => {
    const note = prompt('개정 사유를 입력하십시오');
    if (note === null) return;
    const s = RndDB.reviseSpec(id, note, RndUI.actorName());
    if (s) App.toast(`${s.version} 초안을 생성했습니다 — 기존 버전은 구버전으로 내렸습니다`, 'success');
    App.refreshPage();
  };

  const remove = (id) => {
    if (!RndUI.confirmDelete('제품규격')) return;
    RndDB.removeSpec(id); App.toast('삭제했습니다', 'success'); App.refreshPage();
  };

  const onSearch = (v) => { q = v; repaintList(); };
  const onStatus = (v) => { fStatus = v; repaintList(); };
  const repaintList = () => {
    const el = document.querySelector('.rnd-list');
    if (!el) return;
    const l = specs();
    el.innerHTML = l.length ? l.map(card).join('')
      : RndUI.emptyState('조건에 맞는 규격이 없습니다', '검색어나 상태 필터를 바꿔보십시오.');
  };

  return {
    render, afterRender: () => {}, openAdd, openEdit, submit, approve, revise, remove,
    onRow, addRow, delRow, loadDefaults, onSearch, onStatus,
  };
})();


// ============================================================
// 개발일정 (마일스톤 간트)
// ============================================================
const RndSchedulePage = (() => {
  const U = () => RndUI;
  let selProject = '';
  let editId = null;

  const projects = () => RndDB.getProjectsBy(RndUI.fac());
  const current = () => {
    const list = projects();
    if (selProject && list.some(p => p.id === selProject)) return selProject;
    return list[0]?.id || '';
  };

  // 간트 범위 — 마일스톤 계획·실적 날짜를 모두 감싸는 구간
  const span = (miles) => {
    const ds = [];
    miles.forEach(m => [m.planStart, m.planEnd, m.actualStart, m.actualEnd].forEach(d => { if (d) ds.push(d); }));
    if (!ds.length) return null;
    ds.sort();
    const from = new Date(ds[0]), to = new Date(ds[ds.length - 1]);
    // 좌우 여백 — 막대가 표 끝에 붙으면 읽기 어렵다
    from.setDate(from.getDate() - 7);
    to.setDate(to.getDate() + 7);
    const days = Math.max(1, Math.round((to - from) / 86400000));
    return { from, to, days };
  };

  const pct = (sp, dateStr) => {
    if (!dateStr) return null;
    return Math.max(0, Math.min(100, (new Date(dateStr) - sp.from) / 86400000 / sp.days * 100));
  };

  const monthTicks = (sp) => {
    const out = [];
    const d = new Date(sp.from.getFullYear(), sp.from.getMonth(), 1);
    while (d <= sp.to) {
      const p = (d - sp.from) / 86400000 / sp.days * 100;
      if (p >= 0 && p <= 100) out.push({ p, label: `${d.getFullYear() % 100}.${String(d.getMonth() + 1).padStart(2, '0')}` });
      d.setMonth(d.getMonth() + 1);
    }
    return out;
  };

  const gantt = (miles) => {
    const u = U();
    const sp = span(miles);
    if (!sp) return '<div class="rnd-files-empty">날짜가 입력된 마일스톤이 없습니다</div>';
    const today = pct(sp, RndDB.todayStr());
    return `
      <div class="rnd-gantt">
        <div class="rnd-gantt-head">
          <div class="rnd-gantt-label"></div>
          <div class="rnd-gantt-track">
            ${monthTicks(sp).map(t => `<span class="rnd-gantt-tick" style="left:${t.p}%">${t.label}</span>`).join('')}
          </div>
        </div>
        ${miles.map(m => {
          const st = RndDB.effectiveMileStatus(m);
          const ps = pct(sp, m.planStart), pe = pct(sp, m.planEnd);
          const as = pct(sp, m.actualStart), ae = pct(sp, m.actualEnd || RndDB.todayStr());
          return `
          <div class="rnd-gantt-row">
            <div class="rnd-gantt-label" title="${u.esc(m.title)}">
              <span class="rnd-gantt-phase">${u.esc(RndDB.stageMeta(m.phase).label)}</span>
              ${u.esc(m.title)}
            </div>
            <div class="rnd-gantt-track">
              ${today !== null ? `<span class="rnd-gantt-today" style="left:${today}%"></span>` : ''}
              ${ps !== null && pe !== null ? `<div class="rnd-bar plan" style="left:${ps}%;width:${Math.max(0.6, pe - ps)}%" title="계획 ${u.esc(m.planStart)} ~ ${u.esc(m.planEnd)}"></div>` : ''}
              ${as !== null ? `<div class="rnd-bar act ${st.toLowerCase()}" style="left:${as}%;width:${Math.max(0.6, (ae ?? as) - as)}%" title="실적 ${u.esc(m.actualStart)} ~ ${u.esc(m.actualEnd || '진행중')}"></div>` : ''}
            </div>
          </div>`;
        }).join('')}
        <div class="rnd-gantt-legend">
          <span><i class="plan"></i> 계획</span>
          <span><i class="act"></i> 실적</span>
          <span><i class="act delay"></i> 지연</span>
          <span><i class="today"></i> 오늘</span>
        </div>
      </div>`;
  };

  const table = (miles) => {
    const u = U();
    if (!miles.length) return u.emptyState('마일스톤이 없습니다', '＋ 마일스톤 추가로 일정을 만드십시오.');
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>단계</th><th>마일스톤</th><th>계획</th><th>실적</th><th>담당</th><th>상태</th><th>비고</th><th></th>
          </tr></thead>
          <tbody>${miles.map(m => {
            const st = RndDB.effectiveMileStatus(m);
            return `<tr>
              <td>${u.esc(RndDB.stageMeta(m.phase).label)}</td>
              <td><strong>${u.esc(m.title)}</strong></td>
              <td class="mono text-sm">${u.esc(m.planStart || '-')} ~ ${u.esc(m.planEnd || '-')}</td>
              <td class="mono text-sm">${u.esc(m.actualStart || '-')} ~ ${u.esc(m.actualEnd || '-')}</td>
              <td>${u.esc(m.owner || '-')}</td>
              <td>${u.badge(RndDB.MILE_STATUS, st)}</td>
              <td class="text-sm text-muted">${u.esc(m.note || '')}</td>
              <td class="rnd-row-actions">
                ${st !== 'DONE' ? `<button class="btn btn-sm" onclick="RndSchedulePage.complete('${m.id}')">완료</button>` : ''}
                <button class="btn btn-sm" onclick="RndSchedulePage.openEdit('${m.id}')">수정</button>
                <button class="btn btn-sm btn-danger" onclick="RndSchedulePage.remove('${m.id}')">삭제</button>
              </td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  };

  const render = () => {
    const u = U();
    const list = projects();
    const pid = current();
    const proj = pid ? RndDB.getProjectById(pid) : null;
    const miles = pid ? RndDB.getMilestonesOf(pid) : [];
    const delayed = miles.filter(m => RndDB.effectiveMileStatus(m) === 'DELAY').length;
    const done = miles.filter(m => m.status === 'DONE').length;

    return `
      <div class="fade-in">
        <div class="module-hero mb-20">
          <div>
            <div class="module-kicker">연구관리 · 제품개발</div>
            <h2>개발일정</h2>
            <p>제품개발일정표(절차서 5.4 심의 대상)입니다. 계획 종료일이 지나면 자동으로 지연 처리됩니다.</p>
          </div>
          <div class="module-metrics">
            <div><span>${miles.length}</span><label>마일스톤</label></div>
            <div><span>${done}</span><label>완료</label></div>
            <div><span>${delayed}</span><label>지연</label></div>
            <div><span>${miles.length ? Math.round(done / miles.length * 100) : 0}%</span><label>진척</label></div>
          </div>
        </div>

        ${list.length ? `
          <div class="rnd-toolbar">
            <select class="form-input rnd-projsel" onchange="RndSchedulePage.onProject(this.value)">
              ${list.map(p => `<option value="${p.id}" ${pid === p.id ? 'selected' : ''}>${u.esc(p.code)} · ${u.esc(p.name)} (${u.label(RndDB.PROJ_STATUS, p.status)})</option>`).join('')}
            </select>
            <div class="rnd-toolbar-right">
              ${miles.length ? '' : `<button class="btn btn-sm" onclick="RndSchedulePage.seed()">절차서 5.1~5.13 일정 생성</button>`}
              <button class="btn btn-primary btn-sm" onclick="RndSchedulePage.openAdd()">＋ 마일스톤 추가</button>
            </div>
          </div>

          ${proj ? `<div class="card mb-16">
            <div class="card-title mb-12">${u.esc(proj.code)} · ${u.esc(proj.name)} — 일정 개요</div>
            ${gantt(miles)}
          </div>` : ''}

          <div class="card">${table(miles)}</div>
        ` : u.emptyState('개발과제가 없습니다', '개발과제관리에서 과제를 먼저 등록하십시오.')}

        ${modal(pid)}
      </div>`;
  };

  const modal = (pid) => {
    const u = U();
    const m = editId ? RndDB.getMilestoneById(editId) : null;
    return `
      <div class="modal-overlay" id="rnd-mile-modal">
        <div class="modal">
          <div class="modal-header">
            <h3>${m ? '마일스톤 수정' : '마일스톤 추가'}</h3>
            <button class="modal-close" onclick="RndUI.closeModal('rnd-mile-modal')">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group"><label class="form-label">마일스톤 <em>*</em></label>
              <input type="text" class="form-input" id="ms-title" value="${u.esc(m?.title || '')}" placeholder="예: 파일럿 시험생산 2차"></div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">업무절차 단계</label>
                <select class="form-input" id="ms-phase">
                  ${RndDB.stageList().map(([k, v]) => `<option value="${k}" ${(m?.phase || 'S01') === k ? 'selected' : ''}>${u.esc(v.no)} ${u.esc(v.label)}</option>`).join('')}
                </select></div>
              <div class="form-group"><label class="form-label">상태</label>
                <select class="form-input" id="ms-status">${u.options(RndDB.MILE_STATUS, m?.status || 'TODO')}</select></div>
              <div class="form-group"><label class="form-label">담당</label>
                <input type="text" class="form-input" id="ms-owner" value="${u.esc(m?.owner || u.actorName())}"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">계획 시작</label>
                <input type="date" class="form-input" id="ms-ps" value="${u.esc(m?.planStart || '')}"></div>
              <div class="form-group"><label class="form-label">계획 종료</label>
                <input type="date" class="form-input" id="ms-pe" value="${u.esc(m?.planEnd || '')}"></div>
            </div>
            <div class="form-row">
              <div class="form-group"><label class="form-label">실적 시작</label>
                <input type="date" class="form-input" id="ms-as" value="${u.esc(m?.actualStart || '')}"></div>
              <div class="form-group"><label class="form-label">실적 종료</label>
                <input type="date" class="form-input" id="ms-ae" value="${u.esc(m?.actualEnd || '')}"></div>
            </div>
            <div class="form-group"><label class="form-label">비고</label>
              <input type="text" class="form-input" id="ms-note" value="${u.esc(m?.note || '')}"></div>
            <input type="hidden" id="ms-project" value="${u.esc(m?.projectId || pid || '')}">
          </div>
          <div class="modal-footer">
            <button class="btn" onclick="RndUI.closeModal('rnd-mile-modal')">취소</button>
            <button class="btn btn-primary" onclick="RndSchedulePage.submit()">저장</button>
          </div>
        </div>
      </div>`;
  };

  const onProject = (v) => { selProject = v; App.refreshPage(); };
  const openAdd = () => { editId = null; App.refreshPage(); RndUI.openModal('rnd-mile-modal'); };
  const openEdit = (id) => { editId = id; App.refreshPage(); RndUI.openModal('rnd-mile-modal'); };

  const submit = () => {
    const u = U();
    const title = u.val('ms-title');
    if (!title) { App.toast('마일스톤명을 입력하십시오', 'warning'); return; }
    const projectId = u.val('ms-project') || current();
    const proj = RndDB.getProjectById(projectId);
    const data = {
      title, projectId,
      factory: proj?.factory || u.defaultFactory(),
      phase: u.val('ms-phase'),
      status: u.val('ms-status'),
      owner: u.val('ms-owner'),
      planStart: u.val('ms-ps'),
      planEnd: u.val('ms-pe'),
      actualStart: u.val('ms-as'),
      actualEnd: u.val('ms-ae'),
      note: u.val('ms-note'),
    };
    if (editId) RndDB.updateMilestone(editId, data); else RndDB.addMilestone(data);
    editId = null;
    RndUI.closeModal('rnd-mile-modal');
    App.toast('마일스톤을 저장했습니다', 'success');
    App.refreshPage();
  };

  const complete = (id) => {
    const m = RndDB.getMilestoneById(id);
    RndDB.updateMilestone(id, {
      status: 'DONE',
      actualStart: m?.actualStart || m?.planStart || RndDB.todayStr(),
      actualEnd: RndDB.todayStr(),
    });
    App.toast('완료 처리했습니다', 'success');
    App.refreshPage();
  };

  const seed = () => {
    const pid = current();
    const proj = RndDB.getProjectById(pid);
    if (!proj) return;
    RndDB.seedMilestones(pid, proj.factory, proj.startDate);
    App.toast('절차서 5.1~5.13 기본 일정을 생성했습니다', 'success');
    App.refreshPage();
  };

  const remove = (id) => {
    if (!RndUI.confirmDelete('마일스톤')) return;
    RndDB.removeMilestone(id); App.refreshPage();
  };

  return { render, afterRender: () => {}, onProject, openAdd, openEdit, submit, complete, seed, remove };
})();
