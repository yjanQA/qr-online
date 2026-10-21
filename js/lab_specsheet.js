// ============================================================
// lab_specsheet.js — 원료 규격서 (반려원료 규격)
//   · 원본 Word 양식(.doc 17종)을 그대로 재현하고, 플랫폼 안에서 항목만 수정한다.
//   · 원본은 data/rawSpecSheets.js 에 상주(불변), 수정분은 LabDB override 로 저장(원본복원 가능).
//   · 수정 시 사유·작성자(로그인 계정)·개정번호를 개정이력에 남긴다.
// ============================================================

const SpecSheetPage = (() => {
  let openId = null;        // 열려있는 규격서 id (null이면 목록)
  let editing = false;      // 상세 편집 모드
  let query = '';
  let groupFilter = 'ALL';
  let newPhoto = null;      // 편집 중 새로 첨부한 사진(data URI, ''이면 삭제)
  let newForm = 'A';        // 새 규격서 모달에서 고른 양식
  let trash = false;        // 휴지통(삭제된 규격서) 보기

  // ── 규격서 양식 골격 ───────────────────────────────────
  //   원본 .doc 두 양식의 항목 구성·라벨을 그대로 사용한다(양식 변경 없음).
  const BLOCK_DEFS = {
    name:       { label: '원 료 명', line: true },
    def:        { label: '정    의', line: false },
    effect:     { label: '효    과', line: false },
    origin:     { label: '원 산 지', line: true },
    proximate:  { label: '일반성분', line: false },
    general:    { label: '일반적특성', line: false },
    stdSpec:    { label: '표준규격', line: false },
    analysis:   { label: '분석성분', line: false },
    appearance: { label: '성상', line: false },
    efficacy:   { label: '효능 및 효과', line: false },
    dosage:     { label: '용법 및 용량', line: false },
    hazard:     { label: '위해내역', line: false },
    storage:    { label: '원료의 저장 및 유통방법', line: false },
    shelf:      { label: '유통기한', line: true },
    inbound:    { label: '입고시의 검사 (특별조치)', line: false },
    factors:    { label: '품질에 영향을 미치는 인자', line: false },
    reject:     { label: '반품기준', line: false },
    etc:        { label: '기 타', line: false },
  };
  // A=신양식(일반성분 표·원산지·저장유통), B=구양식(일반적특성·효능효과·용법용량)
  const FORM_BLOCKS = {
    A: ['name', 'def', 'effect', 'origin', 'proximate', 'hazard', 'storage', 'shelf', 'inbound', 'reject'],
    B: ['name', 'def', 'general', 'appearance', 'efficacy', 'dosage', 'factors', 'reject', 'etc'],
  };
  const PROX_COLS = ['수분', '조단백', '조지방', '조섬유', '조회분', '칼슘', '인', 'starch'];

  // 원료규격 표준 분류(사내 문서번호 WSE-SJ-<번호> 체계)
  const CATEGORIES = [
    ['100', '곡물류'], ['110', '강피류'], ['120', '식물성단백질류'], ['130', '근괴류'],
    ['140', '식품가공류'], ['150', '조류'], ['160', '섬유질류'], ['180', '식물성유지류'],
    ['190', '전분류'], ['200', '동물성단백질류'], ['210', '동물성무기물류'], ['220', '동물성유지류'],
    ['300', '식염류'], ['310', '인산염류 및 칼슘염류'], ['320', '다량 광물질류'], ['330', '미량 광물질류'],
    ['340', '혼합 광물질'], ['400', '기타 유지류'], ['410', '단세포단백질'], ['500', '대용유'],
    ['600', '결착제'], ['610', '유화제'], ['620', '보존제'], ['630', '아미노산제'], ['640', '비타민제'],
    ['650', '효소제'], ['660', '생균제'], ['670', '향미제'], ['680', '비단백태질소화합물'],
    ['690', '규산염제'], ['700', '완충제'], ['710', '착색제'], ['720', '추출제'], ['730', '올리고당'],
  ];

  const sheets = () => LabDB.getSpecSheets();
  const sheet = (id) => LabDB.getSpecSheet(id);
  const groups = () => Array.from(new Set(sheets().map(s => s.group))).sort();

  const meName = () => (typeof Auth !== 'undefined' && Auth.currentName) ? Auth.currentName() : '';
  const meEmail = () => (typeof Auth !== 'undefined' && Auth.currentEmail) ? Auth.currentEmail() : '';

  const multi = (v) => esc(v || '').replace(/\n/g, '<br>');   // 개행 보존 출력
  // 원본 문서 표기와 같은 "2026. 07. 20" 형식
  const todayKo = () => new Date().toISOString().slice(0, 10).replace(/-/g, '. ');

  // ── 스타일(페이지 전용) ────────────────────────────────
  const style = () => `
  <style>
    .ss-sub{font-size:12px;color:var(--text-muted,#8892a6);margin-top:3px;}
    .ss-input{background:var(--bg-input,#1b2030);border:1px solid var(--border,#2c3142);border-radius:6px;
      color:var(--text-primary,#e5e9f0);padding:7px 10px;font-size:13px;font-family:inherit;}
    .ss-chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}
    .ss-chip{padding:5px 12px;border-radius:999px;border:1px solid var(--border,#2c3142);background:transparent;
      color:var(--text-secondary,#a8b0c0);font-size:12px;cursor:pointer;}
    .ss-chip.on{background:var(--accent,#3E6AE1);border-color:var(--accent,#3E6AE1);color:#fff;font-weight:600;}
    .ss-btns{display:flex;gap:8px;flex-wrap:wrap;}
    .ss-edited{font-size:11px;color:#c67f22;border:1px solid #c67f22;border-radius:4px;padding:1px 5px;}
    .ss-new{font-size:11px;color:#2e9e5b;border:1px solid #2e9e5b;border-radius:4px;padding:1px 5px;}
    .ss-del{font-size:11px;color:#e05260;border:1px solid #e05260;border-radius:4px;padding:1px 5px;}
    /* 목록 행의 수정/삭제 버튼 */
    .ss-mini{font-size:11px;padding:3px 9px;border-radius:5px;cursor:pointer;margin-left:4px;
      border:1px solid var(--border,#2c3142);background:transparent;color:var(--text-secondary,#a8b0c0);}
    .ss-mini:hover{border-color:var(--accent,#3E6AE1);color:var(--accent,#3E6AE1);}
    .ss-mini-del:hover{border-color:#e05260;color:#e05260;}
    .ss-code{font-size:12px;color:var(--text-muted,#8892a6);font-weight:500;}

    /* 편집 도구막대 */
    .ss-editbar{background:var(--bg-hover,rgba(255,255,255,.05));border:1px solid var(--border,#2c3142);
      border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;flex-direction:column;gap:9px;}
    .ss-editbar-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}
    .ss-editbar label{font-size:12px;color:var(--text-secondary,#a8b0c0);white-space:nowrap;}
    .ss-editbar .ss-input{min-width:0;}

    /* ── 규격서 용지: 원본 Word 양식 그대로(흰 바탕·검은 글씨·A4 폭) ── */
    .ss-paper{background:#fff;color:#111;padding:14mm 13mm;border-radius:6px;
      font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:12.5px;line-height:1.6;
      max-width:210mm;margin:0 auto;box-shadow:0 2px 14px rgba(0,0,0,.35);}
    .ss-paper *{color:#111;box-sizing:border-box;}

    /* 앱 전역의 tbody tr:last-child td{border-bottom:none} 규칙이 규격서 표의 맨 아랫줄을 지워버리므로
       .ss-paper 를 앞에 붙여 우선순위를 높이고, 마지막 행 테두리를 명시적으로 복원한다. */
    .ss-paper table tbody tr:last-child td,
    .ss-paper table tbody tr:last-child th{border-bottom:1px solid #000;}
    .ss-paper .ss-insp tbody tr:last-child td{border-bottom:1px solid #999;}

    .ss-head{width:100%;border-collapse:collapse;margin-bottom:14px;}
    .ss-paper .ss-head td{border:1px solid #000;padding:5px 8px;font-size:12px;vertical-align:middle;}
    .ss-head .ss-logo{text-align:center;padding:4px;}
    .ss-head .ss-logo img{width:46px;height:44px;object-fit:contain;}
    .ss-head .ss-doctitle{text-align:center;font-size:19px;font-weight:800;letter-spacing:5px;}
    .ss-head .ss-name{text-align:center;font-size:14px;font-weight:700;}
    .ss-head .ss-lb{background:#eee;text-align:center;font-weight:700;white-space:nowrap;}

    .ss-doc{margin-top:6px;}
    .ss-block{display:flex;gap:10px;margin-bottom:11px;align-items:flex-start;}
    .ss-block-label{flex:0 0 130px;font-weight:700;white-space:pre;}
    .ss-block-body{flex:1;min-width:0;}
    .ss-note{font-size:11px;color:#666;margin-bottom:5px;}

    .ss-prox{border-collapse:collapse;margin-top:7px;width:100%;}
    .ss-paper .ss-prox th,.ss-paper .ss-prox td{border:1px solid #000;padding:4px 6px;font-size:11.5px;text-align:center;}
    .ss-prox th{background:#eee;font-weight:700;}

    .ss-insp{border-collapse:collapse;width:100%;margin-top:4px;}
    .ss-paper .ss-insp td{border:1px solid #999;padding:3px 6px;font-size:11px;white-space:nowrap;}

    .ss-photo{text-align:center;margin:12px 0;}
    .ss-photo img{max-width:60%;border:1px solid #ccc;}
    .ss-footer{margin-top:18px;padding-top:8px;border-top:1px solid #ccc;font-size:11px;color:#555;text-align:left;}

    /* 편집 모드 입력칸 — 양식 안에서 자리만 차지하고 레이아웃은 그대로 유지 */
    .ss-in{width:100%;border:1px solid #7aa7ff;border-radius:3px;background:#f2f7ff;color:#111;
      padding:3px 6px;font-size:12.5px;font-family:inherit;}
    .ss-in-c{text-align:center;}
    .ss-ta{width:100%;border:1px solid #7aa7ff;border-radius:3px;background:#f2f7ff;color:#111;
      padding:5px 7px;font-size:12.5px;font-family:inherit;line-height:1.6;resize:vertical;}
    .ss-editing .ss-block{align-items:flex-start;}

    /* 사진 첨부 */
    .ss-photo-edit{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:6px;}

    /* 새 규격서 작성 모달 */
    .ss-modal{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;
      align-items:center;justify-content:center;padding:20px;}
    .ss-modal-box{background:var(--bg-card,#171b26);border:1px solid var(--border,#2c3142);border-radius:12px;
      width:560px;max-width:100%;max-height:90vh;overflow:auto;padding:20px;}
    .ss-modal-title{font-size:16px;font-weight:700;margin-bottom:4px;}
    .ss-modal-sub{font-size:12px;color:var(--text-muted,#8892a6);margin-bottom:16px;}
    .ss-fld{margin-bottom:12px;}
    .ss-fld label{display:block;font-size:12px;color:var(--text-secondary,#a8b0c0);margin-bottom:4px;}
    .ss-fld .ss-input{width:100%;}
    .ss-fld-row{display:flex;gap:10px;}
    .ss-fld-row .ss-fld{flex:1;}
    .ss-form-pick{display:flex;gap:8px;margin-bottom:14px;}
    .ss-form-opt{flex:1;border:1px solid var(--border,#2c3142);border-radius:8px;padding:10px;cursor:pointer;
      background:transparent;text-align:left;color:var(--text-secondary,#a8b0c0);}
    .ss-form-opt.on{border-color:var(--accent,#3E6AE1);background:rgba(62,106,225,.12);color:var(--text-primary,#e5e9f0);}
    .ss-form-opt b{display:block;font-size:13px;margin-bottom:3px;color:var(--text-primary,#e5e9f0);}
    .ss-form-opt span{font-size:11px;line-height:1.4;}

    @media (max-width:820px){
      .ss-paper{padding:10mm 7mm;}
      .ss-block{flex-direction:column;gap:3px;}
      .ss-block-label{flex:none;}
      .ss-form-pick{flex-direction:column;}
      .ss-fld-row{flex-direction:column;gap:0;}
    }
  </style>`;

  // ── 목록 ───────────────────────────────────────────────
  const listRows = () => {
    const q = query.toLowerCase().trim();
    return sheets().filter(s => {
      if (groupFilter !== 'ALL' && s.group !== groupFilter) return false;
      if (!q) return true;
      return [s.title, s.name, s.code, s.docNo, s.group].some(v => String(v || '').toLowerCase().includes(q));
    });
  };

  const listBody = () => {
    // 휴지통 보기: 삭제된 규격서 + 복원 버튼
    if (trash) {
      const del = LabDB.getDeletedSpecSheets();
      return del.length ? del.map(s => `
        <tr>
          <td>${esc(s.docNo)}</td>
          <td>${esc(s.group)}</td>
          <td><b>${esc(s.title)}</b> <span class="ss-del">삭제됨</span></td>
          <td>${esc(s.code) || '-'}</td>
          <td>${esc(s.revDate)}</td>
          <td style="text-align:center">${esc(s.revNo) || '-'}</td>
          <td style="text-align:center">${s.form === 'A' ? '신양식' : '구양식'}</td>
          <td style="text-align:right;white-space:nowrap">
            <button class="ss-mini" onclick="SpecSheetPage.restore('${s.id}')">되살리기</button>
          </td>
        </tr>`).join('')
        : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted,#8892a6);padding:24px">삭제된 규격서가 없습니다</td></tr>';
    }

    const rows = listRows();
    return rows.length ? rows.map(s => `
      <tr onclick="SpecSheetPage.open('${s.id}')" style="cursor:pointer">
        <td>${esc(s.docNo)}</td>
        <td>${esc(s.group)}</td>
        <td><b>${esc(s.title)}</b>${s.custom ? ' <span class="ss-new">신규</span>' : (s.edited ? ' <span class="ss-edited">수정됨</span>' : '')}</td>
        <td>${esc(s.code) || '-'}</td>
        <td>${esc(s.revDate)}</td>
        <td style="text-align:center">${esc(s.revNo) || '-'}</td>
        <td style="text-align:center">${s.form === 'A' ? '신양식' : '구양식'}</td>
        <td style="text-align:right;white-space:nowrap" onclick="event.stopPropagation()">
          <button class="ss-mini" onclick="SpecSheetPage.openEdit('${s.id}')">수정</button>
          <button class="ss-mini ss-mini-del" onclick="SpecSheetPage.removeFromList('${s.id}')">삭제</button>
        </td>
      </tr>`).join('')
      : '<tr><td colspan="8" style="text-align:center;color:var(--text-muted,#8892a6);padding:24px">해당 조건의 규격서가 없습니다</td></tr>';
  };

  const renderList = () => {
    const gOpts = ['ALL'].concat(groups()).map(g =>
      `<button class="ss-chip ${groupFilter === g ? 'on' : ''}" onclick="SpecSheetPage.setGroup('${esc(g)}')">${g === 'ALL' ? '전체' : esc(g)}</button>`
    ).join('');
    const all = sheets();
    const nNew = all.filter(s => s.custom).length;
    const nDel = LabDB.getDeletedSpecSheets().length;

    return `
    <div class="fade-in">
      ${style()}
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">원료 규격서${trash ? ' <span class="ss-del">휴지통</span>' : ''}</div>
            <div class="ss-sub">${trash
              ? '삭제된 규격서입니다. 되살리면 목록으로 돌아옵니다.'
              : `총 ${all.length}종${nNew ? ` (원본 ${all.length - nNew} · 신규 ${nNew})` : ''} · 원본 양식 그대로 열람하고 항목만 수정합니다`}</div>
          </div>
          <div class="ss-btns">
            ${trash ? '' : `<input class="ss-input" style="max-width:220px" placeholder="원료명·코드·문서번호 검색"
                   value="${esc(query)}" oninput="SpecSheetPage.onSearch(this.value)">`}
            ${trash
              ? '<button class="btn" onclick="SpecSheetPage.setTrash(false)">← 목록으로</button>'
              : `<button class="btn" onclick="SpecSheetPage.setTrash(true)">휴지통${nDel ? ` (${nDel})` : ''}</button>
                 <button class="btn btn-primary" onclick="SpecSheetPage.openNew()">＋ 새 규격서</button>`}
          </div>
        </div>
        ${trash ? '' : `<div class="ss-chips">${gOpts}</div>`}
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>문서번호</th><th>분류</th><th>원료명</th><th>코드</th><th>제·개정일</th><th>개정번호</th><th>양식</th>
              <th style="text-align:right">${trash ? '복원' : '관리'}</th>
            </tr></thead>
            <tbody id="ss-list-body">${listBody()}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  };

  // ── 규격서 본문(양식 재현) ─────────────────────────────
  //   ed=true 면 각 항목을 입력칸으로 바꾼다. 표·칸 배치는 원본과 동일하게 유지.
  // 원본은 2쪽짜리라 머리글이 페이지마다 반복되며 '페이지' 칸만 37a/37b 로 다르다.
  // 플랫폼에서는 한 장으로 이어 보여주므로 범위(37a~37b)로 표기한다.
  const pageLabel = (s) => ((s.pages && s.pages.length > 1) ? s.pages.join('~') : (s.page || ''));

  const headerTable = (s, ed) => {
    const f = (key, val) => ed
      ? `<input class="ss-in" id="ss-h-${key}" value="${esc(val)}">`
      : (esc(val) || '&nbsp;');
    return `
    <table class="ss-head">
      <colgroup><col style="width:20%"><col style="width:38%"><col style="width:18%"><col style="width:24%"></colgroup>
      <tbody>
        <tr>
          <td rowspan="4" class="ss-logo"><img src="assets/app-icon.svg" alt="우성사료" onerror="this.style.display='none'"></td>
          <td rowspan="2" class="ss-doctitle">원료규격</td>
          <td class="ss-lb">문서번호</td><td>${f('docNo', s.docNo)}</td>
        </tr>
        <tr><td class="ss-lb">제.개정일</td><td>${f('revDate', s.revDate)}</td></tr>
        <tr>
          <td rowspan="2" class="ss-name">${ed
            ? `<input class="ss-in ss-in-c" id="ss-h-headName" value="${esc(s.headName)}">`
            : esc(s.headName)}</td>
          <td class="ss-lb">개정번호</td><td>${f('revNo', s.revNo)}</td>
        </tr>
        <tr><td class="ss-lb">페이지</td><td>${f('page', pageLabel(s))}</td></tr>
      </tbody>
    </table>`;
  };

  const proximateTable = (s, ed) => {
    const p = s.proximate;
    if (!p) return '';
    const head = `<tr><th>구분</th>${p.cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr>`;
    const body = p.rows.map((r, ri) => `
      <tr>
        <th>${esc(r[0])}</th>
        ${r.slice(1).map((v, ci) => `<td>${ed
          ? `<input class="ss-in ss-in-c" id="ss-p-${ri}-${ci}" value="${esc(v)}">`
          : (esc(v) || '&nbsp;')}</td>`).join('')}
      </tr>`).join('');
    return `<table class="ss-prox"><thead>${head}</thead><tbody>${body}</tbody></table>`;
  };

  const blockHtml = (s, b, ed) => {
    const val = ed
      ? (b.line
        ? `<input class="ss-in" id="ss-b-${b.k}" value="${esc(b.v)}">`
        : `<textarea class="ss-ta" id="ss-b-${b.k}" rows="${Math.max(2, String(b.v || '').split('\n').length)}">${esc(b.v)}</textarea>`)
      : (multi(b.v) || '&nbsp;');
    const extra = (b.k === 'proximate') ? proximateTable(s, ed) : '';
    return `
    <div class="ss-block">
      <div class="ss-block-label">${esc(b.label)} :</div>
      <div class="ss-block-body">${val}${extra}</div>
    </div>`;
  };

  // 열풍건조 규격서의 '필수 검사 항목' 표 — 원본은 그림이라 텍스트를 복원해 보여준다(읽기 전용)
  const inspTable = (s) => {
    if (!s.insp || !s.insp.length) return '';
    const width = Math.max.apply(null, s.insp.map(r => r.length));
    const rows = s.insp.map(r => `<tr>${
      r.map(c => `<td>${esc(c)}</td>`).join('') +
      (r.length < width ? `<td colspan="${width - r.length}"></td>` : '')
    }</tr>`).join('');
    return `
    <div class="ss-block">
      <div class="ss-block-label">필수 검사 항목 :</div>
      <div class="ss-block-body">
        <div class="ss-note">원본 문서에서는 그림으로 삽입된 표입니다 — 내용을 복원해 표시하며 이 표는 수정 대상이 아닙니다.</div>
        <div class="table-wrap" style="max-height:420px;overflow:auto">
          <table class="ss-insp"><tbody>${rows}</tbody></table>
        </div>
      </div>
    </div>`;
  };

  // 사진 영역 — 편집 중에는 첨부/삭제 버튼을 함께 보여준다
  const photoHtml = (s, ed) => {
    const cur = (newPhoto != null) ? newPhoto : (s.photo || '');
    if (!ed) return cur ? `<div class="ss-photo"><img src="${cur}" alt="${esc(s.title)}"></div>` : '';
    return `
    <div class="ss-photo">
      <img id="ss-photo-prev" src="${cur}" alt="${esc(s.title)}" style="${cur ? '' : 'display:none'}">
      <div class="ss-photo-edit">
        <label class="btn" style="cursor:pointer">사진 첨부
          <input type="file" accept="image/*" style="display:none" onchange="SpecSheetPage.onPhoto(this)">
        </label>
        <button class="btn" onclick="SpecSheetPage.clearPhoto()">사진 삭제</button>
      </div>
    </div>`;
  };

  const sheetBody = (s, ed) => `
    ${headerTable(s, ed)}
    <div class="ss-doc">
      ${(s.blocks || []).map(b => blockHtml(s, b, ed)).join('')}
      ${photoHtml(s, ed)}
      ${inspTable(s)}
    </div>
    <div class="ss-footer">${esc(s.footer)}</div>`;

  // ── 상세 ───────────────────────────────────────────────
  const renderDetail = () => {
    const s = sheet(openId);
    if (!s) return renderList();
    const log = LabDB.getSpecSheetLog(s.id);

    const editBar = editing ? `
      <div class="ss-editbar">
        <div class="ss-editbar-row">
          <label>수정자</label>
          <input class="ss-input" style="max-width:130px" value="${esc(meName())}" readonly title="로그인 계정으로 자동 기록됩니다">
          <label>개정번호</label>
          <input class="ss-input" id="ss-newrev" style="max-width:80px" value="${esc(s.revNo)}">
          <label>제·개정일</label>
          <input class="ss-input" id="ss-newdate" style="max-width:140px" value="${esc(s.revDate)}">
        </div>
        <div class="ss-editbar-row">
          <label>수정사유</label>
          <input class="ss-input" id="ss-reason" placeholder="변경 사유를 입력하세요 (필수)" style="flex:1">
          <button class="btn btn-primary" onclick="SpecSheetPage.save()">저장</button>
          <button class="btn" onclick="SpecSheetPage.cancelEdit()">취소</button>
        </div>
      </div>` : '';

    const logRows = log.length ? log.map(e => `
      <tr>
        <td>${esc(String(e.ts).slice(0, 16).replace('T', ' '))}</td>
        <td>${esc(e.action)}</td>
        <td style="text-align:center">${esc(e.revNo) || '-'}</td>
        <td>${esc(e.by) || '-'}</td>
        <td>${esc(e.reason) || '-'}</td>
        <td>${esc((e.changes || []).join(', ')) || '-'}</td>
      </tr>`).join('')
      : '<tr><td colspan="6" style="text-align:center;color:var(--text-muted,#8892a6);padding:14px">수정 이력이 없습니다</td></tr>';

    return `
    <div class="fade-in">
      ${style()}
      <div class="card">
        <div class="card-header">
          <div>
            <div class="card-title">${esc(s.title)} <span class="ss-code">${esc(s.code) || ''}</span></div>
            <div class="ss-sub">${esc(s.group)} · ${esc(s.docNo)}${
              s.custom ? ' · <span class="ss-new">신규</span>' : (s.edited ? ' · <span class="ss-edited">수정됨</span>' : '')}</div>
          </div>
          <div class="ss-btns">
            <button class="btn" onclick="SpecSheetPage.back()">← 목록</button>
            ${editing ? '' : '<button class="btn btn-primary" onclick="SpecSheetPage.exportDocx()">Word 다운로드</button>'}
            ${editing ? '' : '<button class="btn" onclick="SpecSheetPage.print()">인쇄 / PDF</button>'}
            ${editing ? '' : '<button class="btn" onclick="SpecSheetPage.startEdit()">수정</button>'}
            ${(!editing && s.edited && !s.custom) ? '<button class="btn" onclick="SpecSheetPage.reset()">↺ 원본복원</button>' : ''}
            ${editing ? '' : '<button class="btn btn-warning" onclick="SpecSheetPage.remove()">삭제</button>'}
          </div>
        </div>
        ${editBar}
        <div class="ss-paper ${editing ? 'ss-editing' : ''}" id="ss-paper">${sheetBody(s, editing)}</div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="card-header"><div class="card-title" style="font-size:14px">개정 이력</div></div>
        <div class="table-wrap">
          <table class="data-table compact">
            <thead><tr><th>일시</th><th>구분</th><th>개정번호</th><th>수정자</th><th>사유</th><th>변경항목</th></tr></thead>
            <tbody>${logRows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  };

  const render = () => (openId ? renderDetail() : renderList());

  // ── 새 규격서 작성 ─────────────────────────────────────
  const openNew = () => {
    const catOpts = CATEGORIES.map(([no, nm]) => `<option value="${esc(nm)}" data-no="${no}">`).join('');
    const copyOpts = sheets().map(s =>
      `<option value="${s.id}">${esc(s.group)} · ${esc(s.title)} (${s.form === 'A' ? '신양식' : '구양식'})</option>`).join('');
    // 원료코드 마스터 연동 — 등록된 원료코드에서만 선택(코드 기준)
    const matOpts = (typeof DB !== 'undefined' && DB.getMaterials ? DB.getMaterials() : [])
      .map(m => `<option value="${esc(m.code)}">${esc(m.code)} — ${esc(m.name)}</option>`).join('');

    const box = document.createElement('div');
    box.className = 'ss-modal';
    box.id = 'ss-modal';
    box.innerHTML = `
      ${style()}
      <div class="ss-modal-box" onclick="event.stopPropagation()">
        <div class="ss-modal-title">새 원료 규격서 작성</div>
        <div class="ss-modal-sub">기존 규격서와 동일한 양식으로 생성됩니다. 만든 뒤 각 항목을 채워 넣으세요.</div>

        <div class="ss-form-pick">
          <button class="ss-form-opt on" id="ss-opt-A" onclick="SpecSheetPage.pickForm('A')">
            <b>신양식</b><span>원료명·정의·효과·원산지·일반성분표·위해내역·저장유통·유통기한·입고검사·반품기준</span>
          </button>
          <button class="ss-form-opt" id="ss-opt-B" onclick="SpecSheetPage.pickForm('B')">
            <b>구양식</b><span>원료명·정의·일반적특성·성상·효능효과·용법용량·품질인자·반품기준·기타</span>
          </button>
          <button class="ss-form-opt" id="ss-opt-C" onclick="SpecSheetPage.pickForm('C')">
            <b>기존 복제</b><span>기존 규격서의 양식과 내용을 그대로 복사해 새 규격서로 시작</span>
          </button>
        </div>

        <div class="ss-fld" id="ss-copy-wrap" style="display:none">
          <label>복제할 규격서</label>
          <select class="ss-input" id="ss-n-copy">${copyOpts}</select>
        </div>

        <div class="ss-fld-row">
          <div class="ss-fld">
            <label>분류</label>
            <input class="ss-input" id="ss-n-group" list="ss-cats" placeholder="예: 동물성단백질류"
                   oninput="SpecSheetPage.onGroupPick(this.value)">
            <datalist id="ss-cats">${catOpts}</datalist>
          </div>
          <div class="ss-fld">
            <label>문서번호</label>
            <input class="ss-input" id="ss-n-docNo" placeholder="WSE-SJ-000"
                   oninput="this.dataset.touched='1'">
          </div>
        </div>

        <div class="ss-fld-row">
          <div class="ss-fld" style="flex:1.3">
            <label>원료코드 (코드 마스터 연동) <span style="color:#e05">*</span></label>
            <input class="ss-input mono" id="ss-n-code" list="ss-mat-codes" placeholder="원료코드 검색·선택" oninput="SpecSheetPage.onCodePick(this.value)">
            <datalist id="ss-mat-codes">${matOpts}</datalist>
            <div id="ss-code-hint" class="ss-code" style="margin-top:4px">코드 마스터에 발행된 원료코드에서만 선택할 수 있습니다.</div>
          </div>
          <div class="ss-fld" style="flex:1.3">
            <label>원료명 (한글) <span style="color:#e05">*</span></label>
            <input class="ss-input" id="ss-n-title" placeholder="코드 선택 시 자동 연동" readonly style="background:var(--bg-surface,#f4f4f4)">
          </div>
          <div class="ss-fld">
            <label>영문명 (선택)</label>
            <input class="ss-input" id="ss-n-en" placeholder="예: Oat Powder">
          </div>
        </div>

        <div class="ss-fld-row">
          <div class="ss-fld"><label>제·개정일</label><input class="ss-input" id="ss-n-date" value="${esc(todayKo())}"></div>
          <div class="ss-fld"><label>개정번호</label><input class="ss-input" id="ss-n-rev" value="1"></div>
          <div class="ss-fld"><label>페이지</label><input class="ss-input" id="ss-n-page" placeholder="1a"></div>
          <div class="ss-fld" style="align-self:flex-end"><button class="btn" onclick="App.navigate('codes')" title="원료코드가 없으면 코드 관리에서 먼저 발행">코드 관리 →</button></div>
        </div>

        <div class="ss-btns" style="justify-content:flex-end;margin-top:16px">
          <button class="btn" onclick="SpecSheetPage.closeNew()">취소</button>
          <button class="btn btn-primary" onclick="SpecSheetPage.createNew()">규격서 만들기</button>
        </div>
      </div>`;
    box.addEventListener('click', () => closeNew());
    document.body.appendChild(box);
    newForm = 'A';
    setTimeout(() => { const el = document.getElementById('ss-n-code'); if (el) el.focus(); }, 60);
  };

  // 원료코드 선택 → 코드 마스터에서 원료명·분류 자동 연동
  const onCodePick = (val) => {
    const code = String(val || '').trim();
    const titleEl = document.getElementById('ss-n-title');
    const hintEl = document.getElementById('ss-code-hint');
    const groupEl = document.getElementById('ss-n-group');
    const mat = code && typeof DB !== 'undefined' && DB.getMaterialByCode ? DB.getMaterialByCode(code) : null;
    if (mat) {
      if (titleEl) titleEl.value = mat.name || '';
      if (groupEl && !groupEl.value && mat.category) { groupEl.value = mat.category; onGroupPick(mat.category); }
      if (hintEl) { hintEl.innerHTML = `연동됨 — <b>${esc(mat.name)}</b>${mat.category ? ' · ' + esc(mat.category) : ''}`; hintEl.style.color = 'var(--success,#0a7d28)'; }
    } else {
      if (titleEl) titleEl.value = '';
      if (hintEl) { hintEl.innerHTML = code ? '코드 마스터에 없는 원료코드입니다 — [코드 관리]에서 먼저 발행하세요.' : '코드 마스터에 발행된 원료코드에서만 선택할 수 있습니다.'; hintEl.style.color = code ? 'var(--danger,#c62222)' : ''; }
    }
  };

  const closeNew = () => { const m = document.getElementById('ss-modal'); if (m) m.remove(); };

  const pickForm = (f) => {
    newForm = f;
    ['A', 'B', 'C'].forEach(k => {
      const el = document.getElementById('ss-opt-' + k);
      if (el) el.classList.toggle('on', k === f);
    });
    const cw = document.getElementById('ss-copy-wrap');
    if (cw) cw.style.display = (f === 'C') ? '' : 'none';
  };

  // 분류를 고르면 사내 문서번호 체계(WSE-SJ-<분류번호>)를 제안한다(수정 가능)
  const onGroupPick = (v) => {
    const hit = CATEGORIES.find(([, nm]) => nm === v);
    const el = document.getElementById('ss-n-docNo');
    if (hit && el && !el.dataset.touched) el.value = 'WSE-SJ-' + hit[0];
  };

  const createNew = () => {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const code = g('ss-n-code');
    const mat = code && typeof DB !== 'undefined' && DB.getMaterialByCode ? DB.getMaterialByCode(code) : null;
    if (!code || !mat) {
      alert('원료코드를 코드 마스터에서 선택해 주세요.\n등록된 원료코드가 없으면 [관리 → 코드 관리]에서 먼저 원료코드를 발행한 뒤 작성하세요.\n(모든 규격서는 원료코드를 기준으로 연동됩니다)');
      return;
    }
    const title = mat.name;   // 원료명은 코드 마스터 기준(코드 우선)
    const en = g('ss-n-en');
    const headName = en ? `${title}(${en})` : title;
    const nameLine = en ? `${title} (${en})${code ? '_' + code : ''}` : `${title}${code ? '_' + code : ''}`;

    let blocks, proximate = null, form = newForm;
    if (newForm === 'C') {
      const srcId = g('ss-n-copy');
      const src = sheet(srcId);
      if (!src) { alert('복제할 규격서를 선택해 주세요.'); return; }
      form = src.form;
      blocks = (src.blocks || []).map(b => ({ ...b }));
      proximate = src.proximate ? JSON.parse(JSON.stringify(src.proximate)) : null;
      const nb = blocks.find(b => b.k === 'name');
      if (nb) nb.v = nameLine;                        // 원료명만 새 값으로
    } else {
      blocks = FORM_BLOCKS[form].map(k => ({ k, label: BLOCK_DEFS[k].label, line: BLOCK_DEFS[k].line, v: '' }));
      const nb = blocks.find(b => b.k === 'name');
      if (nb) nb.v = nameLine;
      if (form === 'A') proximate = { cols: PROX_COLS.slice(), rows: [['기준치'].concat(PROX_COLS.map(() => '')), ['분석치'].concat(PROX_COLS.map(() => ''))] };
    }

    const s = LabDB.addSpecSheet({
      group: g('ss-n-group'), title, form, docNo: g('ss-n-docNo'),
      revDate: g('ss-n-date'), revNo: g('ss-n-rev'), page: g('ss-n-page'),
      headName, name: nameLine, code, blocks, proximate,
    }, { by: meName(), byEmail: meEmail(), reason: newForm === 'C' ? '기존 규격서 복제' : '신규 규격서 작성' });

    closeNew();
    openId = s.id;
    editing = true;                                   // 만들자마자 바로 채워 넣을 수 있게
    App.refreshPage();
  };

  // 삭제 — 신규 작성분은 영구 삭제, 원본 규격서는 휴지통으로(되살리기 가능)
  const doDelete = (id) => {
    const s = sheet(id);
    if (!s) return false;
    const msg = s.custom
      ? `"${s.title}" 규격서를 삭제합니다.\n직접 작성한 규격서라 되돌릴 수 없습니다. 계속할까요?`
      : `"${s.title}" 규격서를 목록에서 삭제합니다.\n휴지통에서 언제든 되살릴 수 있습니다. 계속할까요?`;
    if (!confirm(msg)) return false;
    LabDB.deleteSpecSheet(s.id, { by: meName(), byEmail: meEmail(), reason: '규격서 삭제' });
    return true;
  };

  const remove = () => {
    if (!doDelete(openId)) return;
    openId = null; editing = false; newPhoto = null;
    App.refreshPage();
  };

  // 목록에서 바로 수정 / 삭제
  const openEdit = (id) => { openId = id; editing = true; newPhoto = null; App.refreshPage(); };
  const removeFromList = (id) => { if (doDelete(id)) App.refreshPage(); };

  const restore = (id) => {
    LabDB.restoreSpecSheet(id, { by: meName(), byEmail: meEmail(), reason: '규격서 되살리기' });
    if (!LabDB.getDeletedSpecSheets().length) trash = false;   // 휴지통이 비면 목록으로
    App.refreshPage();
  };

  const setTrash = (v) => { trash = !!v; query = ''; App.refreshPage(); };

  // ── 사진 첨부 ──────────────────────────────────────────
  //   원본과 같은 형식(가로 360px JPEG data URI)으로 줄여 저장 용량을 억제한다.
  const onPhoto = (input) => {
    const f = input.files && input.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      const img = new Image();
      img.onload = () => {
        const w = Math.min(360, img.width);
        const h = Math.round(img.height * w / img.width);
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        newPhoto = cv.toDataURL('image/jpeg', 0.72);
        const prev = document.getElementById('ss-photo-prev');
        if (prev) { prev.src = newPhoto; prev.style.display = ''; }
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  const clearPhoto = () => {
    newPhoto = '';
    const prev = document.getElementById('ss-photo-prev');
    if (prev) { prev.src = ''; prev.style.display = 'none'; }
  };

  // ── 동작 ───────────────────────────────────────────────
  const open = (id) => { openId = id; editing = false; newPhoto = null; App.refreshPage(); };
  const back = () => { openId = null; editing = false; newPhoto = null; trash = false; App.refreshPage(); };
  const setGroup = (g) => { groupFilter = g; App.refreshPage(); };
  const startEdit = () => { editing = true; newPhoto = null; App.refreshPage(); };
  const cancelEdit = () => { editing = false; newPhoto = null; App.refreshPage(); };

  // 검색은 표 본문만 교체 — 입력 포커스·커서를 잃지 않게 한다
  const onSearch = (v) => {
    query = v;
    const tb = document.getElementById('ss-list-body');
    if (tb) tb.innerHTML = listBody();
  };

  const save = () => {
    const s = sheet(openId);
    if (!s) return;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : null; };

    const reason = (g('ss-reason') || '').trim();
    if (!reason) { alert('수정사유를 입력해 주세요.'); return; }

    const patch = {};
    const changes = [];

    // 헤더 항목 (페이지는 원본이 범위표기일 수 있어 별도 비교)
    [['docNo', '문서번호'], ['revDate', '제·개정일'], ['revNo', '개정번호'], ['headName', '원료명(머리글)']]
      .forEach(([k, label]) => {
        const v = g('ss-h-' + k);
        if (v != null && v !== s[k]) { patch[k] = v; changes.push(label); }
      });
    const pv = g('ss-h-page');
    if (pv != null && pv !== pageLabel(s)) { patch.page = pv; patch.pages = []; changes.push('페이지'); }
    // 편집막대의 개정번호·제개정일이 우선
    const nr = g('ss-newrev'), nd = g('ss-newdate');
    if (nr != null && nr !== s.revNo) { patch.revNo = nr; if (changes.indexOf('개정번호') < 0) changes.push('개정번호'); }
    if (nd != null && nd !== s.revDate) { patch.revDate = nd; if (changes.indexOf('제·개정일') < 0) changes.push('제·개정일'); }

    // 본문 블록
    const blocks = {};
    (s.blocks || []).forEach(b => {
      const v = g('ss-b-' + b.k);
      if (v != null && v !== b.v) { blocks[b.k] = v; changes.push(b.label.trim()); }
    });
    if (Object.keys(blocks).length) patch.blocks = blocks;

    // 일반성분 표
    if (s.proximate) {
      const rows = s.proximate.rows.map(r => r.slice());
      let touched = false;
      rows.forEach((r, ri) => {
        for (let ci = 0; ci < r.length - 1; ci++) {
          const v = g(`ss-p-${ri}-${ci}`);
          if (v != null && v !== r[ci + 1]) { r[ci + 1] = v; touched = true; }
        }
      });
      if (touched) { patch.proximate = { cols: s.proximate.cols, rows }; changes.push('일반성분'); }
    }

    // 사진 첨부/삭제
    if (newPhoto != null && newPhoto !== (s.photo || '')) {
      patch.photo = newPhoto;
      changes.push(newPhoto ? '사진 첨부' : '사진 삭제');
    }

    if (!changes.length) { alert('변경된 내용이 없습니다.'); return; }

    LabDB.saveSpecSheet(s.id, patch, {
      by: meName(), byEmail: meEmail(), reason,
      action: '수정', revNo: patch.revNo != null ? patch.revNo : s.revNo, changes,
    });
    editing = false;
    newPhoto = null;
    App.refreshPage();
  };

  const reset = () => {
    const s = sheet(openId);
    if (!s) return;
    if (!confirm(`"${s.title}" 규격서를 원본(.doc) 내용으로 되돌립니다.\n플랫폼에서 수정한 내용은 사라집니다. 계속할까요?`)) return;
    LabDB.resetSpecSheet(s.id, { by: meName(), byEmail: meEmail(), reason: '원본 양식으로 복원' });
    App.refreshPage();
  };

  const print = () => {
    const s = sheet(openId);
    if (!s) return;
    openReportOverlay(`${style()}<div class="ss-paper" style="box-shadow:none;padding:0">${sheetBody(s, false)}</div>`);
  };

  // ── Word(.docx) 내려받기 ───────────────────────────────
  //   화면과 같은 양식(머리글표·항목·일반성분표·사진·검사항목표·푸터)을 그대로 Word 문서로 만든다.
  const W = () => WSDocx.CONTENT_W;                       // 본문 폭(twips)
  const HEAD_W = () => { const t = W(); return [Math.round(t * 0.20), Math.round(t * 0.38), Math.round(t * 0.18), t - Math.round(t * 0.20) - Math.round(t * 0.38) - Math.round(t * 0.18)]; };

  const docxModel = (s) => {
    const blocks = [];

    // 머리글표 — 원본과 동일한 4×4 (로고자리 세로병합, 원료규격/원료명 2행 병합)
    blocks.push({
      type: 'table', widths: HEAD_W(), rowHeight: 340,
      rows: [
        [{ t: '', vMerge: 'restart' }, { t: '원 료 규 격', bold: true, align: 'center', size: 32, vMerge: 'restart' },
         { t: '문서번호', bold: true, align: 'center', fill: 'EEEEEE' }, { t: s.docNo, align: 'center' }],
        [{ t: '', vMerge: 'cont' }, { t: '', vMerge: 'cont' },
         { t: '제.개정일', bold: true, align: 'center', fill: 'EEEEEE' }, { t: s.revDate, align: 'center' }],
        [{ t: '', vMerge: 'cont' }, { t: s.headName, bold: true, align: 'center', size: 24, vMerge: 'restart' },
         { t: '개정번호', bold: true, align: 'center', fill: 'EEEEEE' }, { t: s.revNo, align: 'center' }],
        [{ t: '', vMerge: 'cont' }, { t: '', vMerge: 'cont' },
         { t: '페이지', bold: true, align: 'center', fill: 'EEEEEE' }, { t: pageLabel(s), align: 'center' }],
      ],
    });

    // 본문 항목 — "제목 : 내용" 을 들여쓰기로 원본 배치에 맞춘다
    (s.blocks || []).forEach(b => {
      blocks.push({
        type: 'p', before: 100, after: 20,
        runs: [{ t: b.label + ' : ', bold: true }, { t: b.v || '' }],
      });
      if (b.k === 'proximate' && s.proximate) {
        const n = s.proximate.cols.length + 1;
        const cw = Math.floor(W() / n);
        blocks.push({
          type: 'table', widths: Array(n).fill(cw),
          rows: [['구분'].concat(s.proximate.cols).map(c => ({ t: c, bold: true, align: 'center', fill: 'EEEEEE' }))]
            .concat(s.proximate.rows.map(r =>
              r.map((v, i) => ({ t: v, align: 'center', bold: i === 0, fill: i === 0 ? 'EEEEEE' : null })))),
        });
      }
    });

    // 원료 사진
    if (s.photo) blocks.push({ type: 'image', dataUri: s.photo, w: 200, h: Math.round(200 * (s.photoRatio || 0.8)) });

    // 필수 검사 항목표(열풍건조 5종) — 원본은 그림이지만 Word 표로 재현
    if (s.insp && s.insp.length) {
      const width = Math.max.apply(null, s.insp.map(r => r.length));
      const cw = Math.floor(W() / width);
      blocks.push({ type: 'p', before: 160, after: 40, runs: [{ t: '필수 검사 항목', bold: true }] });
      blocks.push({
        type: 'table', widths: Array(width).fill(cw),
        rows: s.insp.map(r => {
          const cells = r.map(c => ({ t: c, size: 16, align: 'center' }));
          if (r.length < width) cells.push({ t: '', gridSpan: width - r.length });
          return cells;
        }),
      });
    }

    blocks.push({ type: 'p', before: 200, runs: [{ t: s.footer || '', size: 16, color: '555555' }] });
    return { title: `원료규격서 ${s.title}`, blocks };
  };

  const exportDocx = () => {
    const s = sheet(openId);
    if (!s) return;
    if (typeof WSDocx === 'undefined') { alert('Word 내보내기 모듈을 불러오지 못했습니다.'); return; }
    const go = (ratio) => {
      const model = docxModel({ ...s, photoRatio: ratio });
      WSDocx.download(`원료규격서_${s.title}_${(s.docNo || '').replace(/[\\/:*?"<>|]/g, '')}.docx`, model);
    };
    // 사진 비율을 알아야 Word 안에서 찌그러지지 않는다
    if (s.photo) {
      const img = new Image();
      img.onload = () => go(img.height / img.width);
      img.onerror = () => go(0.8);
      img.src = s.photo;
    } else go(0.8);
  };

  return {
    render, open, back, onSearch, setGroup, startEdit, cancelEdit, save, reset, print, exportDocx,
    openNew, closeNew, pickForm, onGroupPick, onCodePick, createNew, onPhoto, clearPhoto,
    remove, openEdit, removeFromList, restore, setTrash,
    _docxModel: docxModel,
  };
})();
