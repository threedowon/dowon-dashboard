Signal Tester v1.4.0 — 공통 센서 테스트 프로그램

- 대시보드와 DFESTA에서 같은 릴리스/웹 화면을 사용합니다. DFESTA의 기본 CMD는 공통 EXE를 설치·실행하며 Python이 필요 없습니다.
- DMX ENTTEC USB Pro 4개 조명 제어, VL53L0X 진단 필드 추가, 같은 센서의 그래프 겹쳐 보기, OSC 주소/값→Player Signal 매핑을 통합했습니다.
- JSON 자동 필드, OSC 주소별 모니터, 디버깅, 자동 백업과 업데이트 기능을 유지합니다.
- 기존 DFESTA workspace.json과 대시보드 dashboard-workspace.json은 덮어쓰거나 자동 병합하지 않습니다. DFESTA 런처는 기존 workspace.json을 우선 지정합니다.
- 재시작 후 장치 연결과 자동 규칙·OSC 매핑 수신은 정지 상태입니다. 필요한 항목만 다시 켜세요. OSC 매핑 수신과 UDP 주소 모니터에는 서로 다른 수신 포트를 사용하세요.
- 웹에서 PC 연결 → 연결 허용. 화면 수정은 새로고침으로 적용됩니다. 엔진 수정은 설정에서 업데이트합니다.
