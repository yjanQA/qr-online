// ============================================================
// chart_common.js — 전 차트 공통 툴팁/인터랙션 설정
//   · 같은 x(날짜)의 모든 계열을 한 툴팁에 함께 표시(index 모드)
//   · 툴팁이 마우스 커서를 따라다니되 차트(플롯) 영역 밖으로 나가지 않음
//   · 커서가 가리키는 지점에 세로 기준선(크로스헤어) 표시 — 선그래프 한정
// index.html에서 Chart.js CDN 바로 뒤에 로드한다.
// ============================================================

const WSChart = (() => {
  let installed = false;

  // 커서를 따라가는 툴팁 위치 계산기. 좌표를 chartArea로 잘라내 표 안에서만 움직인다.
  const installPositioner = () => {
    if (!Chart.Tooltip || !Chart.Tooltip.positioners || Chart.Tooltip.positioners.cursor) return;
    const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
    Chart.Tooltip.positioners.cursor = function (items, evtPos) {
      if (!evtPos) return false;
      const a = this.chart.chartArea;
      if (!a) return { x: evtPos.x, y: evtPos.y };
      // 세로는 툴팁 박스가 위/아래로 삐져나오지 않도록 박스 높이의 절반만큼 여유를 두고 자른다.
      // (this.height는 직전 프레임에 계산된 툴팁 높이 — 첫 프레임엔 0이라 다음 프레임에 보정됨)
      const half = (this.height || 0) / 2;
      return {
        x: clamp(evtPos.x, a.left, a.right),
        y: clamp(evtPos.y, a.top + half, a.bottom - half),
      };
    };
  };

  // 커서 x 위치 세로 점선. 선그래프에서만 그린다.
  const crosshair = {
    id: 'wsCrosshair',
    afterDatasetsDraw(chart) {
      if (chart.config.type !== 'line') return;
      const tt = chart.tooltip;
      const act = (tt && tt.getActiveElements) ? tt.getActiveElements() : [];
      if (!act || !act.length) return;
      const a = chart.chartArea;
      if (!a) return;
      const x = act[0].element.x;
      const ctx = chart.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, a.top);
      ctx.lineTo(x, a.bottom);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(120,134,160,0.55)';   // 밝은/어두운 배경 양쪽에서 보이는 중간 회색
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.restore();
    },
  };

  // 전역 기본값 설치. 개별 차트가 같은 옵션을 지정하면 그쪽이 우선한다.
  const install = () => {
    if (installed || typeof Chart === 'undefined') return false;
    installPositioner();
    Chart.register(crosshair);

    Chart.defaults.interaction = { mode: 'index', intersect: false, axis: 'x' };
    Chart.defaults.hover = Object.assign({}, Chart.defaults.hover, { mode: 'index', intersect: false, axis: 'x' });

    const tip = Chart.defaults.plugins.tooltip;
    tip.mode = 'index';
    tip.intersect = false;
    tip.position = 'cursor';
    tip.animation = { duration: 80 };   // 커서 이동에 부드럽게 따라붙기
    tip.backgroundColor = 'rgba(18,24,38,0.94)';
    tip.borderColor = 'rgba(255,255,255,0.14)';
    tip.borderWidth = 1;
    tip.titleColor = '#e5e9f0';
    tip.bodyColor = '#c7d0e0';
    tip.padding = 10;
    tip.caretSize = 5;
    tip.itemSort = (a, b) => a.datasetIndex - b.datasetIndex;

    installed = true;
    return true;
  };

  // Chart.js CDN이 늦게 뜰 수 있어 즉시 시도 + 로드 완료 시 재시도.
  if (!install()) {
    window.addEventListener('load', install);
    document.addEventListener('DOMContentLoaded', install);
  }

  return { install };
})();
