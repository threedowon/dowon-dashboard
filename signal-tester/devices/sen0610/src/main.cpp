#include <Arduino.h>
#include <Wire.h>
#include <DFRobot_C4001.h>

// ESP32-S3: use pins marked GPIO8 / GPIO9, not header position numbers.
constexpr int SDA_PIN = 8;
constexpr int SCL_PIN = 9;
uint8_t sensorAddress = 0; // Selected only when exactly one candidate responds.
int probe2A = -1;
int probe2B = -1;
uint32_t lastProbeMs = 0;
bool diagnosticLog = false;
constexpr uint16_t MEASURE_MIN_CM = 30;
constexpr uint16_t MEASURE_MAX_CM = 300;
constexpr uint16_t DETECTION_THRESHOLD = 10;
constexpr int NEAR_MIN_CM = 30;
constexpr int NEAR_MAX_CM = 60;
constexpr uint32_t SAMPLE_INTERVAL_MS = 250;

DFRobot_C4001_I2C radar2A(&Wire, 0x2A);
DFRobot_C4001_I2C radar2B(&Wire, 0x2B);
DFRobot_C4001_I2C *radar = nullptr;

void scanAddresses() {
  // Address-only probes: do not change any sensor registers.
  Wire.beginTransmission(0x2A);
  probe2A = Wire.endTransmission();
  Wire.beginTransmission(0x2B);
  probe2B = Wire.endTransmission();
  lastProbeMs = millis();
}

void readLogCommand() {
  // Exact one-character commands terminated by LF/CR. Ignore other input.
  static char command = 0;
  static uint8_t length = 0;
  for (int budget = 0; budget < 32 && Serial.available(); ++budget) {
    const char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (length == 1 && command == 'i') diagnosticLog = true;
      if (length == 1 && command == 'n') diagnosticLog = false;
      length = 0;
    } else {
      if (length == 0) command = c;
      if (length < 2) ++length;
    }
  }
}

void emitReading(bool ready, bool detected, int distanceCm, bool near, int error) {
  readLogCommand();
  // One JSON object per line; booleans are numeric for Signal Tester monitors.
  if (!diagnosticLog) {
    Serial.printf("{\"ready\":%d,\"detected\":%d,\"distance\":%d,\"near\":%d,\"error\":%d}\n",
                  ready ? 1 : 0, detected ? 1 : 0, distanceCm, near ? 1 : 0, error);
    return;
  }
  Serial.printf("{\"ready\":%d,\"detected\":%d,\"distance\":%d,\"near\":%d,\"error\":%d,"
                "\"i2c_2a\":%d,\"i2c_2b\":%d,\"i2c_code_2a\":%d,\"i2c_code_2b\":%d,"
                "\"i2c_address\":%u,\"i2c_address_hex\":\"%s\",\"firmware\":\"sen0610-address-v3\"}\n",
                ready ? 1 : 0, detected ? 1 : 0, distanceCm, near ? 1 : 0, error,
                probe2A < 0 ? -1 : (probe2A == 0 ? 1 : 0),
                probe2B < 0 ? -1 : (probe2B == 0 ? 1 : 0), probe2A, probe2B,
                static_cast<unsigned>(sensorAddress),
                sensorAddress == 0x2A ? "0x2A" : sensorAddress == 0x2B ? "0x2B" : "none");
}

void stopWithError(int error) {
  // Reset after correcting wiring/configuration. Never signal near on errors.
  while (true) {
    scanAddresses(); // Keep diagnosis visible even after initialization failed.
    emitReading(false, false, -1, false, error);
    delay(1000);
  }
}

bool readRegisters(uint8_t reg, uint8_t *data, uint8_t count) {
  Wire.beginTransmission(sensorAddress);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(sensorAddress, count) != count) {
    while (Wire.available()) Wire.read();
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) data[i] = Wire.read();
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(1500);
  emitReading(false, false, -1, false, 0); // Booting.
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(100000);
  Wire.setTimeOut(100);
  // Keep trying while disconnected. A delayed sensor must not remain latched
  // in error 1 after it starts responding. Never configure an ambiguous bus.
  while (true) {
    scanAddresses();
    const bool found2A = probe2A == 0;
    const bool found2B = probe2B == 0;
    sensorAddress = 0;
    radar = nullptr;
    if (found2A != found2B) {
      sensorAddress = found2A ? 0x2A : 0x2B;
      radar = found2A ? &radar2A : &radar2B;
      if (radar->begin()) break;
      sensorAddress = 0;
      radar = nullptr;
    }
    emitReading(false, false, -1, false, found2A && found2B ? 7 : 1);
    delay(1000);
  }
  if (!radar->setSensorMode(eSpeedMode)) stopWithError(2);
  if (!radar->setDetectThres(MEASURE_MIN_CM, MEASURE_MAX_CM, DETECTION_THRESHOLD))
    stopWithError(3);
  radar->setFrettingDetection(eON);
  if (radar->getTMinRange() != MEASURE_MIN_CM ||
      radar->getTMaxRange() != MEASURE_MAX_CM ||
      radar->getThresRange() != DETECTION_THRESHOLD ||
      radar->getFrettingDetection() != eON) stopWithError(4);
  radar->setSensor(eStartSen);
  delay(500);
}

void loop() {
  if (millis() - lastProbeMs >= 1000) scanAddresses();
  uint8_t status = 0;
  uint8_t sample[7] = {};
  if (!readRegisters(REG_STATUS, &status, 1) ||
      !readRegisters(REG_RESULT_OBJ_MUN, sample, sizeof(sample))) {
    emitReading(false, false, -1, false, 5);
  } else if ((status & 0x03) != 0x03) {
    // Measurement must be running in distance/speed mode.
    emitReading(false, false, -1, false, 6);
  } else {
    // Same register layout as the pinned official library, but without its
    // retention of the previous target for 12 empty reads. Read failures and
    // missing targets must reset Signal Tester's hold timer immediately.
    const int distanceCm = static_cast<int16_t>(
        static_cast<uint16_t>(sample[1]) | (static_cast<uint16_t>(sample[2]) << 8));
    const bool detected = sample[0] == 1 && distanceCm >= MEASURE_MIN_CM &&
                          distanceCm <= MEASURE_MAX_CM;
    const bool near = detected && distanceCm >= NEAR_MIN_CM && distanceCm <= NEAR_MAX_CM;
    emitReading(true, detected, detected ? distanceCm : -1, near, 0);
  }
  delay(SAMPLE_INTERVAL_MS);
}
