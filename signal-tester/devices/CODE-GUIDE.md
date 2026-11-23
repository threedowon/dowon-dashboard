# Arduino와 ESP32 센서 코드 작성 가이드

센서 보드에서 읽은 값을 USB Serial로 보내고, Signal Tester에서 그래프와 자동 Signal 규칙으로 사용하는 방법입니다. **코드는 Arduino IDE 또는 PlatformIO에서 작성해 보드에 업로드합니다.** Signal Tester에서는 연결·데이터 형식·조건을 설정합니다.

```text
센서 → Arduino / ESP32의 코드 → USB Serial → Signal Tester → HTTP Signal → Player
```

처음에는 실제 센서 없이 아래 숫자 예제로 통신부터 확인하세요. 이 문서는 Signal Tester v1.2.0의 수신 형식을 기준으로 합니다.

## 1. 코드를 작성하고 업로드할 위치

| 사용하는 도구 | 코드를 넣을 곳 | 업로드 준비 |
| --- | --- | --- |
| Arduino IDE | 새 스케치의 `.ino` 파일 | 실제 보드 모델과 USB 포트 선택 |
| VS Code와 PlatformIO | 프로젝트의 `src/main.cpp` | 해당 보드의 `platformio.ini` 사용 |
| 이 저장소의 FSR 프로젝트 | [fsr/src/main.cpp](fsr/src/main.cpp) | [FSR 배선과 보정](fsr/README.md) 확인 |
| 이 저장소의 SEN0610 프로젝트 | [sen0610/src/main.cpp](sen0610/src/main.cpp) | [SEN0610 배선과 설정](sen0610/README.md) 확인 |

아래 예제는 **각각 별개의 전체 프로그램**입니다. 하나씩 사용하세요. 기존 센서 펌웨어에 추가할 때는 `setup()`과 `loop()`를 중복으로 붙이지 않고 필요한 내용을 기존 함수에 합칩니다. 예제를 보드에 업로드하면 기존 펌웨어가 교체되므로 기존 프로젝트를 보관하세요.

업로드 전 Signal Tester에서 해당 보드의 **Close connection**을 누릅니다. 업로드가 끝나면 Arduino IDE나 PlatformIO의 Serial Monitor를 닫고, Signal Tester에서 다시 연결합니다.

## 2. 센서 없이 숫자 하나 보내기

다음 코드는 0부터 100까지의 시험값을 100ms마다 보냅니다. 센서 라이브러리나 배선이 필요 없습니다.

```cpp
#include <Arduino.h>

int value = 0;

void setup() {
  Serial.begin(115200);
}

void loop() {
  Serial.println(value);
  value = (value + 1) % 101;
  delay(100);
}
```

보드가 보내는 데이터는 다음과 같습니다. 각 숫자 뒤에는 줄바꿈이 있습니다.

```text
0
1
2
3
```

Signal Tester에서 다음 순서로 설정합니다.

1. **COM ports → Use port** 또는 **Add connection → Serial**로 보드를 등록합니다.
2. 실제 COM 포트, **115200 baud / 8 bits / None parity / 1 stop bit**를 설정합니다.
3. **Open connection**을 누르고 **Latest received data → Text**에서 숫자가 들어오는지 확인합니다.
4. **Sensors → Add sensor**에서 **Receive from**을 방금 만든 Serial 연결로 선택합니다.
5. **Message format = Number**, **Display unit = count**, **Data timeout = 2초**로 저장합니다.

0에서 100까지 올라가다 다시 0이 되는 그래프가 보이면 기본 연결이 된 것입니다. `count`는 표시 이름이며 단위 변환을 하지 않습니다.

`Serial.print(value)`만 사용하면 줄바꿈이 없어 센서 메시지가 완성되지 않습니다. 숫자 하나를 보낼 때는 `Serial.println(value)`를 사용하세요. Raw data에는 문자가 보이는데 그래프가 안 뜬다면 줄바꿈부터 확인하세요.

## 3. 여러 값을 JSON 한 줄로 보내기

여러 센서값이나 상태를 보낼 때는 이름이 붙은 JSON을 사용합니다. 다음은 실제 센서 대신 가상 거리가 바뀌는 예제입니다. 별도 JSON 라이브러리는 필요 없습니다.

