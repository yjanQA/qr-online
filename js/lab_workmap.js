// ============================================================
// lab_workmap.js — 품질 업무맵(커버리지 대시보드)
//   품질팀 업무체계도(4.1~4.12)를 플랫폼 모듈과 1:1 매핑하여
//   각 업무의 디지털 연동상태(연동 /부분 /미구축)를 한눈에.
//   · 클릭 시 해당 모듈로 이동(App.navigate)
//   · 로드맵 태그(A1·A2·B1 …)로 고도화 우선순위 표시
//   출처: 4. 업무체계도(품질팀) '작성(품질)' 시트
// ============================================================

const QualityWorkmapPage = (() => {
  let filter = 'all';   // all | gap | plan | live

  // 상태: live=연동, part=부분, none=미구축
  const ST = {
    live: { icon: '', label: '연동', cls: 'wm-live' },
    part: { icon: '', label: '부분', cls: 'wm-part' },
    none: { icon: '', label: '미구축', cls: 'wm-none' },
  };

  // 업무체계도 → 모듈 매핑 (sub 단위)
  //   { no, t(제목), s(상태), p(페이지키·있으면 이동), plan(로드맵태그), leaves[] }
  const TREE = [
    { no: '4.1', t: '원료 품질', subs: [
      { no: '4.1.1', t: '원료규격서', s: 'part', p: 'spec', leaves: ['규격서 제개정', '모선/원산지/납품처별 특장점', '원료특성·반품기준'] },
      { no: '4.1.2', t: '원료입고검수', s: 'live', p: 'receiving', leaves: ['수입원료', '국내원료', '액상원료', '첨가제'] },
      { no: '4.1.3', t: '장기보관원료 품질확인', s: 'none', plan: 'C4', leaves: ['동물성단백질', '첨가제', '유통기간 확인', '유해물질 분석'] },
      { no: '4.1.4', t: '원료평가', s: 'part', p: 'matrix', leaves: ['원료매트릭스자동작성', '위해분석', '신원료 평가', '관능검사 체크시트(C1)'] },
      { no: '4.1.5', t: '납품업체 방문점검', s: 'part', p: 'supplier', leaves: ['생산공정·품질점검', '유효성분 평가', '품질규격·기준 확인'] },
      { no: '4.1.6', t: '옥수수 BCFM 평가', s: 'live', p: 'cornGrade', leaves: ['정상/비정상/미성숙입자', '이물질 혼입', '용적중 점검'] },
      { no: '4.1.7', t: '원료 TIV 관리', s: 'none', plan: 'B2', leaves: ['증감량 확인', '원인분석'] },
    ]},
    { no: '4.2', t: '공정 품질', subs: [
      { no: '4.2.1', t: '가공품질(경도·PDI·용적중)', s: 'part', p: 'psa', plan: 'A1', leaves: ['경도', 'PDI', '용적중'] },
      { no: '4.2.2', t: '배합', s: 'part', p: 'batch', plan: 'B1', leaves: ['배합정밀도 검사', 'Batch list 점검', '오배합/오생산(B1)', 'Fine·미등재 사용량'] },
      { no: '4.2.3', t: '포장', s: 'none', plan: 'C1', leaves: ['한도견본', '용적중·입자도', '흐름도(Flowability)', '중량검사'] },
      { no: '4.2.4', t: '원료분쇄', s: 'part', p: 'psa', leaves: ['분쇄원료', '입자도·용적중'] },
      { no: '4.2.5', t: '후레이크', s: 'none', plan: 'C1', leaves: ['수분', '두께', '알파화도'] },
      { no: '4.2.6', t: '첫·끝물 처리', s: 'none', leaves: ['지침서 관리', '부적합품 처리·사용', '파포·Fine·미등재 발생량'] },
    ]},
    { no: '4.3', t: '제품 품질', subs: [
      { no: '4.3.1', t: '제품규격서', s: 'part', p: 'spec', leaves: ['규격서 제개정', '축종별/제품별 기준', '제품스펙&분석결과 비교'] },
      { no: '4.3.2', t: '제품 검수', s: 'live', p: 'input', leaves: ['NIRs 분석', '고속분쇄기', '화학분석', '물리적분석'] },
      { no: '4.3.3', t: '후레이크 제품', s: 'none', plan: 'C1', leaves: ['분리도 시험(Segregation)', '외관 검사(당밀 코팅)', '물리적 품질 점검'] },
      { no: '4.3.4', t: '부재료 관리', s: 'part', p: 'subMaterial', plan: 'B3', leaves: ['용기검사', '용기 시험성적서', '지대 표시사항 점검'] },
      { no: '4.3.5', t: '제조일자 관리', s: 'part', p: 'productStock', leaves: ['무포장 제품(톤백)', '지대 제품'] },
    ]},
    { no: '4.4', t: '품질 운영관리', subs: [
      { no: '4.4.1', t: '배합비 정보', s: 'live', p: 'formulaTrend', leaves: ['배합비 특이사항(양축/양어/반려)', '배합비 추이분석'] },
      { no: '4.4.2', t: '원료 정보', s: 'part', p: 'raw', leaves: ['원료 특이사항', '부적합품 보고서(원료)', '동물성단백질 원료평가'] },
      { no: '4.4.3', t: '고객불만 / VOC', s: 'live', p: 'voc', leaves: ['접수 건수', '유형별/축종별 요약', '기록대장(조사·조치)'] },
      { no: '4.4.4', t: '공정 품질 관련', s: 'part', plan: 'A1', leaves: ['재배합내역(B1)', '반품/반입 요약', '미등재 발생·비용(B1)', '공정기준율 조단백·조지방(A1)', '물성품질 경도·PDI', '용적중', '입자도', 'TIV 분석'] },
      { no: '4.4.5', t: '분석 현황', s: 'live', p: 'raw', leaves: ['원료 분석현황', '제품 분석현황'] },
      { no: '4.4.6', t: '고객관리', s: 'none', leaves: ['고객방문 내역', '주문사료 내역·비용 분석'] },
      { no: '4.4.7', t: '교육관련', s: 'none', plan: 'C3', leaves: ['내외부 교육 내용'] },
    ]},
    { no: '4.5', t: '사료공장 HACCP 관리', subs: [
      { no: '4.5.1', t: 'HACCP 관리기준서', s: 'live', p: 'haccpDocs', leaves: ['매뉴얼·제품설명서·제조공정도', '위해요소분석', 'CCP 결정도', 'CCP Plan'] },
      { no: '4.5.2', t: '선행요건프로그램', s: 'live', p: 'haccpDocs', leaves: ['절차서(18)', '지침서(6)', '작업표준', 'QC 공정도'] },
      { no: '4.5.3', t: '유효성평가', s: 'live', p: 'validation', leaves: ['내부심사', '실행성평가', '계획 점검표', '자가품질검사'] },
    ]},
    { no: '4.6', t: 'ISO 품질시스템 관리', subs: [
      { no: '4.6.1', t: '절차서/지침서', s: 'none', plan: 'C2', leaves: ['표준문서·자료관리절차서', '교육훈련절차서'] },
      { no: '4.6.2', t: '추가 절차서(인사총무)', s: 'none', plan: 'C2', leaves: ['조직·업무분장', '보험·소송관리'] },
      { no: '4.6.3', t: '추가 절차서(안전·개발)', s: 'none', plan: 'C2', leaves: ['제품안전표시', '리플렛·광고', '홈페이지', '개발관리'] },
      { no: '4.6.4', t: '추가 절차서(품질·배합)', s: 'none', plan: 'C2', leaves: ['품질정보관리', '배합비관리'] },
    ]},
    { no: '4.7', t: 'SQF 식품안전품질(반려)', subs: [
      { no: '4.7.1', t: 'SQF Edition 9.0', s: 'live', p: 'sqfDocs', leaves: ['Food Safety Manual', 'Procedures(20)', 'GMP Tables(6)'] },
    ]},
    { no: '4.8', t: '사료관리법', subs: [
      { no: '4.8.1', t: '제품 등록/변경', s: 'none', plan: 'B4', leaves: ['신제품 등록', '파생제품 등록'] },
      { no: '4.8.2', t: '정부사료검사', s: 'none', plan: 'B4', leaves: ['각 시도 관공서', '국립농산물품질관리원'] },
      { no: '4.8.3', t: '부재료 관리', s: 'part', p: 'subMaterial', leaves: ['지대표기 점검', '지대 디자인 점검', '용기/포장지 성적서 확인'] },
      { no: '4.8.4', t: '제품스펙·설계치 점검', s: 'part', p: 'matrix', leaves: ['원료스펙·원료매트릭스', '제품스펙·등록성분'] },
      { no: '4.8.5', t: '유해물질 자가품질검사', s: 'part', p: 'qualityRd', leaves: ['외부시험기관 분석', '자체시험 분석'] },
    ]},
    { no: '4.9', t: '분석 관리', subs: [
      { no: '4.9.1', t: '시험표준관리', s: 'part', p: 'items', leaves: ['일반성분', '특수성분', '물리적 분석'] },
      { no: '4.9.2', t: '필드/조사료 분석', s: 'none', leaves: ['조사료 분석결과 통보서', '수질 분석결과 통보서'] },
      { no: '4.9.3', t: '분석기기 관리', s: 'part', p: 'equipment', plan: 'B', leaves: ['분석기기 이력관리', '수리점검 내역', 'NIRs 검량식 관리'] },
      { no: '4.9.4', t: '분석 정확도·신뢰성', s: 'none', plan: 'B', leaves: ['AAFCO 분석결과', '사료협회 회원사 분석결과'] },
    ]},
    { no: '4.10', t: '인적자원관리', subs: [
      { no: '4.10.1', t: '실적관리', s: 'none', plan: 'A2', leaves: ['주간품질보고(A2)', '주간품질데이터 관리'] },
      { no: '4.10.2', t: 'HACCP 교육', s: 'none', plan: 'C3', leaves: ['외부교육(10h/년)', '내부교육(12h/년)'] },
      { no: '4.10.3', t: '벌크운송기사 교육', s: 'none', plan: 'C3', leaves: ['공장 기사', '영업소 기사'] },
      { no: '4.10.4', t: '영업소/대리점 기사 교육', s: 'none', plan: 'C3', leaves: ['운송기사 교육'] },
    ]},
    { no: '4.11', t: '기타', subs: [
      { no: '4.11.1', t: '목표관리(KPI)', s: 'none', plan: 'A2', leaves: ['KPI 목표/실적'] },
      { no: '4.11.2', t: '방역관리', s: 'part', p: 'pestControl', leaves: ['정문 소독 약제', '공장 내외곽 소독', '외부 소독/방역 업체 관리'] },
      { no: '4.11.3', t: '품질캠페인', s: 'none', leaves: ['분임조 활동', '하절기품질캠페인'] },
    ]},
    { no: '4.12', t: '고객만족', subs: [
      { no: '4.12.1', t: '품질모니터링', s: 'none', plan: 'A2', leaves: ['축종/담당자별 내용 요약'] },
      { no: '4.12.2', t: '품질정보', s: 'none', leaves: ['주요 원료 이슈', '제품 특이사항', '가축질병/방역 정보'] },
      { no: '4.12.3', t: 'VOC · 고객불만', s: 'part', p: 'voc', leaves: ['VOC 내용 확인', '원인분석·조치', '해피콜'] },
      { no: '4.12.4', t: '주문사료(SOP) 관리', s: 'none', leaves: ['처리내역·비용 분석'] },
    ]},
  ];

  // 로드맵 태그 설명(툴팁)
  const PLAN_DESC = {
    A1: '공정품질 통합 관제', A2: '주간품질보고·KPI 자동화', A3: '원료 매트릭스',
    B1: '손실비용 분석', B2: '원료 TIV 이상탐지', B3: '부재료·용기 성적서', B4: '사료관리법 제품등록',
    B: '분석 신뢰성 관리', C1: '디지털 체크시트', C2: '문서·절차서 관리센터', C3: '교육·인적자원', C4: '장기보관원료 알림',
  };

  const allSubs = () => TREE.flatMap(a => a.subs);
  const counts = () => {
    const c = { live: 0, part: 0, none: 0, total: 0 };
    allSubs().forEach(s => { c[s.s]++; c.total++; });
    return c;
  };

  const pct = (n, t) => t ? Math.round((n / t) * 100) : 0;

  const summaryBar = () => {
    const c = counts();
    const score = pct(c.live + c.part * 0.5, c.total);   // 부분=0.5 가중
    return `
      <div class="wm-summary">
        <div class="wm-score">
          <div class="wm-score-num">${score}<span>%</span></div>
          <div class="wm-score-lb">디지털 커버리지</div>
          <div class="wm-progress"><div class="wm-progress-fill" style="width:${score}%"></div></div>
        </div>
        <div class="wm-stats">
          <button class="wm-stat ${filter === 'all' ? 'on' : ''}" onclick="QualityWorkmapPage.setFilter('all')">
            <b>${c.total}</b><span>전체 세부업무</span></button>
          <button class="wm-stat ${filter === 'live' ? 'on' : ''}" onclick="QualityWorkmapPage.setFilter('live')">
            <b class="wm-live">${c.live}</b><span>연동</span></button>
          <button class="wm-stat ${filter === 'gap' ? 'on' : ''}" onclick="QualityWorkmapPage.setFilter('gap')">
            <b class="wm-none">${c.none}</b><span>미구축</span></button>
          <button class="wm-stat ${filter === 'plan' ? 'on' : ''}" onclick="QualityWorkmapPage.setFilter('plan')">
            <b class="wm-plan">${allSubs().filter(s => s.plan).length}</b><span>고도화 로드맵</span></button>
        </div>
      </div>`;
  };

  const matchFilter = (s) => {
    if (filter === 'all') return true;
    if (filter === 'live') return s.s === 'live';
    if (filter === 'gap') return s.s === 'none' || s.s === 'part';
    if (filter === 'plan') return !!s.plan;
    return true;
  };

  const subRow = (s) => {
    const st = ST[s.s];
    const clickable = s.p ? `onclick="App.navigate('${s.p}')"` : '';
    const planBadge = s.plan
      ? `<span class="wm-plan-badge" title="${PLAN_DESC[s.plan] || ''}">${s.plan}</span>` : '';
    const goHint = s.p ? '<span class="wm-go">이동 ›</span>' : '';
    return `
      <div class="wm-sub ${st.cls} ${s.p ? 'wm-clickable' : ''}" ${clickable}>
        <div class="wm-sub-head">
          <span class="wm-dot">${st.icon}</span>
          <span class="wm-sub-no">${s.no}</span>
          <span class="wm-sub-t">${s.t}</span>
          ${planBadge}
          ${goHint}
        </div>
        <div class="wm-leaves">${s.leaves.map(l => `<span class="wm-leaf">${l}</span>`).join('')}</div>
      </div>`;
  };

  const areaCard = (a) => {
    const subs = a.subs.filter(matchFilter);
    if (!subs.length) return '';
    const c = { live: 0, part: 0, none: 0 };
    a.subs.forEach(s => c[s.s]++);
    return `
      <div class="wm-area">
        <div class="wm-area-head">
          <span class="wm-area-no">${a.no}</span>
          <span class="wm-area-t">${a.t}</span>
          <span class="wm-area-mini">${c.live}${c.part}${c.none}</span>
        </div>
        <div class="wm-area-body">${subs.map(subRow).join('')}</div>
      </div>`;
  };

  const render = () => {
    return `
      <style>
        .wm-wrap{max-width:1180px;margin:0 auto;padding:4px 0 40px;}
        .wm-intro{color:var(--text-secondary,#5c5f66);font-size:13px;margin:2px 0 16px;line-height:1.6;}
        .wm-summary{display:flex;gap:20px;align-items:center;flex-wrap:wrap;
          background:var(--bg-surface,#fff);border:1px solid var(--border,#e3e3e3);border-radius:6px;padding:18px 22px;margin-bottom:18px;}
        .wm-score{min-width:200px;}
        .wm-score-num{font-size:38px;font-weight:700;color:var(--accent,#3E6AE1);line-height:1;}
        .wm-score-num span{font-size:18px;margin-left:2px;}
        .wm-score-lb{font-size:12px;color:var(--text-secondary,#5c5f66);margin:4px 0 8px;}
        .wm-progress{height:6px;background:var(--bg-soft,#f0f0f0);border-radius:3px;overflow:hidden;}
        .wm-progress-fill{height:100%;background:var(--accent,#3E6AE1);border-radius:3px;transition:width .4s;}
        .wm-stats{display:flex;gap:10px;flex-wrap:wrap;flex:1;}
        .wm-stat{background:var(--bg-soft,#f5f5f5);border:1px solid transparent;border-radius:6px;padding:10px 16px;
          cursor:pointer;text-align:center;min-width:96px;transition:.15s;font-family:inherit;}
        .wm-stat:hover{border-color:var(--accent,#3E6AE1);}
        /* 선택 상태: 배경을 칠하면 다크 테마에서 글자가 묻히므로 투명 배경 + 테두리만 강조 */
        .wm-stat.on{border:2px solid var(--accent,#3E6AE1);background:transparent;padding:9px 15px;}
        .wm-stat b{display:block;font-size:19px;}
        .wm-stat span{font-size:11px;color:var(--text-secondary,#5c5f66);}
        .wm-live{color:#16884a;} .wm-part{color:#b8860b;} .wm-none{color:#9aa0a6;} .wm-plan{color:#c0392b;}
        .wm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px;}
        .wm-area{background:var(--bg-surface,#fff);border:1px solid var(--border,#e3e3e3);border-radius:6px;overflow:hidden;}
        .wm-area-head{display:flex;align-items:center;gap:8px;padding:11px 14px;background:var(--bg-soft,#f7f7f8);border-bottom:1px solid var(--border,#e3e3e3);}
        .wm-area-no{font-weight:700;color:var(--accent,#3E6AE1);font-size:13px;}
        .wm-area-t{font-weight:600;font-size:14px;flex:1;}
        .wm-area-mini{font-size:11px;color:var(--text-secondary,#5c5f66);letter-spacing:-.3px;}
        .wm-area-body{padding:8px;}
        .wm-sub{border:1px solid var(--border,#ececec);border-radius:5px;padding:9px 11px;margin-bottom:7px;background:#fff;}
        .wm-sub:last-child{margin-bottom:0;}
        .wm-sub.wm-clickable{cursor:pointer;transition:.12s;}
        .wm-sub.wm-clickable:hover{border-color:var(--accent,#3E6AE1);box-shadow:0 1px 0 rgba(62,106,225,.15);}
        .wm-sub.wm-none{background:#fcfcfc;border-style:dashed;}
        .wm-sub-head{display:flex;align-items:center;gap:7px;}
        .wm-dot{font-size:11px;}
        .wm-sub-no{font-size:11px;color:var(--text-secondary,#8a8f96);font-weight:600;}
        .wm-sub-t{font-size:13px;font-weight:600;flex:1;}
        .wm-plan-badge{font-size:10px;background:#fdecec;color:#c0392b;border-radius:3px;padding:2px 6px;font-weight:700;white-space:nowrap;}
        .wm-go{font-size:11px;color:var(--accent,#3E6AE1);font-weight:600;}
        .wm-leaves{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px;}
        .wm-leaf{font-size:10.5px;color:var(--text-secondary,#666);background:var(--bg-soft,#f3f4f6);border-radius:3px;padding:2px 7px;}
        @media (prefers-color-scheme:dark){
          .wm-leaf,.wm-sub{background:transparent;}
        }
      </style>
      <div class="wm-wrap">
        ${summaryBar()}
        <div class="wm-grid" id="wm-grid">
          ${TREE.map(areaCard).join('')}
        </div>
      </div>`;
  };

  const setFilter = (f) => {
    filter = f;
    const el = document.getElementById('page-content');
    if (el) el.innerHTML = render();
  };

  return { render, setFilter };
})();
