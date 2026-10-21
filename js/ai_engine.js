// ============================================================
// ai_engine.js — AI 분석 엔진 (로컬 규칙 기반 + Claude API 연동)
// ============================================================

const AIEngine = (() => {

  // ── 설정 키 ──
  const CLAUDE_KEY_STORAGE = 'ws_claude_api_key';
  const CLAUDE_MODEL = 'claude-sonnet-5';

  // ── Claude API Key 관리 ──
  const getApiKey = () => localStorage.getItem(CLAUDE_KEY_STORAGE) || '';
  const setApiKey = (key) => {
    if (key) localStorage.setItem(CLAUDE_KEY_STORAGE, key.trim());
    else localStorage.removeItem(CLAUDE_KEY_STORAGE);
  };
  const hasApiKey = () => !!getApiKey();

  // ============================================================
  // 1. 재고 위험도 분석 (로컬)
  // ============================================================
  const analyzeInventoryRisk = (factory = 'ALL') => {
    const rows = DB.getInventoryCycleRows(factory);
    const silos = factory === 'ALL' ? DB.getSilos() : DB.getSilosByFactory(factory);
    const results = [];

    // 사일로 기반 위험도
    silos.forEach(silo => {
      const sum = DB.getSiloCapacitySummary(silo);
      const usageRows = DB.getMaterialUsageRows(factory, 30)
        .filter(r => r.materialCode === silo.materialCode);
      const used30d = usageRows.reduce((s, r) => s + r.qty, 0);
      const avgDaily = used30d / 30;
      const coverDays = avgDaily > 0 ? Math.floor(sum.totalQty / avgDaily) : null;

      let risk = 'ok';
      let reason = '';
      let recommendation = '';

      if (sum.pct === 0) {
        risk = 'empty';
        reason = '사일로가 비어 있습니다.';
        recommendation = '즉시 발주 및 입고 처리가 필요합니다.';
      } else if (coverDays !== null && coverDays <= 7) {
        risk = 'critical';
        reason = `잔여 ${coverDays}일치 재고만 남았습니다 (일 사용량 ${Math.round(avgDaily).toLocaleString()}kg).`;
        recommendation = `최소 ${Math.round(avgDaily * 14).toLocaleString()}kg 긴급 발주를 권장합니다.`;
      } else if (coverDays !== null && coverDays <= 14) {
        risk = 'warn';
        reason = `${coverDays}일치 재고 (주의 수준).`;
        recommendation = `${Math.round(avgDaily * 21).toLocaleString()}kg 발주 계획을 수립하세요.`;
      } else if (sum.pct >= 95) {
        risk = 'warn';
        reason = '사일로가 거의 가득 찼습니다 (95% 이상).';
        recommendation = '투입 지시 후 공간 확보가 필요합니다.';
      } else {
        risk = 'ok';
        reason = coverDays !== null ? `${coverDays}일치 재고 보유 중.` : '재고 있음 (사용 이력 없음).';
      }

      results.push({
        type: 'SILO',
        id: silo.id,
        name: silo.name,
        material: silo.materialName || silo.materialCode,
        factory: silo.factory,
        stockKg: sum.totalQty,
        pct: sum.pct,
        coverDays,
        risk,
        reason,
        recommendation
      });
    });

    // 정렬: critical > warn > ok
    const order = { critical: 0, warn: 1, empty: 0, ok: 2 };
    return results.sort((a, b) => (order[a.risk] || 2) - (order[b.risk] || 2));
  };

  // ============================================================
  // 2. 품질 트렌드 분석 (로컬)
  // ============================================================
  const analyzeQualityTrend = (days = 30) => {
    const inspections = DB.getInspections();
    const analyses = DB.getRawAnalyses();
    const since = new Date();
    since.setDate(since.getDate() - days);

    const recent = inspections.filter(i => new Date(i.inspectedAt) >= since);
    const total = recent.length;
    const failed = recent.filter(i => i.verdict === 'FAIL').length;
    const defectRate = total > 0 ? (failed / total * 100).toFixed(1) : 0;

    // 이상 탐지 (불량률 5% 초과)
    const anomalies = [];
    if (parseFloat(defectRate) > 5) {
      anomalies.push({
        type: 'HIGH_DEFECT_RATE',
        message: `최근 ${days}일 품질 불합격률 ${defectRate}% — 평균 5% 초과`,
        severity: parseFloat(defectRate) > 15 ? 'critical' : 'warn'
      });
    }

    // 수분 함량 이상 탐지
    const highMoisture = analyses.filter(a => a.moisture > 15);
    if (highMoisture.length > 0) {
      anomalies.push({
        type: 'HIGH_MOISTURE',
        message: `수분 함량 15% 초과 원료 ${highMoisture.length}건 — 입고 품질 재검토 권장`,
        severity: 'warn'
      });
    }

    // 부적합 원료 Top 3
    const materialFail = {};
    recent.filter(i => i.verdict === 'FAIL').forEach(i => {
      const key = i.materialName || i.materialCode || '미상';
      materialFail[key] = (materialFail[key] || 0) + 1;
    });
    const topIssues = Object.entries(materialFail)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    // 7일 트렌드
    const trend = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const ds = d.toISOString().split('T')[0];
      const dayInsp = inspections.filter(x => x.inspectedAt.startsWith(ds));
      const dayFail = dayInsp.filter(x => x.verdict === 'FAIL');
      trend.push({
        date: ds,
        label: `${d.getMonth() + 1}/${d.getDate()}`,
        total: dayInsp.length,
        fail: dayFail.length,
        rate: dayInsp.length > 0 ? (dayFail.length / dayInsp.length * 100).toFixed(1) : '0'
      });
    }

    return { total, failed, defectRate, anomalies, topIssues, trend };
  };

  // ============================================================
  // 3. 계근 편차 이상 탐지 (로컬)
  // ============================================================
  const detectWeightAnomalies = () => {
    const weighings = DB.getWeighings();
    const settings = DB.getSettings();
    const alertPct = settings.weightAlertPct || 2;
    return weighings
      .filter(w => Math.abs(w.diffPct) > alertPct)
      .map(w => ({
        receivingId: w.receivingId,
        materialName: w.materialName,
        vehicleNo: w.vehicleNo,
        diffPct: w.diffPct,
        anomalyScore: Math.min(100, Math.round(Math.abs(w.diffPct) / alertPct * 50)),
        flag: Math.abs(w.diffPct) > alertPct * 2 ? 'CRITICAL' : 'WARN'
      }))
      .sort((a, b) => b.anomalyScore - a.anomalyScore)
      .slice(0, 10);
  };

  // ============================================================
  // 4. 발주 예측 (로컬)
  // ============================================================
  const predictReorderNeeds = (factory = 'ALL', leadDays = 7) => {
    const cycles = DB.getInventoryCycleRows(factory);
    return cycles
      .filter(r => r.coverDays !== null || r.stockKg === 0)
      .map(r => {
        let urgency = 'low';
        let urgencyLabel = '여유';
        let recommendedQty = 0;

        if (r.stockKg === 0) {
          urgency = 'critical';
          urgencyLabel = '긴급';
          recommendedQty = Math.round((r.avgDaily || 5000) * 14);
        } else if (r.coverDays <= leadDays) {
          urgency = 'critical';
          urgencyLabel = '긴급';
          recommendedQty = Math.round((r.avgDaily || 0) * 21);
        } else if (r.coverDays <= 14) {
          urgency = 'high';
          urgencyLabel = '권고';
          recommendedQty = Math.round((r.avgDaily || 0) * 21);
        } else if (r.coverDays <= 21) {
          urgency = 'medium';
          urgencyLabel = '계획';
          recommendedQty = Math.round((r.avgDaily || 0) * 14);
        } else {
          urgency = 'low';
          urgencyLabel = '여유';
          recommendedQty = 0;
        }

        return {
          materialCode: r.materialCode,
          materialName: r.materialName,
          factory: r.factory,
          stockKg: r.stockKg,
          coverDays: r.coverDays,
          avgDailyKg: Math.round(r.avgDaily || 0),
          recommendedQty,
          urgency,
          urgencyLabel,
          reorderDate: r.reorderDate
        };
      })
      .filter(r => r.urgency !== 'low' || r.stockKg === 0)
      .sort((a, b) => {
        const o = { critical: 0, high: 1, medium: 2, low: 3 };
        return o[a.urgency] - o[b.urgency];
      });
  };

  // ============================================================
  // 5. 협력사 성과 점수 (로컬)
  // ============================================================
  const scoreSupplierPerformance = () => {
    const suppliers = DB.getSuppliers();
    const receivings = DB.getReceivings();
    const weighings  = DB.getWeighings();
    const inspections = DB.getInspections();

    return suppliers.map(s => {
      // 납품 이력
      const deliveries = receivings.filter(r => r.supplierName === s.name || r.supplierId === s.id);
      const total = deliveries.length;
      if (total === 0) return null;

      // 정시 납품률 (ARRIVED/IN_STOCK = 정시)
      const onTime = deliveries.filter(r => ['IN_STOCK', 'APPROVED', 'ARRIVED', 'PENDING_QC'].includes(r.status)).length;
      const onTimeRate = total > 0 ? onTime / total * 100 : 0;

      // 계근 편차 평균
      const myWeighings = weighings.filter(w => deliveries.some(d => d.id === w.receivingId));
      const avgDiff = myWeighings.length > 0
        ? myWeighings.reduce((s, w) => s + Math.abs(w.diffPct), 0) / myWeighings.length
        : 0;
      const weightScore = Math.max(0, 100 - avgDiff * 20); // 편차 1% = -20점

      // 품질 합격률
      const myInspections = inspections.filter(i => deliveries.some(d => d.id === i.receivingId));
      const qualityPass = myInspections.length > 0
        ? myInspections.filter(i => i.verdict !== 'FAIL').length / myInspections.length * 100
        : 100;

      // HACCP 점수 (있으면 반영)
      const haccpScore = s.haccpScore != null ? Number(s.haccpScore) : 70;

      // 종합 점수
      const score = Math.round(
        haccpScore * 0.3 +
        onTimeRate * 0.3 +
        weightScore * 0.2 +
        qualityPass * 0.2
      );

      let grade = 'A';
      if (score < 60) grade = 'D';
      else if (score < 70) grade = 'C';
      else if (score < 85) grade = 'B';

      return {
        id: s.id,
        name: s.name,
        code: s.code,
        mainItem: s.mainItem || '',
        totalDeliveries: total,
        onTimeRate: Math.round(onTimeRate),
        weightScore: Math.round(weightScore),
        qualityPass: Math.round(qualityPass),
        haccpScore: Math.round(haccpScore),
        score,
        grade,
        trend: score >= 80 ? 'up' : score >= 65 ? 'stable' : 'down'
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  };

  // ============================================================
  // 6. VOC 패턴 분석 (로컬)
  // ============================================================
  const analyzeVOCPattern = () => {
    const vocs = DB.getVOCs();
    if (vocs.length === 0) return { total: 0, openCount: 0, highSeverityCount: 0, categories: [], topProducts: [], rootCauses: [] };

    // 카테고리 빈도
    const catMap = {};
    vocs.forEach(v => {
      catMap[v.category] = (catMap[v.category] || 0) + 1;
    });
    const categories = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count, pct: Math.round(count / vocs.length * 100) }));

    // 제품별 VOC
    const prodMap = {};
    vocs.forEach(v => {
      const key = v.productName || v.productCode || '미상';
      prodMap[key] = (prodMap[key] || 0) + 1;
    });
    const topProducts = Object.entries(prodMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // 심각도 분포
    const highSeverity = vocs.filter(v => v.severity === 'HIGH').length;
    const openVOCs = vocs.filter(v => v.status !== 'CLOSED').length;

    return {
      total: vocs.length,
      openCount: openVOCs,
      highSeverityCount: highSeverity,
      categories,
      topProducts,
      rootCauses: categories.slice(0, 3).map(c => c.name)
    };
  };

  // ============================================================
  // 7. 종합 건강 점수 (0-100)
  // ============================================================
  const calcHealthScore = (factory = 'ALL') => {
    const stats = DB.getStats(factory);
    const qualityData = analyzeQualityTrend(30);
    const riskData = analyzeInventoryRisk(factory);
    const vocData = analyzeVOCPattern();

    // 재고 점수 (CRITICAL 있으면 감점)
    const criticalCount = riskData.filter(r => r.risk === 'critical' || r.risk === 'empty').length;
    const warnCount = riskData.filter(r => r.risk === 'warn').length;
    const inventoryScore = Math.max(0, 100 - criticalCount * 20 - warnCount * 8);

    // 품질 점수
    const qualityScore = Math.max(0, 100 - parseFloat(qualityData.defectRate) * 5);

    // 운영 점수 (예외처리 / 미스캔)
    const totalRecv = Math.max(1, stats.todayReceivingCount);
    const exceptRate = stats.exceptionCount / totalRecv;
    const operationScore = Math.max(0, 100 - exceptRate * 100 - stats.holdCount * 5);

    // VOC 점수
    const vocScore = Math.max(0, 100 - vocData.highSeverityCount * 15 - vocData.openCount * 3);

    const totalScore = Math.round(
      inventoryScore * 0.35 +
      qualityScore   * 0.30 +
      operationScore * 0.20 +
      vocScore       * 0.15
    );

    let label = '우수';
    if (totalScore < 40) label = '위험';
    else if (totalScore < 60) label = '주의';
    else if (totalScore < 75) label = '보통';
    else if (totalScore < 90) label = '양호';

    return {
      total: totalScore,
      label,
      breakdown: {
        inventory: Math.round(inventoryScore),
        quality:   Math.round(qualityScore),
        operation: Math.round(operationScore),
        voc:       Math.round(vocScore)
      }
    };
  };

  // ============================================================
  // 8. 로컬 자연어 쿼리 처리 (규칙 기반)
  // ============================================================
  const processLocalQuery = (question) => {
    const q = question.toLowerCase();
    const factory = App.getFactory();

    // 재고 위험
    if (q.includes('재고') && (q.includes('위험') || q.includes('부족') || q.includes('현황'))) {
      const risks = analyzeInventoryRisk(factory);
      const criticals = risks.filter(r => r.risk === 'critical' || r.risk === 'empty');
      const warns = risks.filter(r => r.risk === 'warn');
      if (criticals.length === 0 && warns.length === 0) {
        return `**재고 상태 양호**\n\n현재 모든 사일로의 재고가 안정적입니다. 위험 수준의 원료가 없습니다.`;
      }
      let msg = '';
      if (criticals.length > 0) {
        msg += `**긴급 재고 부족 (${criticals.length}건)**\n`;
        criticals.forEach(r => msg += `- ${r.name}: ${r.reason} → ${r.recommendation}\n`);
        msg += '\n';
      }
      if (warns.length > 0) {
        msg += `**주의 재고 (${warns.length}건)**\n`;
        warns.forEach(r => msg += `- ${r.name}: ${r.reason}\n`);
      }
      return msg;
    }

    // 품질 이상
    if (q.includes('품질') || q.includes('불량') || q.includes('검사')) {
      const qt = analyzeQualityTrend(30);
      let msg = `**최근 30일 품질 현황**\n\n`;
      msg += `- 총 검사: ${qt.total}건 / 불합격: ${qt.failed}건 / 불량률: **${qt.defectRate}%**\n`;
      if (qt.anomalies.length > 0) {
        msg += `\n**이상 탐지**\n`;
        qt.anomalies.forEach(a => msg += `- ${a.message}\n`);
      }
      if (qt.topIssues.length > 0) {
        msg += `\n**불합격 상위 원료**\n`;
        qt.topIssues.forEach(i => msg += `- ${i.name}: ${i.count}건\n`);
      }
      if (qt.anomalies.length === 0) msg += `\n현재 품질 이상 징후가 없습니다.`;
      return msg;
    }

    // 발주 예측
    if (q.includes('발주') || q.includes('주문') || q.includes('구매')) {
      const needs = predictReorderNeeds(factory);
      if (needs.length === 0) return `**현재 발주가 필요한 원료가 없습니다.**\n\n모든 원료의 재고가 충분합니다.`;
      let msg = `**발주 권장 원료 (${needs.length}건)**\n\n`;
      needs.slice(0, 5).forEach(n => {
        const icon = n.urgency === 'critical' ? '' : n.urgency === 'high' ? '' : '';
        msg += `${icon} **${n.materialName}** [${n.urgencyLabel}]\n`;
        msg += `  - 잔여: ${(n.coverDays !== null ? n.coverDays + '일치' : '소진')} / 권장 발주: ${n.recommendedQty.toLocaleString()}kg\n`;
      });
      return msg;
    }

    // VOC 분석
    if (q.includes('voc') || q.includes('클레임') || q.includes('불만')) {
      const voc = analyzeVOCPattern();
      if (voc.total === 0) return `**등록된 VOC가 없습니다.**`;
      let msg = `**VOC 현황 분석**\n\n`;
      msg += `- 전체: ${voc.total}건 / 미해결: ${voc.openCount}건 / 심각: ${voc.highSeverityCount}건\n\n`;
      if (voc.categories.length > 0) {
        msg += `**유형별 분포:** ${voc.categories.map(c => `${c.name}(${c.count}건)`).join(', ')}\n`;
      }
      if (voc.topProducts.length > 0) {
        msg += `**VOC 상위 제품:** ${voc.topProducts.slice(0, 3).map(p => p.name).join(', ')}`;
      }
      return msg;
    }

    // 사일로 현황
    if (q.includes('사일로') || q.includes('탱크')) {
      const silos = factory === 'ALL' ? DB.getSilos() : DB.getSilosByFactory(factory);
      let msg = `**사일로 현황 (${factory === 'ALL' ? '전체' : factory})**\n\n`;
      silos.forEach(s => {
        const sum = DB.getSiloCapacitySummary(s);
        const icon = sum.pct >= 90 ? '' : sum.pct >= 20 ? '' : sum.pct > 0 ? '' : '';
        msg += `${icon} ${s.name}: **${sum.pct}%** (${(sum.totalQty).toLocaleString()}kg/${s.maxCapacity.toLocaleString()}kg)\n`;
      });
      return msg;
    }

    // 오늘 현황
    if (q.includes('오늘') || q.includes('현황') || q.includes('요약')) {
      const stats = DB.getStats(factory !== 'ALL' ? factory : null);
      const health = calcHealthScore(factory);
      let msg = `**오늘 운영 현황 요약**\n\n`;
      msg += `시스템 건강 점수: **${health.total}점** (${health.label})\n\n`;
      msg += `- 오늘 입고예정: ${stats.todayReceivingCount}건 (${stats.todayReceivingTon.toLocaleString()}톤)\n`;
      msg += `- QR 스캔완료: ${stats.scannedCount}건\n`;
      msg += `- 사일로 배정대기: ${stats.siloWaitingCount}건\n`;
      msg += `- 미해결 VOC: ${stats.openVOCCount}건\n`;
      msg += `- QR 예외처리: ${stats.exceptionCount}건\n`;
      if (stats.exceptionCount > 0) msg += `\n예외 처리 항목이 있으니 확인이 필요합니다.`;
      return msg;
    }

    // 협력사 성과
    if (q.includes('협력사') || q.includes('공급사') || q.includes('점수')) {
      const scores = scoreSupplierPerformance();
      if (scores.length === 0) return `협력사 납품 이력이 충분하지 않습니다.`;
      let msg = `**협력사 성과 분석**\n\n`;
      scores.slice(0, 5).forEach((s, i) => {
        const icon = s.grade === 'A' ? '' : s.grade === 'B' ? '' : s.grade === 'C' ? '' : '';
        msg += `${icon} **${s.name}** - ${s.score}점 (${s.grade}등급)\n`;
        msg += `  납품 ${s.totalDeliveries}건 / 정시율 ${s.onTimeRate}% / 품질 ${s.qualityPass}%\n`;
      });
      return msg;
    }

    // 기본 응답 (Claude API 없을 때)
    return `**AI 어시스턴트**\n\n로컬 분석 엔진으로 답변할 수 있는 질문 예시:\n- "오늘 재고 현황 알려줘"\n- "발주가 필요한 원료는?"\n- "품질 이상 있어?"\n- "VOC 패턴 분석해줘"\n- "협력사 성과 점수 알려줘"\n- "사일로 현황"\n\nClaude API Key를 설정하면 더 자세한 자연어 분석이 가능합니다.`;
  };

  // ============================================================
  // 9. Claude API 스트리밍 호출
  // ============================================================
  const buildSystemPrompt = () => {
    const factory = App.getFactory();
    const stats = DB.getStats(factory !== 'ALL' ? factory : null);
    const health = calcHealthScore(factory);
    const riskData = analyzeInventoryRisk(factory).slice(0, 8);
    const reorderNeeds = predictReorderNeeds(factory).slice(0, 5);

    return `당신은 우성사료 QR 재고관리시스템의 AI 어시스턴트입니다.
현재 ${new Date().toLocaleDateString('ko-KR')} 기준 실시간 데이터를 기반으로 전문적이고 간결하게 답변하세요.

## 현재 시스템 현황 (${factory === 'ALL' ? '전체 공장' : factory + '공장'})
- 시스템 건강 점수: ${health.total}점 / 100점 (${health.label})
- 오늘 입고 예정: ${stats.todayReceivingCount}건 / QR 스캔완료: ${stats.scannedCount}건
- 사일로 배정 대기: ${stats.siloWaitingCount}건 / QR 예외: ${stats.exceptionCount}건
- 미해결 VOC: ${stats.openVOCCount}건 / 재고 부족: ${stats.lowStockCount}건
- 품질 불량률: ${stats.defectRate}%

## 재고 위험 현황 (Top 위험)
${riskData.filter(r => r.risk !== 'ok').map(r => `- [${r.risk.toUpperCase()}] ${r.name}: ${r.reason}`).join('\n') || '위험 재고 없음'}

## 발주 권장 원료
${reorderNeeds.map(n => `- [${n.urgencyLabel}] ${n.materialName}: ${n.coverDays !== null ? n.coverDays + '일치 잔여' : '소진'} / 권장 ${n.recommendedQty.toLocaleString()}kg`).join('\n') || '발주 필요 없음'}

## 답변 가이드라인
- 한국어로 간결하고 전문적으로 답변하세요
- 수치는 구체적으로 제시하세요
- 이모지를 적절히 활용하세요
- 위험/경고 사항은 명확히 강조하세요
- 실행 가능한 권고사항을 포함하세요`;
  };

  const askClaude = async function* (userMessage, conversationHistory = []) {
    const apiKey = getApiKey();
    if (!apiKey) {
      yield processLocalQuery(userMessage);
      return;
    }

    const systemPrompt = buildSystemPrompt();
    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage }
    ];

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-allow-browser': 'true'
        },
        body: JSON.stringify({
          model: CLAUDE_MODEL,
          max_tokens: 1024,
          // Sonnet 5는 thinking 생략 시 적응형 사고가 기본 ON이라
          // max_tokens 1024가 사고 토큰에 소진돼 답변이 잘릴 수 있음.
          // 빠른 채팅 응답을 유지하기 위해 사고를 명시적으로 비활성화.
          thinking: { type: 'disabled' },
          system: systemPrompt,
          messages,
          stream: true
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        if (response.status === 401) {
          yield '**API Key 오류**: Claude API Key가 유효하지 않습니다. 설정에서 API Key를 확인해주세요.';
        } else if (response.status === 429) {
          yield '**요청 제한**: API 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
        } else {
          yield `오류가 발생했습니다 (${response.status}): ${err.error?.message || '알 수 없는 오류'}`;
        }
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') return;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
              yield parsed.delta.text;
            }
          } catch (_) { /* JSON 파싱 오류 무시 */ }
        }
      }
    } catch (e) {
      if (e.name === 'TypeError' && e.message.includes('fetch')) {
        yield '**네트워크 오류**: Claude API에 연결할 수 없습니다. `file://` 프로토콜에서는 CORS 제한이 있습니다. `python -m http.server 8000`으로 로컬 서버를 구동 후 `http://localhost:8000`으로 접속해주세요.';
      } else {
        yield `오류: ${e.message}`;
      }
    }
  };

  // ============================================================
  // 불량/클레임 근본원인 분석 리포트 (로컬 규칙 기반 — 항상 동작)
  // ============================================================
  const buildRootCauseReport = (voc) => {
    if (!voc) return null;
    const trace = (voc.fgLotNo || voc.productCode) ? DB.traceVOC(voc.fgLotNo, voc.productCode, DB.vocMfgDate ? DB.vocMfgDate(voc) : '') : null;
    const receivings = (trace && trace.receivings) || [];

    const materialFindings = receivings.map(r => {
      const analyses = DB.getRawAnalysesByMaterial(r.materialCode) || [];
      const linked   = analyses.filter(a => a.receivingId === r.id);
      const pool     = linked.length ? linked : analyses.slice(0, 1);
      const fails    = pool.filter(a => a.verdict && a.verdict !== 'PASS');
      return { materialCode:r.materialCode, materialName:r.materialName, lotNo:r.lotNo, supplierName:r.supplierName, analyses:pool, hasIssue:fails.length>0, fails };
    });

    const ccpDevs = DB.getCCPLogs('ALL').filter(l => l.judged === 'DEVIATION').slice(0, 5);
    const issues  = DB.getIssues('ALL').filter(i => i.status !== 'CLOSED').slice(0, 5);

    const causes = [];
    materialFindings.filter(m => m.hasIssue).forEach(m =>
      causes.push({ area:'원료 품질', desc:`${m.materialName}(${m.lotNo||'LOT미상'}) 분석 이상 · 협력사 ${m.supplierName||'미상'}`, weight:3 }));
    if (ccpDevs.length) causes.push({ area:'공정(CCP)', desc:`CCP 한계이탈 ${ccpDevs.length}건 (${ccpDevs.map(d=>d.ccpName).join(', ')})`, weight:2 });
    if (voc.category === '이물혼입') causes.push({ area:'이물/포장', desc:'이물 혼입 — 금속검출·포장 라인 점검 필요', weight:2 });
    if (voc.category === '이취/변질') causes.push({ area:'보관/유통', desc:'이취·변질 — 수분/보관온도·유통기한 확인 필요', weight:2 });
    issues.forEach(i => causes.push({ area:'공정 이슈', desc:`${i.title} (${i.category})`, weight:1 }));
    causes.sort((a,b) => b.weight - a.weight);

    const actions = [];
    if (materialFindings.some(m => m.hasIssue)) actions.push('문제 원료 LOT 사용 배치 격리·재검사, 협력사 시정요청(CAR) 발행');
    if (ccpDevs.length) actions.push('CCP 이탈 구간 재현·검증, 모니터링 주기 단축 및 재발방지');
    if (voc.category === '이물혼입') actions.push('금속검출기 감도 점검, 포장 라인 이물관리 강화');
    if (voc.category === '이취/변질') actions.push('완제품 수분/보관 조건 점검, 유통기한 관리 강화');
    if (!actions.length) actions.push('동일 제품 LOT 잔여재고 전수 확인, 고객 회수 필요성 판단');

    const topCause = causes[0] || { area:'미확인', desc:'추적 데이터가 부족합니다. 원료 LOT/분석/CCP 기록을 보강하세요.' };
    return { voc, trace, materialFindings, ccpDevs, issues, causes, actions, topCause };
  };

  // Claude 심층분석용 프롬프트(선택 — API Key 있을 때만 askClaude 로 사용)
  const rootCausePrompt = (voc) => {
    const r = buildRootCauseReport(voc);
    const mats = r.materialFindings.map(m => `${m.materialName}/${m.lotNo||'?'}/협력사 ${m.supplierName||'?'}${m.hasIssue?'(분석이상)':''}`).join('; ') || '추적 데이터 없음';
    return `너는 사료제조 품질/HACCP 전문가야. 아래 클레임에 대해 5-Why 근본원인 분석과 시정·예방조치(CAPA) 보고서를 한국어로 간결하게 작성해줘.\n\n[클레임] ${voc.complaint} (유형:${voc.category}, 제품:${voc.productName||voc.productCode||'-'}, LOT:${voc.fgLotNo||'-'})\n[추적 원료] ${mats}\n[CCP 이탈] ${r.ccpDevs.map(d=>`${d.ccpName} ${d.value}${d.unit}`).join(', ')||'없음'}\n[공정 이슈] ${r.issues.map(i=>i.title).join(', ')||'없음'}\n[우선 후보원인] ${r.causes.map(c=>`${c.area}:${c.desc}`).join(' / ')||'없음'}\n\n형식: 1) 근본원인(5-Why) 2) 즉시조치 3) 재발방지(CAPA) 4) 재고/회수 판단.`;
  };

  // ============================================================
  // 공개 API
  // ============================================================
  return {
    getApiKey, setApiKey, hasApiKey,
    analyzeInventoryRisk,
    analyzeQualityTrend,
    detectWeightAnomalies,
    predictReorderNeeds,
    scoreSupplierPerformance,
    analyzeVOCPattern,
    calcHealthScore,
    processLocalQuery,
    askClaude,
    buildRootCauseReport,
    rootCausePrompt
  };
})();
