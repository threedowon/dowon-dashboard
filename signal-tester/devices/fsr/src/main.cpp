#include <Arduino.h>
#include <cstring>
#include <cstdio>

// ESP32-S3 ADC1 pins. Header GPIO numbers, NOT physical header positions.
// 3V3 -> FSR -> GPIO junction -> individual 10k resistor -> GND.
// Never feed the ADC from 5V. Four independent divider circuits.
constexpr uint8_t COUNT = 4;
constexpr uint8_t PINS[COUNT] = {1, 2, 4, 5};
constexpr uint32_t SAMPLE_MS = 20;
constexpr uint32_t REPORT_MS = 100;
constexpr uint16_t CAL_SAMPLES = 100;
constexpr int CAL_MAX_BASE = 900;
constexpr int CAL_MAX_SPREAD = 30;
constexpr int SATURATION_LEVEL = 1018;

int raw[COUNT] = {};
int base[COUNT] = {};
int delta[COUNT] = {};
int onDelta[COUNT] = {60, 60, 60, 60};
int offDelta[COUNT] = {30, 30, 30, 30};
bool pressed[COUNT] = {};
bool ready = false, calibrating = false;
uint8_t errorCode = 0, commandError = 0, saturationMask = 0;
uint16_t calCount = 0;
long calSum[COUNT] = {};
int calMin[COUNT] = {}, calMax[COUNT] = {};
uint32_t lastSample = 0, lastReport = 0;
char command[40] = {};
uint8_t commandLength = 0;
bool commandOverflow = false;

int readAverage(uint8_t pin) {
  analogRead(pin); // Discard the first conversion after switching channels.
  long sum = 0;
  for (uint8_t i = 0; i < 8; ++i) sum += analogRead(pin);
  return static_cast<int>(sum / 8);
}

void clearDetection() {
  for (uint8_t i = 0; i < COUNT; ++i) {
    delta[i] = 0;
    pressed[i] = false;
  }
}

void startCalibration() {
  ready = false;
  calibrating = true;
  errorCode = 0;
  calCount = 0;
  clearDetection();
  for (uint8_t i = 0; i < COUNT; ++i) {
    calSum[i] = 0;
    calMin[i] = 1023;
    calMax[i] = 0;
  }
}

void processCommand() {
  command[commandLength] = '\0';
  if (commandOverflow) {
    commandError = 1;
  } else if (commandLength) {
    int channel = 0, on = 0, off = 0;
    char extra = '\0';
    if (!strcmp(command, "c") || !strcmp(command, "C")) {
      commandError = 0;
      startCalibration();
    } else if (sscanf(command, "t %d %d %d %c", &channel, &on, &off, &extra) == 3 &&
               channel >= 1 && channel <= COUNT && off >= 0 && off < on && on <= 1023) {
      onDelta[channel - 1] = on;
      offDelta[channel - 1] = off;
      // A changed threshold should be evaluated from the released state.
      pressed[channel - 1] = false;
      commandError = 0;
    } else {
      commandError = 1;
    }
  }
  commandLength = 0;
  commandOverflow = false;
}

void receiveCommands() {
  // Bound processing so malformed/continuous input cannot starve sampling.
  for (uint8_t n = 0; n < 64 && Serial.available(); ++n) {
    const char ch = static_cast<char>(Serial.read());
    if (ch == '\r' || ch == '\n') {
      processCommand();
    } else if (ch < 32 || ch > 126) {
      commandOverflow = true;
    } else if (!commandOverflow) {
      if (commandLength < sizeof(command) - 1) command[commandLength++] = ch;
      else commandOverflow = true;
    }
  }
}

void sampleSensors() {
  saturationMask = 0;
  for (uint8_t i = 0; i < COUNT; ++i) {
    raw[i] = readAverage(PINS[i]);
    if (raw[i] >= SATURATION_LEVEL) saturationMask |= (1 << i);
  }

  if (calibrating) {
    for (uint8_t i = 0; i < COUNT; ++i) {
      calSum[i] += raw[i];
      if (raw[i] < calMin[i]) calMin[i] = raw[i];
      if (raw[i] > calMax[i]) calMax[i] = raw[i];
    }
    if (++calCount >= CAL_SAMPLES) {
      for (uint8_t i = 0; i < COUNT; ++i) {
        base[i] = static_cast<int>(calSum[i] / CAL_SAMPLES);
        if (base[i] >= CAL_MAX_BASE) errorCode |= 1;
        if (calMax[i] - calMin[i] > CAL_MAX_SPREAD) errorCode |= 2;
      }
      calibrating = false;
      ready = errorCode == 0;
    }
    clearDetection();
    return;
  }

  if (!ready) {
    clearDetection();
    return;
  }
  for (uint8_t i = 0; i < COUNT; ++i) {
    delta[i] = raw[i] - base[i];
    if (!pressed[i] && delta[i] >= onDelta[i]) pressed[i] = true;
    else if (pressed[i] && delta[i] <= offDelta[i]) pressed[i] = false;
  }
}

void emitReading() {
  bool detected = false;
  for (uint8_t i = 0; i < COUNT; ++i) detected |= pressed[i];
  Serial.print(F("{\"ready\":")); Serial.print(ready ? 1 : 0);
  Serial.print(F(",\"calibrating\":")); Serial.print(calibrating ? 1 : 0);
  Serial.print(F(",\"detected\":")); Serial.print(ready && detected ? 1 : 0);
  Serial.print(F(",\"error\":")); Serial.print(errorCode);
  Serial.print(F(",\"command_error\":")); Serial.print(commandError);
  Serial.print(F(",\"saturated_mask\":")); Serial.print(saturationMask);
  Serial.print(F(",\"cal_samples\":")); Serial.print(calCount);
  for (uint8_t i = 0; i < COUNT; ++i) {
    Serial.print(F(",\"raw")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(raw[i]);
    Serial.print(F(",\"base")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(base[i]);
    Serial.print(F(",\"delta")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(delta[i]);
    Serial.print(F(",\"pressed")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(ready && pressed[i] ? 1 : 0);
    Serial.print(F(",\"on")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(onDelta[i]);
    Serial.print(F(",\"off")); Serial.print(i + 1); Serial.print(F("\":")); Serial.print(offDelta[i]);
  }
  Serial.println('}');
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(10); // Common 0..1023 display scale; not a kg measurement.
  for (uint8_t i = 0; i < COUNT; ++i) {
    pinMode(PINS[i], INPUT);
    analogSetPinAttenuation(PINS[i], ADC_11db);
  }
  // Deliberately no automatic zeroing on boot/reconnect: the rug may be loaded.
  // Send c + LF with only the assembled top plate and rug in place.
}

void loop() {
  receiveCommands();
  const uint32_t now = millis();
  if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    sampleSensors();
  }
  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    emitReading();
  }
  delay(1);
}
