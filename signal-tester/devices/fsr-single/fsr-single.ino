#include <Arduino.h>

constexpr uint8_t FSR_PIN = 4;
constexpr uint32_t SAMPLE_INTERVAL_MS = 10;
constexpr uint32_t SEND_INTERVAL_MS = 100;

// 작을수록 부드럽지만 반응이 느려집니다.
constexpr float FILTER_ALPHA = 0.2f;

uint32_t lastSampleMs = 0;
uint32_t lastSendMs = 0;

int rawValue = 0;
float filteredValue = 0;

void setup() {
  Serial.begin(115200);

  pinMode(FSR_PIN, INPUT);
  analogReadResolution(10);  // 0~1023
  analogSetPinAttenuation(FSR_PIN, ADC_11db);

  // 처음 읽은 값으로 필터 초기화
  rawValue = analogRead(FSR_PIN);
  filteredValue = rawValue;
}

void loop() {
  const uint32_t now = millis();

  // 10ms마다 측정 및 흔들림 완화
  if (now - lastSampleMs >= SAMPLE_INTERVAL_MS) {
    lastSampleMs = now;

    rawValue = analogRead(FSR_PIN);
    filteredValue += FILTER_ALPHA * (rawValue - filteredValue);
  }

  // 값이 같아도 100ms마다 계속 전송
  if (now - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = now;

    Serial.print("{\"raw\":");
    Serial.print(rawValue);
    Serial.print(",\"filtered\":");
    Serial.print(filteredValue, 1);
    Serial.println("}");
  }
}
