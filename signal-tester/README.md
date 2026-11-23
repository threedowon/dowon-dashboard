# Signal Tester

Serial·UDP 송수신, 숫자/JSON 센서 그래프, HTTP Signal, 자동 규칙을 한 화면에서 사용합니다. 통신과 설정 저장은 이 PC에서 처리하며 측정값을 서버에 업로드하지 않습니다.

## 웹 개발 모드로 시작

개발 중에는 **`Start-Web-Tester.cmd`**를 더블클릭하세요. 기존 `Start-Signal-Tester.cmd`도 웹 개발 모드를 실행합니다. Python 3.10 이상이 필요하며, 첫 실행 시 개발용 환경에 Serial 지원과 문서 생성 도구를 자동 준비합니다. 준비된 환경은 다음 실행에서도 사용합니다.

1. 실행 중인 EXE에서 **프로그램 종료**를 누릅니다. 같은 설정을 사용하는 EXE가 열려 있으면 웹 모드는 시작을 중단하고 종료를 안내합니다.
2. `Start-Web-Tester.cmd`를 실행합니다. 브라우저에 로컬 화면이 자동으로 열리며 연결 코드를 입력하지 않습니다. 콘솔에도 접속 주소가 표시됩니다.
3. 기존 COM 포트·Signal·센서·규칙과 백업 계정 연결을 그대로 불러옵니다. **연결과 자동 규칙은 정지 상태**이므로 사용할 연결을 열고 규칙을 켜세요.
4. HTML·CSS·JavaScript를 수정한 후 브라우저를 새로고침합니다. Python을 수정했다면 같은 CMD를 다시 실행하세요. 같은 소스 폴더의 기존 통신 프로그램을 종료하고 다시 시작합니다.
5. 종료는 화면의 **프로그램 종료** 또는 실행 콘솔의 Ctrl+C를 사용합니다. 브라우저 탭만 닫으면 통신과 자동 규칙은 계속 실행됩니다.

EXE와 동일한 `%LOCALAPPDATA%/SignalTester/dashboard-workspace.json`을 사용하며 백업 인증도 같은 Windows 사용자에서 그대로 재사용합니다. EXE로 돌아갈 때도 웹 프로그램을 먼저 종료하면 됩니다. 서로 다른 설정으로 시험하려면 `Start-Web-Tester.cmd --config C:\테스트\workspace.json`을 사용하세요.

| 수정할 부분 | 파일 | 확인 방법 |
| --- | --- | --- |
| 화면 구조 | `signal_tester_ui/index.html` | 브라우저 새로고침 |
| 화면 스타일 | `signal_tester_ui/style.css` | 브라우저 새로고침 |
| 화면 동작 | `signal_tester_ui/*.js` | 브라우저 새로고침 |
| 디버깅 화면 | `signal_tester_ui/debug.html`, `debug.js`, `debug.css` | 디버깅 브라우저 창 새로고침 |
| 통신과 센서 판정 | `signal_tester.py`, `tester_transports.py`, `tester_sensors.py` | CMD 다시 실행 |
| 내장 문서 원문 | `devices/CODE-GUIDE.md` 등 | CMD 다시 실행하여 문서 갱신 |

웹 개발 모드에서는 EXE 업데이트를 실행하지 않습니다. 화면은 소스 파일을 매 요청마다 읽고 캐시하지 않으므로 EXE를 빌드하지 않아도 수정 내용을 확인할 수 있습니다. 자동 새로고침은 하지 않으며, 폼 입력 중인 내용이 갑자기 초기화되지 않도록 직접 새로고침합니다.

명령줄 실행: `python tester_web_dev.py`. 이미 의존성이 준비된 환경에서는 `python tester_launcher.py --web-dev`로도 실행할 수 있습니다. `--no-browser`는 브라우저 자동 열기만 생략하며, `--ui-port`로 로컬 화면 포트를 지정할 수 있습니다. Windows 외 환경은 `python signal_tester.py --web-dev`로 실행하며 Windows DPAPI 기반 자동 백업은 제공하지 않습니다.

## 배포된 Windows EXE에서 시작

