# Signal Tester — Dashboard bridge

센서·장비 → PC의 Python 통신 프로그램 → 대시보드 화면.

Serial, UDP 송수신과 숫자/JSON 센서 그래프, HTTP Signal, 자동 규칙은 기존 Signal Tester를 사용합니다. 브라우저에서 USB에 직접 연결하지 않으므로 UDP도 같은 화면에서 사용할 수 있습니다. OSC는 현재 원본 UDP 바이트를 Text/HEX로 확인할 수 있지만 주소/타입/인자 디코딩, bundle 시간 처리, OSC 전송 폼은 아직 없습니다.

## 시작

1. 저장소 ZIP을 다운로드하고 압축을 풉니다.
2. Python 3.10 이상을 설치합니다. Serial 사용 시 같은 Python에 `python -m pip install pyserial`을 실행합니다.
3. Windows: 이 폴더의 `Start-Signal-Tester.cmd`를 실행합니다. macOS/Linux: `python3 signal_tester.py --dashboard`.
4. 자동으로 열리는 https://dashboard.3dowon.com/#signaltester 에 콘솔의 `포트:연결코드`를 붙여 넣습니다. 프로그램을 재시작하면 코드가 바뀝니다.
5. 브라우저가 로컬 네트워크 접근 권한을 요청하면 허용합니다. 브라우저/조직 정책이 연결을 차단하면 콘솔의 `http://127.0.0.1:포트/` 또는 페이지의 **PC에서 직접 열기**를 사용합니다.
6. Serial 또는 UDP 연결을 추가하고 **Open connection**, 센서 모니터를 추가합니다. 자동 규칙은 필요할 때만 켜세요. 센서 없이 UDP 왕복 테스트를 하려면 Local/Remote IP를 `127.0.0.1`, 포트를 같은 빈 번호로 설정하세요.

프로그램 콘솔을 열어 두세요. 대시보드 탭을 닫아도 Python의 수신·자동 규칙은 계속됩니다. **화면 연결 해제**는 화면만 해제합니다. 종료는 콘솔에서 Ctrl+C입니다. 같은 COM 포트를 기존 Tester/Serial Monitor와 동시에 열 수 없습니다.

## 설정과 데이터

- 대시보드 모드는 `%LOCALAPPDATA%/SignalTester/dashboard-workspace.json`에 설정을 저장합니다. 기존 `workspace.json`과 분리되어 있습니다. 기존 설정은 Export → Import로 옮기세요. `--config`로 다른 파일을 지정할 수도 있습니다.
- 연결 코드는 탭의 sessionStorage에만 저장하며 URL, GitHub, 클라우드 백업에는 넣지 않습니다. 센서 데이터도 클라우드로 전송하지 않습니다.
- HTTP API는 loopback에만 바인딩합니다. 대시보드 모드에서만 정확히 `https://dashboard.3dowon.com`의 CORS 요청을 허용하며, API는 매 실행 새로 생성한 토큰을 요구합니다. 임의 Origin이나 잘못된 Host는 거부합니다. 원격 PC를 제어하는 기능은 없습니다.
- 로컬 실행 `python signal_tester.py`는 대시보드 접근을 허용하지 않고 기존 로컬 화면을 엽니다.
- 전체 기능과 센서 펌웨어 안내: [로컬 Tester 설명서](LOCAL-TESTER.md), [devices](devices/README.md).

## 개발·검증

저장소 루트: `npm test`. 이 폴더: `python -m unittest discover -v`.
실제 Serial 장치는 별도 하드웨어 검증이 필요합니다. 정적 화면을 임의 localhost Origin에서 열면 bridge CORS가 거부합니다. 로컬 기능은 Python이 제공하는 화면으로 검증할 수 있습니다.

OSC 확장 시 UDP transport 위에 별도의 디코더/인코더를 추가하고, 주소별 숫자 인자를 기존 센서 모니터로 전달하는 구조를 권장합니다. raw 데이터와 수신 시각은 유지하며 malformed packet과 bundle 크기/깊이를 제한해야 합니다.