```cpp
#include <Arduino.h>

int distanceCm = 50;

void setup() {
  Serial.begin(115200);
}

void loop() {
  const bool ready = true;
  const bool detected = ready && distanceCm >= 30 && distanceCm <= 100;

  Serial.print("{\"distance\":");
  Serial.print(distanceCm);
  Serial.print(",\"detected\":");
  Serial.print(detected ? 1 : 0);
  Serial.print(",\"ready\":");
  Serial.print(ready ? 1 : 0);
  Serial.println("}");

  distanceCm += 5;
  if (distanceCm > 150) distanceCm = 50;
  delay(100);
}
```

한 번의 출력 예시는 다음과 같습니다.

```json
{"distance":50,"detected":1,"ready":1}
```

화면에서 각각 보고 싶은 값마다 **Add sensor**로 모니터를 추가합니다. 같은 Serial 연결을 여러 모니터의 수신 대상으로 선택할 수 있습니다.

| 모니터 이름 예시 | Message format | JSON field path | Display unit |
| --- | --- | --- | --- |
| 거리 | JSON field | `distance` | `cm` |
| 감지 상태 | JSON field | `detected` | 비워 두기 |
| 준비 상태 | JSON field | `ready` | 비워 두기 |

**JSON field path에는 `distance`만 입력합니다.** `{"distance":50}` 전체나 `"distance"`처럼 따옴표를 넣지 않습니다. 필드 이름은 대소문자를 구분합니다. 중첩 JSON은 `sensor.distance`, 배열의 첫 값은 `values.0`처럼 지정할 수 있습니다.

실제 센서를 붙일 때는 `distanceCm`을 센서 라이브러리에서 읽은 값으로 바꾸고, 마지막의 가상값 증가 부분을 제거합니다. 센서 초기화·읽기 성공 여부로 `ready`를 결정하세요. `ready = true`는 이 가상값 예제에서만 사용하는 값입니다.

## 4. 실제 아날로그 센서값 보내기

다음은 이 저장소의 FSR 프로젝트와 같은 **ESP32-S3의 GPIO1**에서 원본 ADC값을 읽는 최소 예제입니다. 해당 보드와 [FSR의 3.3V 분압 배선](fsr/README.md)을 기준으로 합니다. 다른 ESP32나 Arduino 보드는 지원하는 ADC 핀과 입력 전압을 확인해야 하며, GPIO1을 그대로 적용하면 안 됩니다.

```cpp
#include <Arduino.h>

constexpr uint8_t SENSOR_PIN = 1; // ESP32-S3의 GPIO 번호

void setup() {
  Serial.begin(115200);
  analogReadResolution(10); // 이 예제에서는 0~1023 범위
  pinMode(SENSOR_PIN, INPUT);
  analogSetPinAttenuation(SENSOR_PIN, ADC_11db);
}

void loop() {
  const int raw = analogRead(SENSOR_PIN);
  Serial.print("{\"raw\":");
  Serial.print(raw);
  Serial.println("}");
  delay(100);
}
```

Signal Tester에서는 **JSON field / 경로 `raw` / 단위 `ADC`**로 설정합니다. 이 값은 압력·무게·kg으로 환산된 값이 아닙니다. 최소 예제에는 기준값 보정이나 흔들림 처리가 없으므로, FSR 4개를 실제로 사용할 때는 기존 [FSR 펌웨어](fsr/src/main.cpp)를 사용하세요.

Arduino UNO처럼 다른 보드에서는 ADC 핀과 초기화 코드가 다릅니다. 특히 `analogReadResolution()`과 `analogSetPinAttenuation()`을 이 예제 그대로 복사하지 마세요. 센서를 읽는 부분은 보드에 맞게 바꾸되, JSON을 출력하는 부분과 Signal Tester 설정은 같은 방식으로 사용할 수 있습니다.

## 5. 감지했을 때 Player로 Signal 보내기

보드가 `{"detected":1}`을 보낸다고 Player에 바로 신호가 가는 것은 아닙니다. Signal Tester에서 이 숫자를 받는 모니터와 자동 규칙을 연결합니다.

