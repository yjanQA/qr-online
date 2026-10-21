// ============================================================
// winboard.js — 자유 이동·크기조절 플로팅 윈도우 매니저 (v3)
//   · 이동: 제목표시줄 드래그
//   · 크기조절: 오른쪽 아래 전용 핸들(.win-resize) 드래그
//   · 저장: 사용자가 이동/크기조절할 때만(pointerup) localStorage 저장
//   · 재진입: 저장값(없으면 기본값) 그대로 복원 → 크기 밀림 없음
// ============================================================

const WinBoard = (() => {
  let z = 10;
  let boardEl = null, page = 'board', layout = {}, defaults = {}, onResize = null;
  const MIN_W = 240, MIN_H = 140;

  const keyFor = () => 'lab_layout_v3_' + page;   // v3: 커스텀 리사이즈 + 저장방식 개선
  const loadLayout = () => { try { layout = JSON.parse(localStorage.getItem(keyFor()) || '{}') || {}; } catch (_) { layout = {}; } };
  const saveLayout = () => { try { localStorage.setItem(keyFor(), JSON.stringify(layout)); } catch (_) {} };

  const geomOf = (id) => layout[id] || defaults[id] || { x: 20, y: 20, w: 360, h: 260 };

  const applyGeom = (win) => {
    const g = geomOf(win.dataset.win);
    win.style.left = g.x + 'px'; win.style.top = g.y + 'px';
    win.style.width = g.w + 'px'; win.style.height = g.h + 'px';
  };

  const persist = (win) => {
    layout[win.dataset.win] = {
      x: parseInt(win.style.left) || 0, y: parseInt(win.style.top) || 0,
      w: win.offsetWidth, h: win.offsetHeight,
    };
    saveLayout();
  };

  const updateBoardHeight = () => {
    if (!boardEl) return;
    let max = 0;
    boardEl.querySelectorAll('.win').forEach(w => { max = Math.max(max, w.offsetTop + w.offsetHeight); });
    boardEl.style.height = (max + 40) + 'px';
  };

  const bringFront = (win) => { win.style.zIndex = ++z; };

  // ── 이동(제목표시줄) ──
  const startDrag = (e, win) => {
    if (e.target.closest('.win-btn') || e.target.closest('.win-resize')) return;
    bringFront(win);
    const sx = e.clientX, sy = e.clientY;
    const ox = parseInt(win.style.left) || 0, oy = parseInt(win.style.top) || 0;
    const move = (ev) => {
      win.style.left = Math.max(0, ox + (ev.clientX - sx)) + 'px';
      win.style.top = Math.max(0, oy + (ev.clientY - sy)) + 'px';
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      persist(win); updateBoardHeight();
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    e.preventDefault();
  };

  // ── 크기조절(전용 핸들) ──
  const startResize = (e, win) => {
    e.stopPropagation();
    bringFront(win);
    const sx = e.clientX, sy = e.clientY;
    const ow = win.offsetWidth, oh = win.offsetHeight;
    const move = (ev) => {
      win.style.width = Math.max(MIN_W, ow + (ev.clientX - sx)) + 'px';
      win.style.height = Math.max(MIN_H, oh + (ev.clientY - sy)) + 'px';
      if (onResize) onResize(win.dataset.win);
    };
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      persist(win); updateBoardHeight();
      if (onResize) onResize(win.dataset.win);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    e.preventDefault();
  };

  const mount = (el, opts = {}) => {
    boardEl = el; page = opts.page || 'board'; defaults = opts.defaults || {}; onResize = opts.onResize || null;
    loadLayout();

    const wins = [...boardEl.querySelectorAll('.win')];
    const isMobile = window.innerWidth < 820;
    if (isMobile) { boardEl.classList.add('board-static'); boardEl.style.height = 'auto'; return; }
    boardEl.classList.remove('board-static');

    wins.forEach(win => {
      applyGeom(win);                       // 저장값(없으면 기본값) 복원 — 크기 밀림 없음
      const head = win.querySelector('.win-head');
      if (head) head.addEventListener('pointerdown', (e) => startDrag(e, win));
      win.addEventListener('pointerdown', () => bringFront(win));
      // 전용 리사이즈 핸들 주입(내용영역 위에 올려 잡히도록)
      if (!win.querySelector('.win-resize')) {
        const h = document.createElement('div');
        h.className = 'win-resize';
        h.title = '드래그하여 크기 조절';
        h.addEventListener('pointerdown', (e) => startResize(e, win));
        win.appendChild(h);
      }
    });
    updateBoardHeight();
    if (onResize) wins.forEach(w => onResize(w.dataset.win));  // 차트 등 초기 사이즈 보정
  };

  const reset = () => { layout = {}; try { localStorage.removeItem(keyFor()); } catch (_) {} };

  return { mount, reset };
})();
