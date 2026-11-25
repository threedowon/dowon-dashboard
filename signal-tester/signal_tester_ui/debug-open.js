document.getElementById('openDebug').onclick = safe(async () => {
  if (window.pywebview?.api?.open_debug) {
    if (!await window.pywebview.api.open_debug()) toast('프로그램이 종료 중입니다.', true);
    return;
  }
  let url = new URL('debug.html', location.href).href;
  if (token === '__TESTER_TOKEN__') {
    const pairing = JSON.parse(sessionStorage.getItem('dowon-signal-pairing') || 'null');
    if (!pairing || !/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(pairing.base)) throw Error('먼저 PC 프로그램을 연결해 주세요.');
    url = new URL('debug.html', location.href).href;
  }
  const popup = window.open(url, 'signal-tester-debug', 'width=1200,height=820');
  if (!popup) toast('브라우저의 팝업 허용 후 다시 눌러 주세요.', true);
});