1. **Add connection → HTTP Signal**로 Player의 IP와 포트를 저장하고 **Check**으로 확인합니다. 같은 PC면 IP는 `127.0.0.1`입니다.
2. **Add signal**로 키 `person`을 만듭니다. Player 프로젝트에도 동일한 키가 있어야 합니다.
3. **Sensors → Add sensor**에서 보드의 Serial 연결, **JSON field**, 경로 **`detected`**를 선택합니다.
4. **Add rule**에서 아래 값을 설정하고 **Save sensor**를 누릅니다.

| 항목 | 처음 사용할 값 | 의미 |
| --- | --- | --- |
| When value is | Above (>) | 기준보다 클 때 감지 |
| Threshold | `0.5` | 1은 감지, 0은 해제 |
| Send Signal | `person` | Player에 보낼 키 |
| To Player | 위에서 등록한 Player | 규칙의 실제 전송 대상 |
| Hold | `1` | 감지값이 1초 동안 연속 수신되어야 전송 |
| Repeat | `0` | 감지 상태가 유지되는 동안 한 번 전송 |
| Reset margin | `0` | 0이 들어오면 다음 감지를 준비 |
| Signal value | Sensor reading | 감지값 1을 함께 전송 |

5. 그래프에서 0과 1이 바뀌는지 확인한 뒤 **Enable all rules**를 누릅니다. 검증할 때는 가상값 예제와 실제 센서값을 구분하세요.

보드는 값이 같아도 계속 보내야 합니다. `Hold = 1`이면 최초 1이 들어온 뒤 1초 이상 지난 시점에도 조건을 만족하는 새 데이터가 필요합니다. **값이 바뀔 때만 보내는 코드는 Hold와 데이터 끊김 판정에 맞지 않습니다.**

Signal의 기본 **Cooldown은 3초**입니다. `Repeat = 1`로 바꾸어 약 1초마다 보내려면 Signal 편집창의 Cooldown도 함께 확인하세요. Repeat는 새로 수신한 값이 조건을 만족할 때 동작하며, 정밀한 1초 타이머는 아닙니다. 프로그램 재시작이나 규칙 수정 후에는 자동 규칙을 다시 켜야 합니다.

### 센서 오류를 감지로 오인하지 않기

거리 센서가 오류 시 `-1`을 보내는데 `distance < 100`만 조건으로 쓰면, 오류도 가까운 거리로 판정됩니다. 보드에서 **측정 성공 여부와 유효 범위를 함께 검사한 `detected` 또는 `near`를 0/1로 보내는 방식**을 사용하세요.

현재 규칙은 선택한 숫자 하나에 Below/Above를 적용합니다. `ready` 모니터를 따로 등록하는 것만으로 다른 거리 규칙이 자동 차단되지는 않습니다. 기존 SEN0610 펌웨어의 `near`, FSR 펌웨어의 `detected`는 오류·준비 상태를 반영하므로 해당 필드를 규칙에 연결하세요.

## 6. 반드시 맞춰야 하는 데이터 형식

| 보내는 내용 | 사용할 설정 또는 수정 방법 |
| --- | --- |
| `123.4` + 줄바꿈 | Number |
| `{"distance":123.4}` + 줄바꿈 | JSON field / `distance` |
| `{"distance":"123.4"}` | 문자열이므로 그래프용 숫자로 읽지 못함. 값의 따옴표 제거 |
| `{"detected":true}` | boolean은 그래프용 숫자가 아님. `1` 또는 `0`으로 출력 |
| `distance=123.4cm` | Number로 읽지 못함. 숫자만 보내거나 JSON으로 변경 |
| `{'distance':123.4}` | 잘못된 JSON. 필드 이름에 큰따옴표 사용 |
| 여러 줄로 꾸민 JSON | 한 줄에 JSON 전체를 출력하도록 변경 |
| `NaN`, `Infinity`, `null` | 센서의 유효 숫자로 처리되지 않음. 오류 상태는 별도 숫자 필드로 표시 |

한 메시지는 최대 4096바이트이며, 센서값 범위는 `-1e12`부터 `1e12`까지의 유한한 숫자입니다. 숫자 필드 이외의 문자열 메타데이터가 JSON에 함께 있어도 되지만, 그래프의 경로는 숫자 필드를 가리켜야 합니다.

측정용 Serial에는 `Serial.println("센서 연결 완료")` 같은 일반 로그를 섞지 않는 편이 좋습니다. 대신 같은 JSON에 `"ready":1`, `"error":0`처럼 상태를 넣으면 파싱 오류 없이 진단할 수 있습니다. 보드 부팅 로그가 일시적으로 섞인 경우에는 이후 정상 데이터가 들어오는지 확인하세요.

