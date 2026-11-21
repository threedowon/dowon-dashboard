Windows 10/11 64비트용 Signal Tester입니다.

1. 아래 **SignalTester.exe**를 다운로드합니다.
2. 더블클릭하면 테스트 화면이 브라우저에 자동으로 열립니다.
3. Serial 또는 UDP 연결을 추가하고 **Open connection**을 누르세요.

Python과 Serial 지원이 포함되어 있어 별도 설치, 압축 해제, 연결 코드 입력이 필요 없습니다. 사용 중에는 프로그램 콘솔을 열어 두세요. 종료는 콘솔에서 Ctrl+C입니다.

같은 파일을 다시 실행하면 기존 프로그램의 연결을 정리하고 새 화면을 엽니다. 설정은 `%LOCALAPPDATA%/SignalTester/dashboard-workspace.json`에 유지됩니다. 재시작 후 연결과 자동 규칙은 정지 상태로 시작합니다.

실제 장비의 COM 포트는 다른 프로그램에서 먼저 닫아 주세요. 측정값은 서버에 업로드하지 않습니다.