1. [SignalTester.exe 다운로드](https://github.com/threedowon/dowon-dashboard/releases/latest/download/SignalTester.exe).
2. 더블클릭하면 콘솔 없이 Signal Tester 전용 창이 열립니다. **Python 설치, 압축 해제, 연결 코드 입력이 필요 없습니다.** Windows 10/11 64비트용입니다.
3. Serial 또는 UDP 연결을 추가하고 **Open connection**을 누르세요. 센서 모니터와 자동 규칙은 필요할 때 추가합니다.

전용 창의 **프로그램 종료** 버튼 또는 창의 **×**를 누르면 Serial·UDP 연결과 자동 규칙까지 종료됩니다. 같은 COM 포트를 기존 Tester/Serial Monitor와 동시에 열 수 없습니다.

같은 EXE를 다시 실행하면 기존 프로그램의 Serial·UDP 연결을 정리하고 새 화면을 엽니다. 여러 번 실행해도 마지막 실행 하나만 남습니다. 재시작 후 연결은 닫힌 상태이며 자동 규칙도 일시 정지됩니다. 기존 전용 창도 닫히고 새 창이 열립니다. 다른 경로에 둔 EXE나 소스로 실행한 Tester는 종료하지 않습니다.

## 송수신 디버깅

왼쪽 **송수신 디버깅**을 누르면 본 화면 옆에 별도 창이 열립니다. `person`·`person_far`의 최근 전송 결과, Serial·UDP 수신 원문, 전송 값과 Player 응답을 확인할 수 있습니다. 키별 필터·검색·화면 일시정지·현재 목록 JSON 저장을 지원합니다.

- **Player 수신 확인**은 응답이 돌아왔다는 뜻입니다. 장면 전환, 조건 불일치, Player 쿨다운 등 처리 결과를 함께 표시합니다.
- **Player 수신 미확인**은 확인 응답이 없다는 뜻입니다. 특히 시간 초과는 실제 수신 여부를 확정할 수 없습니다.
- **보내지 않음 / Tester 쿨다운**은 네트워크 요청 전에 차단된 경우입니다.
- 최근 송수신 200건과 HTTP 결과 200건을 따로 유지하므로 센서 수신량이 많아도 Signal 기록을 볼 수 있습니다. 누적 횟수와 기록은 이번 실행에만 유지하며, 본 화면의 Activity 삭제 시 함께 초기화됩니다. 백업 서버로 전송하지 않습니다.
- 디버깅 창만 닫거나 화면을 일시정지해도 통신은 계속됩니다. 본 프로그램을 종료하면 디버깅 창도 닫힙니다. Python 브라우저 모드에서는 새 브라우저 창으로 열립니다.

이 창은 이 Tester의 센서 수신과 전송 결과를 보여줍니다. 다른 프로그램이 Player에 보낸 Signal은 수집하지 않습니다. RX 기록은 원본 바이트 조각이며 센서 메시지 한 줄과 다를 수 있습니다.

## 프로그램 업데이트

실행할 때 공식 GitHub Release의 새 버전을 자동 확인합니다. 새 버전이 있으면 상단의 **v… 업데이트** 버튼을 누르고 확인하세요. 다운로드와 SHA256 검증이 끝나면 통신을 종료하고 같은 위치의 EXE를 교체한 뒤 자동으로 다시 엽니다.

- 설정 파일, PC별 백업 식별자와 암호화된 계정 연결 정보는 그대로 유지합니다. 재실행 후 통신과 자동 규칙은 정지 상태입니다.
- 확인·다운로드 실패 시 기존 프로그램을 계속 사용할 수 있습니다. **업데이트 확인**으로 다시 시도할 수 있습니다.
- 새 EXE의 시작을 확인하지 못하면 이전 EXE로 되돌려 실행합니다. EXE가 있는 폴더에 쓰기 권한이 필요합니다.
- **v1.1.0 이하에는 이 기능이 없으므로 v1.2.0은 한 번 직접 다운로드해야 합니다.** 그다음 업데이트부터 프로그램 안에서 진행합니다.
- 업데이트 확인에는 GitHub 로그인이 필요 없습니다. 자동 다운로드·설치는 하지 않으며 버튼으로 승인한 버전만 설치합니다.

## 설정 자동 백업 · 다른 PC에서 불러오기

1. EXE 상단 **설정 자동 백업**을 누르고 이 PC 이름을 정합니다.
2. **대시보드 계정 연결**을 누르고 기본 브라우저에서 기존 GitHub 계정으로 로그인합니다. 로그인용 브라우저 탭은 완료 후 닫아도 됩니다.
3. 이후 설정 변경은 이 PC에 즉시 저장되고, 약 3초 뒤 비공개 `dowon-dashboard-data` 저장소에 자동 백업됩니다.
4. 다른 PC에서 EXE를 실행하고 같은 계정에 연결한 뒤 **백업 목록 새로고침 → 불러오기**를 누릅니다.

- PC마다 별도 백업을 유지합니다. 다른 PC의 설정은 자동으로 덮어쓰지 않습니다.
- 복원 전 현재 설정은 설정 파일 옆 `*.before-restore-*.json`에 보관합니다. 복원 후 모든 연결과 자동 규칙은 정지됩니다. COM 번호와 IP를 확인하고 연결하세요.
- 오프라인에서는 로컬 저장을 계속하고 30초 간격으로 백업을 재시도합니다. 종료 시에도 마지막 백업을 시도하며, 실패한 변경은 다음 실행에서 다시 백업합니다.
- 백업 충돌 시 자동 덮어쓰기를 멈춥니다. 저장된 백업을 불러오거나 **이 PC 설정으로 백업 갱신**을 선택할 수 있습니다. GitHub 커밋 기록에 이전 버전이 남습니다.
- 대시보드의 Signal Tester 페이지에서도 PC별 백업 목록과 설정 JSON 다운로드를 제공합니다.
- 백업 대상은 포트·Signal·센서·규칙 설정입니다. 측정값, 송수신 기록, 인증 정보는 설정 백업에 포함되지 않습니다.
- 로그인 자격 증명은 Windows 사용자별 DPAPI로 암호화합니다. 서버는 Signal Tester 백업 전용 권한만 허용하고 GitHub 토큰은 서버에서만 보관합니다. 연결 해제는 이 PC의 백업 인증을 폐기합니다.
- GitHub 로그인이 만료·취소되면 화면에서 재연결을 안내합니다. 로컬 작업은 계속 가능합니다.

## 설정과 데이터

- EXE와 Windows CMD의 설정은 `%LOCALAPPDATA%/SignalTester/dashboard-workspace.json`에 저장합니다. 기존 대시보드 모드의 설정을 그대로 사용합니다. 이전 로컬 `workspace.json`의 설정은 Export → Import로 옮길 수 있습니다. `--config`로 다른 파일을 지정할 수도 있습니다.
- 여러 화면에서 설정을 변경하면 먼저 저장한 변경을 보호합니다. 오래된 화면의 저장은 거부되고 최신 설정을 불러오므로, 내용을 확인한 뒤 변경을 다시 시도하세요.
- HTTP API는 `127.0.0.1`에만 바인딩하며 매 실행 새 토큰을 생성합니다. 자동으로 열린 로컬 화면에는 토큰이 제공되므로 직접 입력하지 않습니다. 외부 웹사이트의 API 접근은 기본으로 허용하지 않습니다.
- OSC는 원본 UDP 바이트를 Text/HEX로 확인할 수 있지만 주소·인자 디코딩이나 OSC 전송 폼은 아직 없습니다.
- 전체 기능과 센서 펌웨어 안내: [사용 설명서](LOCAL-TESTER.md), [devices](devices/README.md).
- Arduino·ESP32에서 데이터를 보내는 코드와 화면 설정 예제: [센서 코드 작성 가이드](devices/CODE-GUIDE.md). 프로그램의 **Guide → 센서 코드 작성 가이드**에서도 인터넷 없이 읽고 코드를 복사할 수 있습니다. FSR·SEN0610 배선 안내와 전체 소스도 포함합니다.

## 선택: 대시보드 안에 표시

기본 사용에는 필요 없습니다. 소스에서 `python signal_tester.py --dashboard`로 실행한 경우에만 `https://dashboard.3dowon.com/#signaltester`에서 **고급: 이 대시보드 안에서 화면 연결**을 펼쳐 콘솔의 연결 코드를 입력합니다. 재시작하면 코드가 바뀝니다. 브라우저가 로컬 네트워크 접근 권한을 요청하면 허용하세요.

이 모드에서만 정확히 `https://dashboard.3dowon.com`의 CORS 요청을 허용합니다. 연결 코드는 탭의 sessionStorage에만 저장합니다. **화면 연결 해제**는 수신·자동 규칙을 멈추지 않습니다. 다른 PC의 프로그램을 원격 제어하는 기능은 없습니다.

## 소스 실행·개발

웹 개발은 위의 **웹 개발 모드로 시작**을 참고하세요. 일반 소스 실행 `python signal_tester.py`의 기본 설정은 `workspace.json`이며, `--web-dev` 옵션은 EXE와 같은 설정과 Windows 백업 기능을 사용하는 브라우저 화면을 엽니다. `--desktop`은 이전 런처의 설정 경로 호환용 옵션입니다.

전용 창은 Windows의 Microsoft Edge WebView2 Runtime을 사용합니다. 미설치 PC에서는 [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/consumer/)를 설치하세요. 진단 로그는 `%LOCALAPPDATA%/SignalTester/logs`에 보관됩니다.

Windows EXE 빌드: `python signal-tester/build_windows.py`. 격리된 `.build-venv`에 고정 버전의 PyInstaller와 pyserial을 설치하고 UI·센서 프리셋과 함께 `signal-tester/dist/SignalTester.exe` 하나로 묶습니다. 배포할 때는 이 EXE만 복사합니다.

내장 문서는 `build_guide.py`가 Markdown 원문에서 생성합니다. 문서 수정 후 빌드용 환경의 Python으로 `signal-tester/build_guide.py`를 실행하고 생성된 `signal_tester_ui/code-guide.json`도 커밋하세요. EXE 빌드 시에도 자동 갱신되며, 사용자의 PC에는 문서 렌더링 라이브러리가 필요 없습니다.

검증:

```powershell
npm test
$env:SIGNAL_TESTER_EXE = (Resolve-Path signal-tester/dist/SignalTester.exe).Path
& signal-tester/.build-venv/Scripts/python.exe -m unittest discover -s signal-tester -v
```

패키지 테스트는 임시 한글·공백 경로에 EXE만 복사하고 Python이 없는 PATH에서 실행해 UI·프리셋·Serial 모듈·UDP 왕복·인증·설정 보존·재시작·동시 실행을 검증합니다. 실제 Serial 장치는 별도 하드웨어 검증이 필요합니다.

`tester_version.py`의 `VERSION`을 올리고 같은 `signal-tester-v<버전>` 태그를 push하면 GitHub Actions가 Windows에서 빌드하고 전체 테스트를 통과한 EXE와 SHA256 체크섬을 GitHub Release에 게시합니다. 다운로드 버튼은 최신 Release의 EXE를 가리킵니다.
