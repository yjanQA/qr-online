// ============================================================
// lab_coa.js — 시험성적서(COA) 발행
//   분석대장(lab_records)의 완료 분석건을 우성사료 성적서 양식으로 렌더하고
//   미리보기 후 인쇄/PDF 출력. 양식 출처: 우성사료 성적서.pdf
// ============================================================

const LabCOA = (() => {
  // 항목 key → 표준 분석방법 (성적서 "분석방법" 칸)
  const METHODS = {
    moist: '사료표준분석 1.1.가.135℃ 2시간',
    protein_n: '근적외선분광법(NIR검사법)',
    protein: '사료표준분석 1.2.나.자동분석법(Kjeltec Method)',
    fat: '사료표준분석 1.4.가.에테르 추출법',
    afat: '사료표준분석 1.4.나.산분해법',
    fiber: '사료표준분석 1.3.조섬유',
    fiber_c: '사료표준분석 1.3.조섬유',
    ash: '사료표준분석 1.5.조회분',
    starch: '사료표준분석 전분 정량법',
    adf: '사료표준분석 ADF',
    ndf: '사료표준분석 NDF',
    salt: '사료표준분석 염화물 정량',
    afla: 'HPLC / ELISA 정량',
    vomi_don: 'HPLC 정량',
    zearal: 'HPLC 정량',
    sal_c: '분자생물학적(PCR) 시험법',
    sal_pcr: '분자생물학적(PCR) 시험법',
  };
  // 무기물·중금속은 대부분 ICP 발광분광분석법
  const methodOf = (it) => {
    if (METHODS[it.key]) return METHODS[it.key];
    if (it.group === '무기물' || it.group === '중금속') return '사료표준분석 4.19. ICP 발광분광분석법';
    if (it.group === '곰팡이독소') return 'HPLC / ELISA 정량';
    if (it.group === '아미노산') return '아미노산 자동분석법';
    if (it.group === '지방산') return 'GC 정량';
    if (it.group === '물리분석') return '물리분석(사내규정)';
    return '';
  };

  // 성적서 표시용 항목명(양식에 맞춘 별칭) — 없으면 마스터 label 사용
  const COA_LABEL = {
    moist: '수분(%)', protein_n: '조단백질(N)', protein: '조단백질(K)',
    fat: '조지방', afat: '조지방(산분해)', fiber: '조섬유', fiber_c: '조섬유(F)',
    ash: '조회분', starch: '전분', ca: '칼슘', p: '인',
    cu_ppm: '구리(ppm)', zn_ppm: '아연(ppm)', fe_ppm: '철(ppm)', mn_ppm: '망간(ppm)',
    na: '나트륨', k: '칼륨', salt: '염분',
  };
  const coaLabel = (it) => COA_LABEL[it.key] || it.label;

  const esc2 = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fmtD = (d) => { const s = String(d || ''); return s ? s.slice(0, 10) : '-'; };

  // 회사 정보(성적서 하단 고정) — 우성사료 논산공장 성적서 기준
  const COMPANY = {
    addr: '33003 / 충청남도 논산시 은진면 안심로 259-3 (주)우성사료',
    tel: '000-000-0000', fax: '000-000-0000', email: 'quality@example.com',
    disclaimer: '(이 성적은 제시된 검체에 한하여 의뢰 목적 이외의 상품선전 및 상업용에 사용할 수 없음)',
  };

  // 성적서 본문 HTML(오버레이 안에 삽입) 생성
  const sheetHtml = (rec) => {
    const isRaw = rec.kind === 'raw';
    const items = LabDB.getItems().filter(it => typeof (rec.vals && rec.vals[it.key]) === 'number');
    const rows = items.map((it, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td class="l">${esc2(coaLabel(it))}</td>
        <td class="c"><b>${fmtNum(rec.vals[it.key])}</b></td>
        <td class="c">${esc2(it.unit || '')}</td>
        <td class="l">${esc2(methodOf(it))}</td>
        <td class="c"></td>
      </tr>`).join('');
    const today = new Date().toISOString().slice(0, 10);
    const notoDate = rec.completedAt ? fmtD(rec.completedAt) : today;

    return `
    <div class="coa-sheet">
      <div class="coa-brand">
        <img src="assets/ws-logo.svg" width="52" alt="우성" class="coa-logo">
        <div class="coa-title">시 험 성 적 서</div>
        <div style="width:52px"></div>
      </div>

      <table class="coa-info">
        <tr>
          <td class="lb">사 업 장</td><td>사업1본부</td>
          <td class="lb">신청부서</td><td>품질1팀</td>
          <td class="lb">신 청 자</td><td>${esc2(rec.by || '-')}</td>
        </tr>
        <tr>
          <td class="lb">접수번호</td><td class="mono">${esc2(rec.id)}</td>
          <td class="lb">접수일자</td><td>${fmtD(rec.date)}</td>
          <td class="lb">통보일자</td><td>${notoDate}</td>
        </tr>
        <tr>
          <td class="lb">시 료 명</td><td>${esc2(rec.name || rec.code)}</td>
          <td class="lb">${isRaw ? '공급처' : '배합비'}</td><td>${esc2(isRaw ? (rec.supplier || '') : (rec.formula || ''))}</td>
          <td class="lb">${isRaw ? '모선명' : '생산일'}</td><td>${esc2(isRaw ? (rec.origin || '') : fmtD(rec.prodDate))}</td>
        </tr>
        <tr>
          <td class="lb">비 고</td><td colspan="5">${esc2(rec.note || '')}</td>
        </tr>
      </table>

      <table class="coa-result">
        <thead>
          <tr><th>NO</th><th>분 석 항 목</th><th>분석결과</th><th>단위</th><th>분석방법</th><th>비 고</th></tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6" class="c" style="padding:16px">분석 결과가 없습니다</td></tr>'}</tbody>
      </table>

      <div class="coa-approve">Approved by LAB Manager</div>

      <div class="coa-footer">
        <div>주 소 : ${esc2(COMPANY.addr)}</div>
        <div>전 화 : ${esc2(COMPANY.tel)}</div>
        <div>팩 스 : ${esc2(COMPANY.fax)}</div>
        <div>E-mail : ${esc2(COMPANY.email)}</div>
        <div class="coa-disc">${esc2(COMPANY.disclaimer)}</div>
      </div>
    </div>`;
  };

  // 성적서 전용 스타일(1회 주입)
  const ensureStyle = () => {
    if (document.getElementById('coa-style')) return;
    const st = document.createElement('style');
    st.id = 'coa-style';
    st.textContent = `
    .coa-overlay { position:fixed; inset:0; background:rgba(0,0,0,.6); z-index:9999; overflow:auto; padding:20px; }
    .coa-toolbar { position:sticky; top:0; z-index:1; display:flex; gap:8px; justify-content:center; margin-bottom:14px; }
    .coa-toolbar button { padding:8px 16px; border:0; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; }
    .coa-btn-print { background:#4f9cff; color:#fff; }
    .coa-btn-close { background:#33384a; color:#e5e9f0; }
    .coa-sheet { background:#fff; color:#111; width:210mm; max-width:100%; min-height:290mm; margin:0 auto;
      padding:16mm 15mm; box-shadow:0 4px 24px rgba(0,0,0,.5); box-sizing:border-box;
      display:flex; flex-direction:column;
      font-family:'Malgun Gothic','맑은 고딕',sans-serif; font-size:12px; line-height:1.5; }
    .coa-sheet th, .coa-sheet td, .coa-sheet td b { color:#111; }
    .coa-sheet thead tr { background:transparent; }
    .coa-brand { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
    .coa-logo { height:auto; display:block; }
    .coa-title { font-size:26px; font-weight:800; letter-spacing:8px; text-align:center; flex:1; }
    .coa-info { width:100%; border-collapse:collapse; margin-bottom:14px; }
    .coa-info td { border:1px solid #000; padding:6px 9px; font-size:12px; }
    .coa-info .lb { background:#eee; font-weight:700; text-align:center; white-space:nowrap; width:66px; }
    .coa-info .mono { font-family:'Consolas',monospace; }
    .coa-result { width:100%; border-collapse:collapse; }
    .coa-result th, .coa-result td { border:1px solid #000; padding:6px 8px; font-size:12px; }
    .coa-result th { background:#eee; font-weight:700; text-align:center; }
    .coa-result td.c { text-align:center; }
    .coa-result td.l { text-align:left; }
    /* 앱 전역 tbody tr:last-child td{border-bottom:none} 가 성적서 표 맨 아랫줄을 지우므로 복원 */
    .coa-sheet .coa-result tr:last-child td, .coa-sheet .coa-info tr:last-child td { border-bottom:1px solid #000; }
    .coa-approve { margin-top:auto; padding-top:26px; text-align:right; font-size:13px; font-weight:600; padding-right:6px; }
    .coa-footer { margin-top:30px; border-top:1.5px solid #000; padding-top:8px; font-size:11px; color:#222; }
    .coa-footer > div { margin:1px 0; }
    .coa-disc { margin-top:6px; font-size:10.5px; color:#555; }
    @media print {
      body > *:not(.coa-overlay) { display:none !important; }
      .coa-overlay { position:static; background:#fff; padding:0; overflow:visible; }
      .coa-toolbar { display:none !important; }
      .coa-sheet { box-shadow:none; width:auto; min-height:265mm; margin:0; padding:0; }
      @page { size:A4; margin:14mm; }
    }`;
    document.head.appendChild(st);
  };

  // 성적서 미리보기 오버레이 열기
  const open = (recordId) => {
    const rec = LabDB.getRecordById(recordId);
    if (!rec) { App.toast('분석 레코드를 찾을 수 없습니다', 'error'); return; }
    if (!rec.vals || Object.keys(rec.vals).length === 0) { App.toast('분석 결과값이 없어 성적서를 만들 수 없습니다', 'warning'); return; }
    ensureStyle();
    close();
    const ov = document.createElement('div');
    ov.className = 'coa-overlay';
    ov.id = 'coa-overlay';
    ov.innerHTML = `
      <div class="coa-toolbar">
        <button class="coa-btn-print" onclick="LabCOA.print()">인쇄 / PDF 저장</button>
        <button class="coa-btn-close" onclick="LabCOA.close()">✕ 닫기</button>
      </div>
      ${sheetHtml(rec)}`;
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    document.body.appendChild(ov);
  };
  const print = () => { window.print(); };
  const close = () => { document.getElementById('coa-overlay')?.remove(); };

  return { open, print, close };
})();
