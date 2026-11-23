# 센서 펌웨어

처음 센서 코드를 작성한다면 [Arduino와 ESP32 센서 코드 작성 가이드](CODE-GUIDE.md)를 참고하세요. 복사해서 시험할 수 있는 숫자·JSON 전송 코드와 Signal Tester의 센서/자동 규칙 설정을 함께 설명합니다.

화면 실행은 상위 폴더의 `Start-Signal-Tester.cmd` 하나를 사용합니다. 센서 대시보드에서 등록한 센서를 확인하세요. 새 모니터는 Add sensor로 추가합니다.

| 연결할 센서 | PlatformIO에서 열 폴더 | 배선/사용법 |
| --- | --- | --- |
| FSR 4개 | `fsr` | [FSR 안내](fsr/README.md) |
| SEN0610 1대 | `sen0610` | [SEN0610 안내](sen0610/README.md) |

두 프로젝트는 ESP32-S3용이며 각각 독립적인 펌웨어입니다. 같은 보드에 하나를 업로드하면 이전 프로그램을 교체합니다. 동시 측정에는 보드 2대가 필요합니다. 기존 CH343 USB-UART 연결, 4MB 파티션, DIO 설정을 유지했습니다. 정확한 보드 모델/핀 위치는 실제 제품과 확인하세요.

1. VS Code / PlatformIO에서 해당 센서 폴더를 엽니다.
2. Signal Tester에서 업로드할 보드의 Serial 연결을 닫습니다.
3. Build 후 실제 USB COM 포트를 선택해 Upload합니다. 필요한 경우 BOOT 버튼을 사용합니다.
4. Serial Monitor를 닫고 공통 Signal Tester에서 해당 연결을 엽니다.

기존 `Tool/SEN0610-Tester`, `Tool/FSR-Tester`는 호환용으로 남겨 두었으며, 앞으로 이 `devices` 폴더의 소스를 기준으로 사용하세요. 기존 `.local.json` 설정은 자동으로 수정하지 않습니다.
