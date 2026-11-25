'use strict';
document.getElementById('allowPair').onclick=()=>{
  if(!window.opener){document.getElementById('pairStatus').textContent='대시보드의 PC 연결 버튼에서 열어 주세요.';return;}
  window.opener.postMessage({type:'signal-tester-pair',base:location.origin,token:document.querySelector('meta[name="tester-token"]').content},'https://dashboard.3dowon.com');
  document.getElementById('pairStatus').textContent='연결 정보를 전달했습니다. 이 창은 닫아도 됩니다.';
  window.close();
};
