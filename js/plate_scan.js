// ============================================================
// plate_scan.js — 카메라 번호 인식 (차량번호판 / 문서번호)
//   * 웹캠(노트북·핸드폰) 영상 위 가이드박스 → 해당 영역 캡처 → OCR
//   * OCR 엔진: Tesseract.js (CDN 지연 로드, kor+eng)
//   * 한국 번호판 형식 후처리(정규식 + 유사문자 보정)
//   * 인식 결과를 사용자가 확인/수정 후 저장(공장별 분리)
//   * 2단계(서버 OCR)로 확장 시 recognizeCanvas() 만 교체하면 됨
// ============================================================

const PlateScanPage = (() => {
  const KEY = 'plateScans';

  // 로컬 저장(DB.get/set 은 비공개라 localStorage 직접 사용)
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const store = (list) => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) {} };

  // 캡처 가이드박스 비율(영상 프레임 기준) — 캡처 ROI 와 화면 오버레이가 동일 비율
  const BOX = { w: 0.84, h: 0.24 };

  let mode = 'plate';                  // 'plate' | 'doc'
  let _stream = null;                  // 활성 MediaStream
  let _auto = false;                   // 자동 인식 루프 on/off
  let _busy = false;                   // OCR 진행 중
  let _last = null;                    // 최근 인식 후보 {plate, raw, confidence, thumb}
  let _worker = null;                  // Tesseract 워커(재사용)
  let _tessLoading = null;             // CDN 로드 프라미스
  let _obs = null;                     // 페이지 이탈 감지 옵서버

  // ── 카메라 차단 사유(HTTP 내부주소·미지원 브라우저) ─────────────
  const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  const cameraBlockReason = () => {
    if (location.protocol === 'http:' && !isLocalhost()) {
      return 'HTTP 내부주소에서는 브라우저가 실시간 카메라를 차단할 수 있습니다. HTTPS로 접속하거나 아래 "사진으로 인식"을 사용하세요.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return '현재 브라우저가 실시간 카메라를 지원하지 않습니다. "사진으로 인식"을 사용하세요.';
    }
    return '';
  };

  // ── Tesseract 지연 로드 + 워커 준비 ─────────────────────────────
  const ensureTesseract = () => {
    if (window.Tesseract) return Promise.resolve();
    if (!_tessLoading) {
      _tessLoading = new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
        s.onload = res;
        s.onerror = () => rej(new Error('OCR 엔진(Tesseract) 로드 실패 — 인터넷 연결을 확인하세요.'));
        document.head.appendChild(s);
      });
    }
    return _tessLoading;
  };

  const getWorker = async (onProgress) => {
    await ensureTesseract();
    if (_worker) return _worker;
    _worker = await Tesseract.createWorker(['kor', 'eng'], 1, {
      logger: (m) => { if (onProgress) onProgress(m); },
    });
    return _worker;
  };

  // ── 후처리: 유사문자 보정 + 번호판/문서번호 추출 ────────────────
  const letterToDigit = (s) => {
    const map = {
      O: '0', o: '0', D: '0', Q: '0', U: '0',
      I: '1', l: '1', '|': '1', '!': '1', i: '1', L: '1',
      Z: '2', z: '2',
      E: '3',
      A: '4',
      S: '5', s: '5',
      G: '6', b: '6',
      T: '7', J: '7',
      B: '8',
      g: '9', q: '9',
    };
    return s.replace(/[A-Za-z|!]/g, (c) => map[c] ?? '');
  };

  const extractPlate = (raw) => {
    const s = raw.replace(/[\s\-·.,_]/g, '');
    // 구형(지역명): 한글2 + 숫자2 + 한글1 + 숫자4  (예: 서울12가3456)
    let m = s.match(/([가-힣]{2})(\d{2})([가-힣])(\d{4})/);
    if (m) return `${m[1]} ${m[2]}${m[3]} ${m[4]}`;
    // 신형: 숫자2~3 + 한글1 + 숫자4  (숫자영역 오인식 글자→숫자 보정)
    const cand = letterToDigit(s);           // 한글은 그대로, 알파벳만 숫자로
    m = cand.match(/(\d{2,3})([가-힣])(\d{4})/);
    if (m) return `${m[1]}${m[2]} ${m[3]}`;
    return '';
  };

  const extractDoc = (raw) => raw.replace(/\s+/g, '').replace(/[^0-9A-Za-z가-힣\-/]/g, '');

  const postProcess = (raw, confidence) => {
    const clean = (raw || '').trim();
    const value = mode === 'plate' ? extractPlate(clean) : extractDoc(clean);
    return { value, raw: clean, confidence: confidence != null ? Math.round(confidence) : null, matched: !!value };
  };

  // ── 프레임/파일 → 전처리 캔버스(그레이스케일+대비) ───────────────
  const preprocessTo = (canvas, source, sx, sy, sw, sh) => {
    const scale = Math.max(1, 220 / sh);     // ROI 높이를 ~220px 로 업스케일
    canvas.width = Math.round(sw * scale);
    canvas.height = Math.round(sh * scale);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = img.data;
    // 그레이스케일 + min/max 대비 스트레치
    let min = 255, max = 0;
    const gray = new Uint8Array(d.length / 4);
    for (let i = 0, g = 0; i < d.length; i += 4, g++) {
      const v = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
      gray[g] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for (let i = 0, g = 0; i < d.length; i += 4, g++) {
      let v = ((gray[g] - min) * 255 / range) | 0;
      v = v < 0 ? 0 : v > 255 ? 255 : v;
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  };

  const makeThumb = (srcCanvas) => {
    try {
      const t = document.createElement('canvas');
      const w = 200, h = Math.round((srcCanvas.height / srcCanvas.width) * w) || 60;
      t.width = w; t.height = h;
      t.getContext('2d').drawImage(srcCanvas, 0, 0, w, h);
      return t.toDataURL('image/jpeg', 0.6);
    } catch (_) { return ''; }
  };

  // ── OCR 실행(캔버스 → 텍스트) ─────────────────────────────────
  const recognizeCanvas = async (canvas, onProgress) => {
    const worker = await getWorker(onProgress);
    // 화이트리스트는 LSTM 엔진의 한글 인식을 오히려 망가뜨림(검증됨) → 미사용.
    //   숫자영역 오인식은 후처리(letterToDigit)에서 보정. PSM 7 = 단일 라인.
    await worker.setParameters({ tessedit_pageseg_mode: '7' });
    const { data } = await worker.recognize(canvas);
    return { text: data.text || '', confidence: data.confidence };
  };

  // ── 캡처(라이브 프레임 ROI) → 인식 ────────────────────────────
  const captureAndRecognize = async () => {
    if (_busy) return;
    const video = document.getElementById('plate-video');
    if (!video || !video.videoWidth) { App.toast('카메라가 준비되지 않았습니다.', 'warning'); return; }
    _busy = true;
    setStatus('인식 중…');
    try {
      const vw = video.videoWidth, vh = video.videoHeight;
      const sw = vw * BOX.w, sh = vh * BOX.h;
      const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
      const canvas = preprocessTo(document.createElement('canvas'), video, sx, sy, sw, sh);
      const { text, confidence } = await recognizeCanvas(canvas, onOcrProgress);
      const res = postProcess(text, confidence);
      res.thumb = makeThumb(canvas);
      handleRecognition(res);
    } catch (e) {
      console.error('[Plate] OCR 오류', e);
      App.toast('인식 오류: ' + (e.message || e), 'error', 6000);
      setStatus('');
    } finally {
      _busy = false;
    }
  };

  // ── 사진 파일 → 인식 ─────────────────────────────────────────
  const handleImageFile = async (file) => {
    if (!file || _busy) return;
    _busy = true;
    setStatus('사진 분석 중…');
    try {
      const img = await new Promise((res, rej) => {
        const im = new Image();
        im.onload = () => res(im);
        im.onerror = () => rej(new Error('이미지 로드 실패'));
        im.src = URL.createObjectURL(file);
      });
      // 사진은 중앙 가로 밴드를 ROI 로 사용(번호판을 가운데 두고 촬영 가정)
      const sw = img.naturalWidth * 0.9, sh = img.naturalHeight * 0.5;
      const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2;
      const canvas = preprocessTo(document.createElement('canvas'), img, sx, sy, sw, sh);
      const { text, confidence } = await recognizeCanvas(canvas, onOcrProgress);
      const res = postProcess(text, confidence);
      res.thumb = makeThumb(canvas);
      handleRecognition(res);
      URL.revokeObjectURL(img.src);
    } catch (e) {
      console.error('[Plate] 사진 OCR 오류', e);
      App.toast('사진 인식 오류: ' + (e.message || e), 'error', 6000);
      setStatus('');
    } finally {
      _busy = false;
    }
  };

  const onOcrProgress = (m) => {
    if (m && m.status === 'recognizing text') {
      setStatus(`인식 중… ${Math.round((m.progress || 0) * 100)}%`);
    } else if (m && /load|initializ/i.test(m.status || '')) {
      setStatus('OCR 엔진 준비 중…');
    }
  };

  const setStatus = (txt) => {
    const el = document.getElementById('plate-status');
    if (el) el.textContent = txt || '';
  };

  // 인식 결과 반영(확인 UI 채우기). 자동모드면 매칭 시 정지.
  const handleRecognition = (res) => {
    _last = res;
    setStatus('');
    const conf = res.confidence != null ? ` · 신뢰도 ${res.confidence}%` : '';
    const box = document.getElementById('plate-result');
    if (box) {
      box.innerHTML = `
        <div class="card mb-16" style="border-color:${res.matched ? 'var(--success)' : 'var(--warning)'}">
          <div class="flex items-center justify-between mb-8">
            <div class="badge badge-${res.matched ? 'success' : 'warning'}">${res.matched ? '인식됨' : '형식 불일치 — 확인 필요'}${conf}</div>
            ${res.thumb ? `<img src="${res.thumb}" alt="캡처" style="height:34px;border-radius:4px;border:1px solid var(--border)">` : ''}
          </div>
          <div class="flex gap-8">
            <input type="text" class="form-input" id="plate-value" value="${res.value || res.raw || ''}"
              style="flex:1;font-size:20px;font-weight:700;letter-spacing:1px;text-align:center"
              placeholder="${mode === 'plate' ? '예: 12가 3456' : '문서번호'}">
            <button class="btn btn-primary" onclick="PlateScanPage.save()">저장</button>
          </div>
          ${res.raw && res.raw !== res.value ? `<div class="text-xs text-muted mt-8">원문: <span class="font-mono">${res.raw}</span></div>` : ''}
        </div>`;
    }
    if (res.matched) {
      if (_auto) stopAuto();
      App.toast('인식: ' + res.value, 'success', 2500);
    }
  };

  // ── 카메라 시작/정지 ─────────────────────────────────────────
  const startCamera = async () => {
    const reason = cameraBlockReason();
    if (reason) { App.toast(reason, 'warning', 8000); return; }
    try {
      _stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      App.refreshPage();  // afterRender 에서 스트림을 새 video 에 연결
    } catch (e) {
      console.error('[Plate] 카메라 오류', e);
      App.toast('카메라를 열 수 없습니다: ' + (e.message || e), 'error', 7000);
      _stream = null;
    }
  };

  const stopCamera = () => {
    stopAuto();
    if (_stream) { _stream.getTracks().forEach((t) => t.stop()); _stream = null; }
  };

  const toggleCamera = () => { _stream ? (stopCamera(), App.refreshPage()) : startCamera(); };

  // ── 자동 인식 루프 ───────────────────────────────────────────
  const toggleAuto = () => {
    if (_auto) { stopAuto(); App.refreshPage(); return; }
    if (!_stream) { App.toast('먼저 카메라를 켜세요.', 'warning'); return; }
    _auto = true;
    App.refreshPage();
    loopAuto();
  };
  const stopAuto = () => { _auto = false; };
  const loopAuto = async () => {
    if (!_auto || !_stream) return;
    if (!_busy) await captureAndRecognize();
    if (_auto && _stream) setTimeout(loopAuto, 1600);
  };

  const switchMode = (m) => {
    if (mode === m) return;
    mode = m;
    _last = null;
    App.refreshPage();
  };

  // ── 저장 / 삭제 ──────────────────────────────────────────────
  const save = () => {
    const input = document.getElementById('plate-value');
    const value = (input?.value || '').trim();
    if (!value) { App.toast('번호를 입력하세요.', 'warning'); return; }
    const factory = App.getFactory();
    const list = load();
    list.unshift({
      id: 'PLT-' + Date.now().toString(36).toUpperCase(),
      type: mode,
      value,
      raw: _last?.raw || '',
      confidence: _last?.confidence ?? null,
      thumb: _last?.thumb || '',
      factory,
      at: new Date().toISOString(),
    });
    store(list.slice(0, 50));   // 최근 50건 유지(용량 보호)
    App.toast('저장되었습니다: ' + value, 'success');
    _last = null;
    App.refreshPage();
  };

  const remove = (id) => {
    store(load().filter((r) => r.id !== id));
    App.refreshPage();
  };

  const copy = (value) => {
    try { navigator.clipboard?.writeText(value); App.toast('복사됨: ' + value, 'info', 1500); } catch (_) {}
  };

  // ── 렌더 ─────────────────────────────────────────────────────
  const render = () => {
    const factory = App.getFactory();
    const all = load();
    const rows = factory === 'ALL' ? all : all.filter((r) => r.factory === factory);
    const reason = cameraBlockReason();
    const on = !!_stream;
    const label = mode === 'plate' ? '차량번호' : '문서번호';

    return `
    <div class="fade-in" style="max-width:560px;margin:0 auto">
      <div class="flex gap-8 mb-16">
        <button class="btn btn-${mode === 'plate' ? 'primary' : 'ghost'} btn-sm" onclick="PlateScanPage.switchMode('plate')">차량번호</button>
        <button class="btn btn-${mode === 'doc' ? 'primary' : 'ghost'} btn-sm" onclick="PlateScanPage.switchMode('doc')">문서번호</button>
        <div style="flex:1"></div>
        <span class="text-xs text-muted" style="align-self:center">저장 대상: ${factory === 'ALL' ? '전체 공장' : DB.getFactoryName(factory)}</span>
      </div>

      <div class="card mb-16">
        <div class="card-header">
          <div class="card-title"><span class="icon"></span> ${label} 카메라 인식</div>
          <button class="btn btn-${on ? 'danger' : reason ? 'ghost' : 'primary'} btn-sm" onclick="PlateScanPage.toggleCamera()">
            ${on ? '카메라 끄기' : '카메라 켜기'}
          </button>
        </div>

        <div style="position:relative;background:#0b1220;border-radius:8px;overflow:hidden;${on ? '' : 'min-height:180px;'}">
          <video id="plate-video" playsinline muted style="width:100%;height:auto;display:${on ? 'block' : 'none'}"></video>
          ${on ? `
            <div style="position:absolute;left:${(0.5 - BOX.w / 2) * 100}%;top:${(0.5 - BOX.h / 2) * 100}%;width:${BOX.w * 100}%;height:${BOX.h * 100}%;
                        border:2px solid #38bdf8;border-radius:6px;box-shadow:0 0 0 2000px rgba(0,0,0,.28);pointer-events:none"></div>
            <div style="position:absolute;left:0;right:0;bottom:8px;text-align:center;color:#cbd5e1;font-size:12px;pointer-events:none">
              번호를 파란 박스 안에 맞추세요
            </div>
          ` : `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:180px;color:var(--text-muted)">
              <div style="font-size:34px"></div>
              <div class="font-bold mb-4">카메라로 ${label} 스캔</div>
              <div class="text-sm">노트북·핸드폰 카메라로 ${label}를 촬영해 인식합니다</div>
            </div>
          `}
        </div>

        ${on ? `
        <div class="flex gap-8 mt-12">
          <button class="btn btn-primary" style="flex:1" onclick="PlateScanPage.capture()">인식</button>
          <button class="btn btn-${_auto ? 'danger' : 'outline-primary'}" onclick="PlateScanPage.toggleAuto()">${_auto ? '자동 중지' : '자동 인식'}</button>
        </div>` : ''}

        <div id="plate-status" class="text-sm" style="color:var(--info);min-height:18px;margin-top:8px"></div>

        ${reason ? `<div class="scan-notice scan-notice-warning"><strong>실시간 카메라가 막혀 있습니다</strong><span>${reason}</span></div>` : ''}

        <div class="scan-fallback-panel">
          <label class="btn btn-outline-primary btn-sm">
            사진으로 인식
            <input type="file" accept="image/*" capture="environment" class="hidden"
              onchange="PlateScanPage.handleImageFile(this.files[0]); this.value=''">
          </label>
          <span>카메라가 막히거나 멀리 있는 번호는 사진을 찍어 인식하세요.</span>
        </div>

        <div class="flex gap-8 mt-12">
          <input type="text" class="form-input" id="plate-manual" placeholder="${label} 직접 입력…" style="flex:1">
          <button class="btn btn-ghost" onclick="PlateScanPage.saveManual()">저장</button>
        </div>
      </div>

      <div id="plate-result"></div>

      <div class="card">
        <div class="card-header"><div class="card-title">인식 이력 <span class="text-muted text-sm">(${rows.length})</span></div></div>
        <div class="table-wrapper"><table>
          <thead><tr><th>구분</th><th>${label}</th><th>공장</th><th>시각</th><th></th></tr></thead>
          <tbody>
            ${rows.length === 0 ? `<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--text-muted)">저장된 인식 결과가 없습니다</td></tr>` :
              rows.map((r) => `<tr>
                <td class="text-xs">${r.type === 'doc' ? '문서' : '차량'}</td>
                <td><strong class="font-mono" style="font-size:15px">${r.value}</strong>${r.confidence != null ? ` <span class="text-xs text-muted">${r.confidence}%</span>` : ''}</td>
                <td class="text-xs">${DB.getFactoryName(r.factory) || r.factory}</td>
                <td class="text-xs">${r.at ? new Date(r.at).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '-'}</td>
                <td style="white-space:nowrap">
                  <button class="btn btn-ghost btn-xs" onclick="PlateScanPage.copy('${r.value.replace(/'/g, "\\'")}')">복사</button>
                  <button class="btn btn-ghost btn-xs" onclick="PlateScanPage.remove('${r.id}')">삭제</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>
    </div>`;
  };

  // 렌더 후: 스트림 재연결 + 이탈 시 카메라 정리 옵서버
  const afterRender = () => {
    const video = document.getElementById('plate-video');
    if (video && _stream) {
      video.srcObject = _stream;
      video.play?.().catch(() => {});
    }
    const host = document.getElementById('page-content');
    if (host && !_obs) {
      _obs = new MutationObserver(() => {
        // 다른 페이지로 이동해 video 가 사라지면 카메라 종료
        if (_stream && !document.getElementById('plate-video')) {
          stopCamera();
          _obs.disconnect();
          _obs = null;
        }
      });
      _obs.observe(host, { childList: true, subtree: true });
    }
  };

  const saveManual = () => {
    const input = document.getElementById('plate-manual');
    const v = (input?.value || '').trim();
    if (!v) { App.toast('번호를 입력하세요.', 'warning'); return; }
    const factory = App.getFactory();
    const list = load();
    list.unshift({ id: 'PLT-' + Date.now().toString(36).toUpperCase(), type: mode, value: v, raw: v, confidence: null, thumb: '', factory, at: new Date().toISOString() });
    store(list.slice(0, 50));
    App.toast('저장되었습니다: ' + v, 'success');
    _last = null;
    App.refreshPage();
  };

  return {
    render, afterRender,
    toggleCamera, capture: captureAndRecognize, toggleAuto,
    handleImageFile, switchMode, save, saveManual, remove, copy,
  };
})();
