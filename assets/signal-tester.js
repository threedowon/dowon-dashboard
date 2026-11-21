(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const key = 'dowon-signal-pairing';
  const readonly = document.documentElement.dataset.readonly === 'true';
  let generation = 0, restored = false;
  function parse(code) {
    const match = /^(\d{1,5}):([A-Za-z0-9_-]{43})$/.exec(code.trim());
    if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535) throw Error('콘솔에 표시된 포트:연결코드 전체를 붙여 넣으세요.');
    return {base: `http://127.0.0.1:${Number(match[1])}`, token: match[2]};
  }
  async function connect(pairing) {
    if (readonly) return;
    const run = ++generation;
    $('signalPairButton').disabled = true;
    $('signalPairStatus').textContent = '이 PC의 통신 프로그램을 확인하고 있어요…';
    const local = $('signalLocalLink'); local.href = pairing.base + '/'; local.hidden = false;
    // Remove the previous session before replacing its credentials.
    $('signalFrameHost').replaceChildren();
    try {
      sessionStorage.removeItem(key);
      const response = await fetch(pairing.base + '/api/state', {headers: {'X-Tester-Token': pairing.token}, signal: AbortSignal.timeout(10000)});
      if (run !== generation) return;
      if (!response.ok) throw Error('연결 코드가 만료됐거나 프로그램이 대시보드 모드로 실행되지 않았어요. 새 코드를 입력하세요.');
      const data = await response.json();
      if (run !== generation) return;
      if (!data.workspace || !Array.isArray(data.workspace.targets)) throw Error('지원하는 Signal Tester 프로그램인지 확인하세요.');
      sessionStorage.setItem(key, JSON.stringify(pairing));
      const frame = document.createElement('iframe');
      frame.title = 'Signal Tester — Serial·UDP 센서 디버깅';
      frame.src = 'signal-tester/signal_tester_ui/index.html';
      $('signalFrameHost').replaceChildren(frame);
      $('signalPairCode').value = '';
      $('signalPairStatus').textContent = 'PC 연결 확인 완료. 아래에서 연결을 추가하거나 센서 대시보드를 여세요. 프로그램을 재실행하면 새 연결 코드가 필요합니다.';
    } catch (error) {
      if (run !== generation) return;
      $('signalPairStatus').textContent = error instanceof TypeError || error.name === 'TimeoutError'
        ? '연결할 수 없어요. 프로그램 실행과 브라우저의 로컬 네트워크 권한을 확인하세요. 계속 차단되면 “PC에서 직접 열기”로 같은 기능을 사용할 수 있어요.'
        : error.message;
    } finally { if (run === generation) $('signalPairButton').disabled = false; }
  }
  $('signalPairForm').addEventListener('submit', event => {
    event.preventDefault();
    if (readonly) return;
    try { connect(parse($('signalPairCode').value)); } catch (error) { $('signalPairStatus').textContent = error.message; }
  });
  $('signalForget').onclick = () => {
    ++generation; sessionStorage.removeItem(key); $('signalFrameHost').replaceChildren();
    $('signalPairButton').disabled = false; $('signalPairCode').value = ''; $('signalLocalLink').hidden = true;
    $('signalPairStatus').textContent = '화면 연결을 해제했어요. PC 프로그램의 열린 연결과 자동 규칙은 계속됩니다.';
  };
  function restore() {
    if (readonly || restored || location.hash !== '#signaltester') return;
    restored = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (saved && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(saved.base)) connect(parse(saved.base.split(':').at(-1) + ':' + saved.token));
    } catch { sessionStorage.removeItem(key); }
  }
  if (readonly) $('signalPairStatus').textContent = '공유용 문서에서는 장치에 연결하지 않습니다. 실제 대시보드를 열어 주세요.';
  window.addEventListener('hashchange', restore);
  restore();
})();
