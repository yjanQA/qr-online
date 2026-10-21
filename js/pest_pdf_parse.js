// ============================================================
// pest_pdf_parse.js — 방역업체(방역업체A 등) 월간 결과보고서 PDF 자동 분석
//   pdf.js로 텍스트를 추출해 좌표 기반으로 표를 재구성하고,
//   기간 · 방문내역 · 해충별 발생장소 합계표 · 시설점검 현황 · 종합의견을 파싱한다.
//   두 가지 보고서 양식(구양식 "서비스 결과 보고서" / 신양식 "IPM 서비스 결과")을 모두 지원.
// ============================================================

const PestPdfParser = (() => {
  let workerReady = false;
  const ensureWorker = () => {
    if (workerReady || typeof pdfjsLib === 'undefined') return;
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    workerReady = true;
  };

  // ── 페이지의 텍스트 아이템을 y좌표(허용오차 4px)로 묶어 "행" 단위로 재구성 ──
  const buildRows = async (doc, pageNo) => {
    const page = await doc.getPage(pageNo);
    const tc = await page.getTextContent();
    const items = tc.items
      .map(it => ({ x: it.transform[4], y: it.transform[5], s: it.str }))
      .filter(it => it.s.trim() !== '');
    const buckets = [];
    items.forEach(it => {
      let b = buckets.find(bb => Math.abs(bb.y - it.y) <= 4);
      if (!b) { b = { y: it.y, items: [] }; buckets.push(b); }
      b.items.push(it);
    });
    buckets.sort((a, b) => b.y - a.y); // PDF 좌표계는 아래→위이므로 y 내림차순 = 위→아래
    return buckets.map(b => ({ y: Math.round(b.y), tokens: b.items.sort((a, b) => a.x - b.x) }));
  };

  const pageRawText = async (doc, pageNo) => {
    const page = await doc.getPage(pageNo);
    const tc = await page.getTextContent();
    return tc.items.map(i => i.str).join('');
  };

  const findPage = async (doc, predicate, maxPages) => {
    const n = Math.min(doc.numPages, maxPages || doc.numPages);
    for (let p = 1; p <= n; p++) {
      const text = await pageRawText(doc, p);
      if (predicate(text)) return p;
    }
    return null;
  };

  // ── 1) 기간 ──
  const parsePeriod = (text) => {
    const m = text.match(/(\d{4})[.\-](\d{2})[.\-](\d{2})\s*~\s*(\d{4})[.\-](\d{2})[.\-](\d{2})/);
    if (!m) return null;
    return { month: `${m[1]}-${m[2]}`, periodStart: `${m[1]}-${m[2]}-${m[3]}`, periodEnd: `${m[4]}-${m[5]}-${m[6]}` };
  };

  // ── 2) 정기서비스 방문내역 ──
  const parseVisits = (rows) => {
    const out = [];
    rows.forEach(r => {
      const line = r.tokens.map(t => t.s).join('');
      const m = line.match(/(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}\s*~\s*\d{2}:\d{2})(.+)$/);
      if (m) out.push({ date: m[1], time: m[2].replace(/\s+/g, ' ').trim(), type: m[3].trim() || '방문' });
    });
    return out;
  };

  // ── 3) 해충별 발생장소 분석/내역 표 — 쥐·바퀴·블루스톰포획·날파리·파리·깔따구·초파리·기타·합계 ──
  const LABEL_PATTERNS = [
    [/^쥐$/, '쥐'], [/^바퀴$/, '바퀴'],
    [/^날파리$/, '날파리'], [/^초파리$/, '초파리'], [/^파리$/, '파리'],
    [/^깔따구$/, '깔따구'], [/^나방파리$/, '나방파리'], [/^나방$/, '나방'], [/^모기$/, '모기'],
    [/^그$/, '기타'], [/^그외$/, '기타'], [/^기타$/, '기타'],
    [/^합계$/, '합계'],
  ];
  const SKIP_LABELS = ['대분류', '층분류', '중분류', '층', '지역명', '외'];
  const isBlueStorm = (s) => /블루/.test(s) || s === '톰' || s === '포획';
  const matchLabel = (s) => { for (const [re, lab] of LABEL_PATTERNS) if (re.test(s)) return lab; return null; };

  const parsePestLocationTable = (rows, startIdx) => {
    let hIdx = -1;
    for (let i = startIdx; i < rows.length; i++) {
      const toks = rows[i].tokens.map(t => t.s);
      if (toks.includes('쥐') && (toks.includes('바퀴') || toks.some(s => s.includes('블루')))) { hIdx = i; break; }
    }
    if (hIdx < 0) return null;

    const from = Math.max(0, hIdx - 2), to = Math.min(rows.length, hIdx + 3);
    const blueXs = [];
    const headerTokens = [];
    for (let i = from; i < to; i++) {
      const allNumRow = rows[i].tokens.length > 0 && rows[i].tokens.every(t => /^[\d,]+$/.test(t.s.trim()));
      if (allNumRow && i > hIdx) break;
      rows[i].tokens.forEach(t => {
        const s = t.s.trim();
        if (!s || SKIP_LABELS.includes(s)) return;
        if (isBlueStorm(s)) { blueXs.push(t.x); return; }
        const lab = matchLabel(s);
        if (lab) headerTokens.push({ x: t.x, label: lab });
      });
    }
    if (blueXs.length) headerTokens.push({ x: Math.min(...blueXs), label: '블루스톰포획' });

    const headers = [];
    headerTokens.sort((a, b) => a.x - b.x).forEach(h => {
      if (!headers.some(x => Math.abs(x.x - h.x) < 12)) headers.push(h);
    });
    if (!headers.length) return null;
    const N = headers.length;

    const sums = headers.map(() => 0);
    let totalRow = null;
    let i = hIdx + 1;
    for (; i < rows.length; i++) {
      const toks = rows[i].tokens.map(t => t.s.trim()).filter(Boolean);
      if (!toks.length) continue;
      if (/^\d+\)/.test(toks[0])) break; // 다음 번호 섹션 시작
      if (toks[0] === '합계') {
        const vals = toks.slice(1).filter(s => /^[\d,]+$/.test(s)).map(s => Number(s.replace(/,/g, '')));
        if (vals.length >= N - 1) totalRow = vals.slice(-N);
        continue;
      }
      let j = toks.length - 1;
      const trail = [];
      while (j >= 0 && /^[\d,]+$/.test(toks[j])) { trail.unshift(toks[j]); j--; }
      if (trail.length >= N - 1 && trail.length <= N + 1) {
        const vals = trail.slice(-N).map(s => Number(s.replace(/,/g, '')));
        vals.forEach((v, idx) => { sums[idx] += (v || 0); });
      }
    }
    const values = totalRow && totalRow.length === N ? totalRow : sums;
    const result = {};
    headers.forEach((h, idx) => { result[h.label] = (result[h.label] || 0) + (values[idx] || 0); });
    return result;
  };

  // ── 4) 시설점검 현황 (신규등록/개선진행중/.../합계) ──
  const parseFacilityCheck = (rows) => {
    const hIdx = rows.findIndex(r => r.tokens.some(t => t.s.trim() === '신규등록'));
    if (hIdx < 0) return null;
    // 헤더 토큰 병합: "개선"+"진행중"→개선진행중, "개선"+"미진행"→개선미진행, "문제"+"없음"→문제없음
    const raw = rows[hIdx].tokens.map(t => t.s.trim()).filter(Boolean);
    const labels = [];
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '개선' && raw[i + 1] === '진행중') { labels.push('개선진행중'); i++; }
      else if (raw[i] === '개선' && raw[i + 1] === '미진행') { labels.push('개선미진행'); i++; }
      else if (raw[i] === '문제' && raw[i + 1] === '없음') { labels.push('문제없음'); i++; }
      else labels.push(raw[i]);
    }
    // 데이터 행: 헤더 다음 등장하는, 모두 숫자인 행
    for (let i = hIdx + 1; i < Math.min(hIdx + 4, rows.length); i++) {
      const vals = rows[i].tokens.map(t => t.s.trim()).filter(Boolean);
      if (vals.length && vals.every(v => /^\d+$/.test(v))) {
        const result = {};
        labels.forEach((l, idx) => { if (l !== '합계') result[l] = Number(vals[idx] || 0); });
        return result;
      }
    }
    return null;
  };

  // ── 5) 종합의견 요약 (best-effort 텍스트 추출) ──
  const parseNote = (text) => {
    const idx = text.indexOf('종합의견');
    if (idx < 0) return '';
    let s = text.slice(idx + 4);
    s = s.replace(/\s+/g, ' ').trim();
    return s.slice(0, 700);
  };

  // ── 6) 보고서 제목에서 공장명 추정 (예: "우성사료논산2공장" → 논산) ──
  const guessFactoryFromText = (text) => {
    const t = String(text || '');
    if (t.includes('아산')) return '아산';
    if (t.includes('경산')) return '경산';
    if (t.includes('논산')) return '논산';
    if (t.includes('본사')) return '본사';
    return null;
  };

  // ── 메인: PDF ArrayBuffer → 구조화된 리포트 초안 ──
  const parse = async (arrayBuffer) => {
    ensureWorker();
    const doc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const warnings = [];

    const p1Text = await pageRawText(doc, 1);
    const period = parsePeriod(p1Text) || {};
    if (!period.month) warnings.push('기간(월)을 인식하지 못했습니다. 직접 입력하세요.');
    const factoryGuess = guessFactoryFromText(p1Text);

    // 방문내역: "정기서비스 내역" 표가 있는 페이지 탐색(보통 3페이지 이내)
    let visits = [];
    const visitPage = await findPage(doc, t => t.includes('정기서비스') && t.includes('서비스일자'), 6) || 3;
    try { visits = parseVisits(await buildRows(doc, visitPage)); } catch (_) {}
    if (!visits.length) warnings.push('서비스 방문일자를 인식하지 못했습니다.');

    // 해충별 발생장소 표: "바퀴"+"중분류" 동시 등장 페이지부터 최대 2페이지 결합
    let ratBreakdown = {}, insectBreakdown = {};
    const tablePage = await findPage(doc, t => t.includes('바퀴') && t.includes('중분류'));
    if (tablePage) {
      try {
        const rowsA = await buildRows(doc, tablePage);
        const rowsB = tablePage + 1 <= doc.numPages ? await buildRows(doc, tablePage + 1) : [];
        const parsed = parsePestLocationTable(rowsA.concat(rowsB), 0);
        if (parsed) {
          Object.keys(parsed).forEach(k => {
            if (k === '합계') return;
            if (k === '쥐') ratBreakdown[k] = parsed[k];
            else if (parsed[k] > 0 || k === '바퀴') insectBreakdown[k] = parsed[k];
          });
        }
      } catch (e) { warnings.push('해충 포획 표 분석 중 오류: ' + e.message); }
    } else {
      warnings.push('"해충별 발생장소" 표를 찾지 못했습니다. 포획 데이터를 직접 입력하세요.');
    }

    // 시설점검
    let facilityCheck = {};
    const facPage = await findPage(doc, t => t.includes('신규등록'));
    if (facPage) {
      try {
        const fc = parseFacilityCheck(await buildRows(doc, facPage));
        if (fc) facilityCheck = fc;
      } catch (_) {}
    }
    if (!Object.keys(facilityCheck).length) warnings.push('시설점검 현황 표를 찾지 못했습니다.');

    // 종합의견
    let note = '';
    try { note = parseNote(await pageRawText(doc, visitPage)); } catch (_) {}

    return {
      month: period.month || '',
      periodStart: period.periodStart || '',
      periodEnd: period.periodEnd || '',
      factoryGuess, // '아산'|'경산'|'논산'|'본사'|null (표지/헤더 텍스트 기준)
      visits,
      ratBreakdown,
      insectBreakdown,
      facilityCheck,
      facilityIssues: [],
      note,
      warnings,
    };
  };

  return { parse };
})();