## 7. 전송 주기와 보드 설정

처음에는 위 예제처럼 **100ms마다 한 줄**을 보내고 Data timeout은 **2초**로 두면 확인하기 쉽습니다. 실제 주기는 센서의 측정 속도에 맞추고, timeout은 정상 전송 간격보다 여유 있게 설정합니다. SEN0610 기존 펌웨어는 250ms, FSR은 100ms마다 보고합니다.

예제의 `delay(100)`은 이해하기 쉬운 시험용 구조입니다. 명령 수신이나 여러 센서 처리를 함께 해야 한다면 기존 FSR 펌웨어처럼 `millis()`로 측정·전송 주기를 나누세요. 측정값이 바뀌지 않아도 정기 보고는 유지합니다.

이 저장소의 ESP32-S3 프로젝트는 **CH343 USB-UART와 UART0의 Serial 출력**을 사용하며 `ARDUINO_USB_CDC_ON_BOOT=0`으로 설정되어 있습니다. USB 커넥터나 보드 모델이 다르면 Serial 출력 경로도 달라질 수 있으므로, 이 설정을 모든 ESP32에 동일하게 적용하지 마세요.

UDP로 보내는 펌웨어도 숫자 또는 JSON 수신 형식은 같습니다. UDP는 한 패킷에 완성된 메시지를 담아야 하며, 여러 줄로 보낼 때도 각 줄이 완성된 메시지여야 합니다. 서로 다른 패킷으로 JSON을 나누면 조립되지 않습니다. 네트워크 설정은 [사용 설명서의 UDP 안내](../LOCAL-TESTER.md#udp-전송과-수신-대기)를 참고하세요.

## 8. 자주 막히는 부분

| 증상 | 먼저 확인할 것 |
| --- | --- |
| 업로드 실패 또는 COM 포트 사용 중 | Signal Tester의 연결과 다른 Serial Monitor를 닫았는지 |
| COM 포트는 열리지만 수신 없음 | 실제 보드 포트인지, 업로드가 끝났는지, Serial 출력이 연결한 USB 경로인지 |
| 글자가 깨짐 | 코드와 Tester의 baud rate가 같은지. Raw 기록은 메시지 단위와 다를 수 있음 |
| Raw data는 오지만 그래프가 없음 | 줄바꿈, Number/JSON 선택, 필드 이름, 숫자와 문자열 구분 |
| 여러 값이 한 그래프에 번갈아 나옴 | 숫자를 여러 줄로 보내고 있지 않은지. JSON의 서로 다른 필드로 구분 |
| 감지값 1인데 Signal이 안 감 | Enable all rules, To Player, Hold, 새 데이터 수신, Signal Cooldown |
| Signal이 전송됐는데 장면은 그대로 | Activity의 응답과 Player 프로젝트의 Signal 키·장면 조건 |
| 업데이트 후 보드 동작은 그대로 | EXE 업데이트와 보드 펌웨어 업로드는 별개 |

## 9. 무엇을 바꾸면 어디에 저장되는지

| 변경한 내용 | 저장 또는 적용 위치 |
| --- | --- |
| COM 포트, 센서 필드, 화면 규칙, Signal 키 | Signal Tester 설정. 계정 연결 시 설정 자동 백업 대상 |
| GPIO 핀, 센서 초기화, 보드의 감지 계산, JSON 출력 코드 | `.ino` 또는 `src/main.cpp`. 수정 후 보드에 다시 업로드 |
| FSR의 `c`, `t 1 80 40` 같은 Serial 명령 | 해당 펌웨어가 처리. 현재 FSR의 보정·임계값은 보드 리셋 시 초기화 |

**Signal Tester 자동 백업은 보드 소스코드와 보드 안의 펌웨어를 백업하지 않습니다.** `.ino` 또는 PlatformIO 프로젝트는 별도로 보관하세요. 새 필드 이름으로 코드를 바꾸면 Tester의 JSON field path도 맞춰야 합니다.

기존 센서 작업을 이어갈 때는 [FSR 안내](fsr/README.md)와 [SEN0610 안내](sen0610/README.md)를 기준으로 배선·보정·오류 코드를 확인하세요.
