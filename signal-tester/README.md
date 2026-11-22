# Signal Tester

Serial·UDP 송수신, 숫자/JSON 센서 그래프, HTTP Signal, 자동 규칙을 한 화면에서 사용합니다. 통신과 설정 저장은 이 PC에서 처리하며 측정값을 서버에 업로드하지 않습니다.

## Windows에서 시작

1. [SignalTester.exe 다운로드](https://github.com/threedowon/dowon-dashboard/releases/latest/download/SignalTester.exe).
2. 더블클릭하면 콘솔 없이 Signal Tester 전용 창이 열립니다. **Python 설치, 압축 해제, 연결 코드 입력이 필요 없습니다.** Windows 10/11 64비트용입니다.
3. Serial 또는 UDP 연결을 추가하고 **Open connection**을 누르세요. 센서 모니터와 자동 규칙은 필요할 때 추가합니다.

전용 창의 **프로그램 종료** 버튼 또는 창의 **×**를 누르면 Serial·UDP 연결과 자동 규칙까지 종료됩니다. 같은 COM 포트를 기존 Tester/Serial Monitor와 동시에 열 수 없습니다.

같은 EXE를 다시 실행하면 기존 프로그램의 Serial·UDP 연결을 정리하고 새 화면을 엽니다. 여러 번 실행해도 마지막 실행 하나만 남습니다. 재시작 후 연결은 닫힌 상태이며 자동 규칙도 일시 정지됩니다. 기존 전용 창도 닫히고 새 창이 열립니다. 다른 경로에 둔 EXE나 소스로 실행한 Tester는 종료하지 않습니다.

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

## 선택: 대시보드 안에 표시

기본 사용에는 필요 없습니다. 소스에서 `python signal_tester.py --dashboard`로 실행한 경우에만 `https://dashboard.3dowon.com/#signaltester`에서 **고급: 이 대시보드 안에서 화면 연결**을 펼쳐 콘솔의 연결 코드를 입력합니다. 재시작하면 코드가 바뀝니다. 브라우저가 로컬 네트워크 접근 권한을 요청하면 허용하세요.

이 모드에서만 정확히 `https://dashboard.3dowon.com`의 CORS 요청을 허용합니다. 연결 코드는 탭의 sessionStorage에만 저장합니다. **화면 연결 해제**는 수신·자동 규칙을 멈추지 않습니다. 다른 PC의 프로그램을 원격 제어하는 기능은 없습니다.

## 소스 실행·개발

Python 3.10 이상과 `pyserial`이 필요합니다. Windows에서는 `Start-Signal-Tester.cmd`를 실행하면 로컬 화면이 바로 열립니다. macOS/Linux에서는 `python3 signal_tester.py`를 실행하세요. 직접 Python으로 실행할 때의 기본 설정은 `workspace.json`이며, `--desktop` 옵션은 EXE와 같은 설정 파일을 사용합니다.

전용 창은 Windows의 Microsoft Edge WebView2 Runtime을 사용합니다. 미설치 PC에서는 [Microsoft WebView2](https://developer.microsoft.com/microsoft-edge/webview2/consumer/)를 설치하세요. 진단 로그는 `%LOCALAPPDATA%/SignalTester/logs`에 보관됩니다.

Windows EXE 빌드: `python signal-tester/build_windows.py`. 격리된 `.build-venv`에 고정 버전의 PyInstaller와 pyserial을 설치하고 UI·센서 프리셋과 함께 `signal-tester/dist/SignalTester.exe` 하나로 묶습니다. 배포할 때는 이 EXE만 복사합니다.

검증:

```powershell
npm test
$env:SIGNAL_TESTER_EXE = (Resolve-Path signal-tester/dist/SignalTester.exe).Path
& signal-tester/.build-venv/Scripts/python.exe -m unittest discover -s signal-tester -v
```

패키지 테스트는 임시 한글·공백 경로에 EXE만 복사하고 Python이 없는 PATH에서 실행해 UI·프리셋·Serial 모듈·UDP 왕복·인증·설정 보존·재시작·동시 실행을 검증합니다. 실제 Serial 장치는 별도 하드웨어 검증이 필요합니다.

`signal-tester-v*` 태그를 push하면 GitHub Actions가 Windows에서 빌드하고 전체 테스트를 통과한 EXE와 SHA256 체크섬을 GitHub Release에 게시합니다. 다운로드 버튼은 최신 Release의 EXE를 가리킵니다.
