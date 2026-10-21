// lab_common.js — 실험실 모듈 공용 전역 (QR 통합용)
function fmtDate(iso){ if(!iso)return '-'; const s=String(iso); if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10); const d=new Date(iso); return isNaN(d)?s:d.toISOString().slice(0,10); }
function fmtNum(n,digits=2){ if(n==null||n===''||Number.isNaN(Number(n)))return '-'; return Number(n).toLocaleString(undefined,{maximumFractionDigits:digits}); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
// 분석 시점 기상 각인 표시: "28°86% 맑음"
function fmtWeatherStamp(w, opts){
  if(!w || (w.temp==null && w.humidity==null)) return (opts&&opts.emptyText)||'';
  const ci = (typeof window!=='undefined' && window.Weather && Weather.codeInfo) ? Weather.codeInfo(w.code) : {icon:'',label:''};
  const t = w.temp!=null ? Math.round(w.temp)+'°' : '';
  const h = w.humidity!=null ? ''+w.humidity+'%' : '';
  return `${ci.icon} ${t} ${h}${ci.label?' '+ci.label:''}`.replace(/\s+/g,' ').trim();
}
// 규격 표시: 하한만→"N 이상" · 상한만→"N 이하" · 둘 다→"N ~ M" · 없음→emptyText
function fmtSpec(min,max,emptyText){
  const hasMin=min!=null&&min!=='', hasMax=max!=null&&max!=='';
  if(!hasMin&&!hasMax) return emptyText==null?'미등록':emptyText;
  if(hasMin&&hasMax) return `${fmtNum(min)} ~ ${fmtNum(max)}`;
  if(hasMin) return `${fmtNum(min)} 이상`;
  return `${fmtNum(max)} 이하`;
}
const VERDICT_META={OK:{label:'적합',cls:'ok'},HIGH:{label:'상한초과',cls:'high'},LOW:{label:'하한미달',cls:'low'},NA:{label:'기준없음',cls:'na'}};

// ── 공용 인쇄 보고서 오버레이 (축종별 품질 보고서) ──
//   성적서(lab_coa)와 동일한 .coa-overlay/.coa-sheet 클래스를 재사용해 인쇄 CSS 충돌을 방지.
function ensureReportStyle(){
  if(document.getElementById('rpt-style'))return;
  const st=document.createElement('style');st.id='rpt-style';
  st.textContent=`
  .coa-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;overflow:auto;padding:20px;}
  .coa-toolbar{position:sticky;top:0;z-index:1;display:flex;gap:8px;justify-content:center;margin-bottom:14px;}
  .coa-toolbar button{padding:8px 16px;border:0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;}
  .coa-btn-print{background:#4f9cff;color:#fff;} .coa-btn-close{background:#33384a;color:#e5e9f0;}
  .coa-sheet{background:#fff;color:#111;width:210mm;max-width:100%;min-height:290mm;margin:0 auto;padding:16mm 15mm;box-shadow:0 4px 24px rgba(0,0,0,.5);box-sizing:border-box;font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:12px;line-height:1.5;}
  .coa-sheet th, .coa-sheet td, .coa-sheet td b{color:#111;}
  .coa-sheet thead tr{background:transparent;}
  .rpt-h1{font-size:24px;font-weight:800;letter-spacing:6px;text-align:center;margin:0 0 4px;}
  .rpt-sub{text-align:center;color:#444;font-size:12px;margin-bottom:16px;}
  .rpt-info{width:100%;border-collapse:collapse;margin-bottom:14px;}
  .rpt-info td{border:1px solid #000;padding:5px 9px;font-size:12px;}
  .rpt-info .lb{background:#eee;font-weight:700;text-align:center;white-space:nowrap;}
  .rpt-tbl{width:100%;border-collapse:collapse;margin-bottom:12px;}
  .rpt-tbl th,.rpt-tbl td{border:1px solid #000;padding:5px 7px;font-size:11.5px;text-align:center;}
  .rpt-tbl th{background:#eee;font-weight:700;}
  /* 앱 전역 tbody tr:last-child td{border-bottom:none} 가 보고서 표 맨 아랫줄을 지우므로 복원(전 보고서 공통) */
  .coa-sheet table tr:last-child td,.coa-sheet table tr:last-child th{border-bottom:1px solid #000;}
  .rpt-tbl td.l{text-align:left;} .rpt-tbl .mono{font-family:'Consolas',monospace;}
  .rpt-ok{color:#0a7d28;font-weight:700;} .rpt-bad{color:#c62222;font-weight:700;}
  .rpt-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-weight:800;font-size:12px;}
  .rpt-foot{margin-top:24px;border-top:1.5px solid #000;padding-top:8px;font-size:11px;color:#222;}
  .rpt-sign{margin-top:22px;text-align:right;font-size:13px;font-weight:600;}
  @media print{
    body>*:not(.coa-overlay){display:none!important;}
    .coa-overlay{position:static;background:#fff;padding:0;overflow:visible;}
    .coa-toolbar{display:none!important;}
    .coa-sheet{box-shadow:none;width:auto;min-height:auto;margin:0;padding:0;}
    @page{size:A4;margin:12mm;}
  }`;
  document.head.appendChild(st);
}
function openReportOverlay(innerHtml, extraToolbarHtml){
  ensureReportStyle();closeReportOverlay();
  const ov=document.createElement('div');ov.className='coa-overlay';ov.id='rpt-overlay';
  ov.innerHTML=`<div class="coa-toolbar"><button class="coa-btn-print" onclick="window.print()">인쇄 / PDF 저장</button>${extraToolbarHtml||''}<button class="coa-btn-close" onclick="closeReportOverlay()">✕ 닫기</button></div><div class="coa-sheet">${innerHtml}</div>`;
  ov.addEventListener('click',e=>{if(e.target===ov)closeReportOverlay();});
  document.body.appendChild(ov);
}
function closeReportOverlay(){document.getElementById('rpt-overlay')?.remove();}
function vBadge(v){const m={OK:['적합','#0a7d28','#e3f7e8'],HIGH:['상한초과','#c62222','#fdeaea'],LOW:['하한미달','#c67f22','#fdf3e5'],PASS:['합격','#0a7d28','#e3f7e8'],FAIL:['부적합','#c62222','#fdeaea'],NA:['-','#666','#eee']}[v]||['-','#666','#eee'];return `<span class="rpt-badge" style="color:${m[1]};background:${m[2]}">${m[0]}</span>`;}

// ── 입력칸 ↑↓ = 칸 이동 (앱 전역 공통 — 화면별 예외 없음) ──
//   · 숫자칸: ↑↓ 스핀(증감) 차단하고 이전/다음 입력칸으로 이동, Enter도 다음 칸
//   · 텍스트/날짜 등 한 줄 입력칸: ↑↓ 이동 (textarea·select·datalist 자동완성 칸은 제외)
//   · 이동 범위: 같은 표 → 같은 모달(오버레이) → 페이지 본문 순으로 가장 가까운 영역
(function(){
  if (typeof document === 'undefined' || window.__gridArrowNavBound) return;
  window.__gridArrowNavBound = true;

  const NAV_TYPES = new Set(['number', 'text', 'search', 'date', 'time', 'datetime-local', 'month', 'week', 'tel', 'email', 'url']);
  const isNavInput = (t) => t && t.tagName === 'INPUT' && NAV_TYPES.has(t.type)
    && !t.disabled && !t.readOnly
    && !t.hasAttribute('list')             // datalist 자동완성은 ↑↓로 목록 선택해야 하므로 제외
    && !t.hasAttribute('data-nonav');      // 검색형 콤보박스(자체 드롭다운)도 제외

  const scopeOf = (t) =>
    t.closest('table') ||
    t.closest('.aned-overlay,.cmed-overlay,.coa-overlay,.modal,[class*="overlay"]') ||
    document.getElementById('page-content') || document.body;

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (!isNavInput(t)) return;
    const isArrow = e.key === 'ArrowDown' || e.key === 'ArrowUp';
    const isEnter = e.key === 'Enter' && t.type === 'number';   // Enter 이동은 숫자칸만(검색창 등 Enter 동작 보존)
    if (!isArrow && !isEnter) return;
    if (e.isComposing) return;             // 한글 조합 중에는 개입하지 않음
    const scope = scopeOf(t);
    const inputs = Array.from(scope.querySelectorAll('input')).filter(i => isNavInput(i) && i.offsetParent !== null);
    const idx = inputs.indexOf(t);
    if (idx < 0) return;
    e.preventDefault();                    // 숫자 스핀·커서점프 차단
    const next = (e.key === 'ArrowUp') ? inputs[idx - 1] : inputs[idx + 1];
    if (next) { next.focus(); if (next.select) next.select(); }
  }, true);

  // 마우스 휠로 숫자값이 바뀌는 것도 방지(스크롤 중 실수 입력) — 모든 숫자칸
  document.addEventListener('wheel', (e) => {
    const t = e.target;
    if (t && t.tagName === 'INPUT' && t.type === 'number' && document.activeElement === t) t.blur();
  }, { passive: true, capture: true });
})();
