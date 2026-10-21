// ============================================================
// qr.js — QR 코드 생성 및 스캔 유틸리티
// ============================================================

const QRUtil = (() => {
  let scannerInstance = null;

  const getQRKey = (item) => item?.qrCode || item?.id || '';
  const addParam = (url, key, value) => {
    const text = String(value || '').trim();
    if (text) url.searchParams.set(key, text);
  };

  const buildAppLink = (qrValue, page = 'scan') => {
    const isItem = qrValue && typeof qrValue === 'object';
    const value = isItem ? getQRKey(qrValue) : String(qrValue || '').trim();
    if (!value) return '';
    try {
      const url = new URL('index.html', window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('page', page);
      url.searchParams.set('id', value);
      url.searchParams.set('v', 'phonesync');
      if (isItem) {
        addParam(url, 'rid', qrValue.id);
        addParam(url, 'pre', qrValue.preRegId);
        addParam(url, 'm', qrValue.materialCode);
        addParam(url, 'w', qrValue.expectedWeight);
        addParam(url, 'dt', qrValue.receivedDate);
        addParam(url, 'lot', qrValue.lotNo);
        addParam(url, 'f', qrValue.factory);
        addParam(url, 'st', qrValue.status);
        addParam(url, 'sup', qrValue.supplierCode || qrValue.supplierId);
        addParam(url, 'veh', qrValue.vehicleNo);
      }
      return url.toString();
    } catch (_) {
      return value;
    }
  };

  // ──────────────────────────────────────────────
  // QR 코드 생성
  // ──────────────────────────────────────────────
  const generate = (containerId, text, options = {}) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    new QRCode(container, {
      text,
      width: options.size || 200,
      height: options.size || 200,
      colorDark: options.dark || '#0f172a',
      colorLight: options.light || '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
  };

  // QR 이미지를 다운로드 / 인쇄용 데이터 URL 반환
  const getDataURL = (containerId) => {
    const canvas = document.querySelector(`#${containerId} canvas`);
    return canvas ? canvas.toDataURL('image/png') : null;
  };

  // QR 라벨 인쇄 창 열기
  const printLabel = (receiving) => {
    const qrKey = getQRKey(receiving);
    const scanUrl = buildAppLink(receiving, 'scan');
    const tempDiv = document.createElement('div');
    tempDiv.id = '_qr_print_tmp';
    tempDiv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
    document.body.appendChild(tempDiv);

    new QRCode(tempDiv, {
      text: scanUrl || qrKey,
      width: 248,
      height: 248,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });

    setTimeout(() => {
      const canvas = tempDiv.querySelector('canvas');
      const imgSrc = canvas ? canvas.toDataURL('image/png') : '';
      const receivedDate = receiving.receivedDate || '';
      const supplierName = receiving.supplierName || receiving.supplier || '-';
      const factoryName = receiving.factoryName || DB.getFactoryName?.(receiving.factory) || receiving.factory || '-';
      const factoryCode = receiving.factoryLotCode || DB.getFactoryLotCode?.(receiving.factory) || '-';
      const win = window.open('', '_blank', 'width=400,height=500');
      win.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>QR 라벨</title>
          <style>
            body { font-family: 'Malgun Gothic', sans-serif; margin: 0; padding: 16px; }
            .label { border: 2px solid #000; padding: 12px; width: 320px; text-align: center; }
            .label img { width: 248px; height: 248px; }
            .label h2 { font-size: 14px; margin: 6px 0 2px; }
            .label .code { font-size: 12px; color: #555; }
            .label .info { font-size: 11px; margin: 4px 0; text-align: left; border-top: 1px solid #ccc; padding-top: 6px; }
            .label .info span { display: block; }
            @media print { body { margin: 0; } }
          </style>
        </head>
        <body onload="window.print()">
          <div class="label">
            <img src="${imgSrc}" alt="QR">
            <h2>${receiving.materialName || ''}</h2>
            <div class="code">원료코드: ${receiving.materialCode || ''}</div>
            <div class="info">
              <span>입고예정번호: ${receiving.preRegId || receiving.id}</span>
              <span>QR키: ${qrKey}</span>
              <span>앱링크: ${scanUrl || '-'}</span>
              <span>협력사: ${supplierName}</span>
              <span>입고공장: ${factoryName} (${factoryCode})</span>
              <span>납품예정일: ${receivedDate}</span>
              <span>예상중량: ${receiving.expectedWeight || 0} kg</span>
              <span>LOT: ${receiving.lotNo || '-'}</span>
              <span>제조일: ${receiving.manufactureDate || '-'}</span>
              <span>소비기한: ${receiving.expiryDate || '-'}</span>
            </div>
          </div>
        </body>
        </html>
      `);
      win.document.close();
      document.body.removeChild(tempDiv);
    }, 300);
  };

  // ──────────────────────────────────────────────
  // QR 스캔 (웹캠)
  // ──────────────────────────────────────────────
  const isLocalhost = () => ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

  const getCameraBlockReason = () => {
    const ua = navigator.userAgent || '';
    const isKakao = /KAKAOTALK/i.test(ua);
    if (typeof Html5Qrcode === 'undefined') {
      return 'QR 스캔 라이브러리를 불러오지 못했습니다. 인터넷 연결 또는 CDN 접근을 확인하세요.';
    }
    if (location.protocol === 'http:' && !isLocalhost()) {
      return isKakao
        ? '카카오톡 브라우저와 HTTP 내부주소에서는 실시간 카메라가 막힐 수 있습니다. Chrome/Samsung Internet으로 열거나 아래 "사진으로 QR 읽기"를 사용하세요.'
        : 'HTTP 내부주소에서는 휴대폰 브라우저가 실시간 카메라를 차단할 수 있습니다. HTTPS 주소로 접속하거나 아래 "사진으로 QR 읽기"를 사용하세요.';
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return isKakao
        ? '카카오톡 인앱 브라우저는 실시간 카메라 스캔을 지원하지 않을 수 있습니다. Chrome/Samsung Internet으로 열거나 사진으로 QR 읽기를 사용하세요.'
        : '현재 브라우저가 실시간 카메라 스캔을 지원하지 않습니다. 다른 브라우저 또는 사진으로 QR 읽기를 사용하세요.';
    }
    return '';
  };

  const startScan = (elementId, onSuccess, onError) => {
    if (scannerInstance) {
      stopScan();
    }

    const el = document.getElementById(elementId);
    if (!el) return;

    const blockReason = getCameraBlockReason();
    if (blockReason) {
      if (onError) onError(blockReason);
      return;
    }

    // html5-qrcode 라이브러리 사용
    scannerInstance = new Html5Qrcode(elementId);
    scannerInstance.start(
      { facingMode: 'environment' },  // 후면 카메라 우선
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        onSuccess(decodedText);
      },
      (errorMessage) => {
        // 스캔 중 프레임 오류는 무시
      }
    ).catch(err => {
      if (onError) onError(err);
    });
  };

  const stopScan = () => {
    if (scannerInstance) {
      scannerInstance.stop().catch(() => {});
      scannerInstance = null;
    }
  };

  const isScanActive = () => !!scannerInstance;

  const scanImageFile = async (file) => {
    if (!file) throw new Error('QR 사진 파일이 선택되지 않았습니다.');
    if (typeof Html5Qrcode === 'undefined') {
      throw new Error('QR 스캔 라이브러리를 불러오지 못했습니다.');
    }
    if (scannerInstance) stopScan();

    const readerId = '_qr-file-reader';
    let holder = document.getElementById(readerId);
    if (!holder) {
      holder = document.createElement('div');
      holder.id = readerId;
      holder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;';
      document.body.appendChild(holder);
    }

    const fileScanner = new Html5Qrcode(readerId);
    try {
      return await fileScanner.scanFile(file, false);
    } finally {
      try { await fileScanner.clear(); } catch (_) {}
    }
  };

  // 수동 코드 입력으로 처리 (스캔 대체)
  const processManualInput = (code) => {
    return code ? code.trim().toUpperCase() : null;
  };

  return { generate, getDataURL, printLabel, startScan, stopScan, isScanActive, scanImageFile, processManualInput, buildAppLink, getCameraBlockReason };
})();
