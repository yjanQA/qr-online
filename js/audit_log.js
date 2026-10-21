// ============================================================
// audit_log.js — 공통 수정 이력(감사 추적) 헬퍼
//   "누가·언제·무엇을 어떻게 고쳤는가" 를 레코드에 남기는 표준 도구.
//   모든 업무 모듈이 같은 형태로 이력을 쌓게 해, 편집 화면에서 동일하게 보여줄 수 있다.
//
//   레코드에 editHistory[] 를 두고 항목은:
//     { ts, by, byEmail, action, reason, changes:[{field,label,from,to}] }
//   작성자(by)는 로그인 사용자(Auth.currentName)를 자동 기록한다 — 직접입력이 아니라.
//
//   사용 예:
//     const before = {...rec};
//     Object.assign(rec, patch);
//     AuditLog.record(rec, before, { name:'제품명', price:'단가' });  // 바뀐 것만 남김
// ============================================================

(function () {
  const nowISO = () => new Date().toISOString();

  const who = () => {
    try { return (typeof Auth !== 'undefined' && Auth.currentName) ? (Auth.currentName() || '') : ''; } catch (_) { return ''; }
  };
  const whoEmail = () => {
    try { return (typeof Auth !== 'undefined' && Auth.currentEmail) ? (Auth.currentEmail() || '') : ''; } catch (_) { return ''; }
  };

  // 비교용 정규화 — 값이 같은지 판단(객체·배열은 JSON 으로)
  const norm = (v) => {
    if (v == null) return '';
    if (typeof v === 'object') { try { return JSON.stringify(v); } catch (_) { return String(v); } }
    return String(v);
  };
  // 표시용 — 이력에 남길 사람이 읽는 값(긴 객체·배열은 요약)
  const disp = (v) => {
    if (v == null || v === '') return '';
    if (Array.isArray(v)) return `${v.length}개 항목`;
    if (typeof v === 'object') return '(내용)';
    const s = String(v);
    return s.length > 60 ? s.slice(0, 57) + '…' : s;
  };

  // before/after 를 labels 에 있는 필드만 비교 → 바뀐 항목 목록
  const diff = (before, after, labels) => {
    const out = [];
    Object.keys(labels || {}).forEach(f => {
      const a = before ? before[f] : undefined;
      const b = after ? after[f] : undefined;
      if (norm(a) !== norm(b)) out.push({ field: f, label: labels[f], from: disp(a), to: disp(b) });
    });
    return out;
  };

  const entry = (changes, opt) => ({
    ts: nowISO(),
    by: (opt && opt.by != null) ? opt.by : who(),
    byEmail: (opt && opt.byEmail != null) ? opt.byEmail : whoEmail(),
    action: (opt && opt.action) || '수정',
    reason: (opt && opt.reason) || '',
    changes: changes || [],
  });

  // 레코드에 이력 1건을 추가하고 updatedAt/updatedBy 를 갱신한다.
  //   changes 가 비어도 opt.force 면 남긴다(생성·상태전이 등 "변경필드는 없지만 사건인" 경우).
  const append = (record, changes, opt) => {
    if (!record) return record;
    if (!Array.isArray(record.editHistory)) record.editHistory = [];
    if ((changes && changes.length) || (opt && opt.force)) {
      record.editHistory.push(entry(changes, opt));
      if (record.editHistory.length > 200) record.editHistory = record.editHistory.slice(-200);
    }
    record.updatedAt = nowISO();
    record.updatedBy = (opt && opt.by != null) ? opt.by : who();
    return record;
  };

  // 가장 흔한 형태 — before 스냅샷 대비 record 의 바뀐 필드를 기록.
  //   변경이 없으면 이력을 남기지 않는다(updatedAt 도 건드리지 않음).
  const record = (rec, before, labels, opt) => {
    const changes = diff(before, rec, labels);
    if (!changes.length && !(opt && opt.force)) return rec;
    return append(rec, changes, opt);
  };

  // ============================================================
  // 통합 수집 — 흩어진 이력을 한 형태로 긁어온다(통합 감사 조회 화면용)
  //   전 업무의 이력이 서로 다른 키·형태로 저장돼 있어, 여기서 공통 항목으로 정규화한다.
  //     { ts, by, byEmail, module, target, action, summary, ref }
  // ============================================================
  const readArr = (key) => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
  const pickTs = (e) => e.ts || e.at || e.timestamp || e.date || '';
  const pickBy = (e) => e.by || e.actor || e.author || e.enteredBy || '';
  const pickAction = (e) => e.action || e.act || e.kind || '수정';
  const summarize = (e) => {
    if (Array.isArray(e.changes) && e.changes.length) {
      return e.changes.map(c => {
        const lab = c.label || c.field || '';
        if (c.from != null || c.to != null) return `${lab}: ${c.from == null ? '' : c.from}→${c.to == null ? '' : c.to}`;
        return lab + (c.detail ? `(${c.detail})` : '');
      }).join(', ');
    }
    return e.detail || e.content || e.comment || e.reason || '';
  };
  const norm1 = (e, module, target, ref) => ({
    ts: pickTs(e), by: pickBy(e), byEmail: e.byEmail || '',
    module, target: target || '', action: pickAction(e), summary: summarize(e),
    reason: e.reason || '', ref: ref || '',
  });

  // 소스 레지스트리 — 각 항목: {key, module, target(record), path}
  //   path: 'editHistory' | 'history' | 'logs' | 'flat' | {nest, hist} (중첩)
  const SOURCES = [
    { key: 'rm_suppliers', module: '협력사', target: r => r.name, path: 'editHistory' },
    { key: 'rm_formula_recipes', module: '배합비', target: r => `${r.productName || r.productCode || ''} ${r.version || ''}`.trim(), path: 'editHistory' },
    { key: 'rm_process_issues', module: '공정이슈', target: r => r.title, path: 'editHistory' },
    { key: 'lab_validations', module: '유효성평가', target: r => r.name || r.no, path: 'editHistory' },
    { key: 'calib_instruments', module: '계측기', target: r => `${r.name || ''} ${r.code || ''}`.trim(), path: 'editHistory' },
    { key: 'pest_reports', module: '구서관리', target: r => `${r.month || ''} ${r.factory || ''}`.trim(), path: 'editHistory' },
    { key: 'sqf_ca', module: 'SQF 시정조치', target: r => `${r.clause || ''} ${r.title || ''}`.trim(), path: 'editHistory' },
    { key: 'lab_records', module: '분석대장', target: r => `${r.name || r.code || ''} ${r.id || ''}`.trim(), path: 'editHistory' },
    { key: 'rm_materials', module: '원료코드', target: r => `${r.code || ''} ${r.name || ''}`.trim(), path: 'editHistory' },
    { key: 'rm_products', module: '제품코드', target: r => `${r.code || ''} ${r.name || ''}`.trim(), path: 'editHistory' },
    { key: 'feed_certs', module: '사료성분등록증', target: r => r.id, path: 'history' },
    { key: 'lab_haccp_docs', module: 'HACCP 문서', target: r => `${r.docNo || ''} ${r.title || ''}`.trim(), path: 'history' },
    { key: 'journal_records', module: '전자일지', target: r => r.tplName || r.tplCode, path: 'history' },
    { key: 'sqf_docs', module: 'SQF 문서', target: r => `${r.docNo || ''} ${r.title || ''}`.trim(), path: 'history' },
    { key: 'rm_voc', module: 'VOC', target: r => r.customer || r.productName || r.id, path: 'logs' },
    { key: 'audit_findings', module: '심사지적', target: r => r.agency || r.type, path: { nest: 'findings', hist: 'history', label: f => f.title || f.clause } },
    { key: 'quality_meetings', module: '회의안건', target: r => r.title, path: { nest: 'agenda', hist: 'history', label: a => a.title } },
    { key: 'lab_spec_log', module: '규격변경', target: r => `${r.name || r.code || ''} ${r.item || ''}`.trim(), path: 'flat' },
    { key: 'lab_specsheet_log', module: '규격서개정', target: r => r.revNo ? ('rev ' + r.revNo) : '', path: 'flat' },
  ];

  const collect = () => {
    const out = [];
    SOURCES.forEach(src => {
      const rows = readArr(src.key);
      if (src.path === 'flat') { rows.forEach(e => out.push(norm1(e, src.module, src.target(e), e.id))); return; }
      rows.forEach(rec => {
        const tgt = (() => { try { return src.target(rec) || ''; } catch (_) { return ''; } })();
        if (typeof src.path === 'string') {
          const arr = Array.isArray(rec[src.path]) ? rec[src.path] : [];
          arr.forEach(e => out.push(norm1(e, src.module, tgt, rec.id)));
        } else {
          // 중첩: rec[nest][].hist[]
          const items = Array.isArray(rec[src.path.nest]) ? rec[src.path.nest] : [];
          items.forEach(it => {
            const sub = (() => { try { return src.path.label(it) || ''; } catch (_) { return ''; } })();
            const arr = Array.isArray(it[src.path.hist]) ? it[src.path.hist] : [];
            arr.forEach(e => out.push(norm1(e, src.module, `${tgt} · ${sub}`.trim(), rec.id)));
          });
        }
      });
    });
    // 최신순
    out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
    return out;
  };
  const modules = () => [...new Set(SOURCES.map(s => s.module))];

  window.AuditLog = { who, whoEmail, diff, entry, append, record, collect, modules };
})();
