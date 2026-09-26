#include <WiFi.h>
#include <PubSubClient.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_NeoPixel.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_RESET -1
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, OLED_RESET);

#define LED_PIN 13
#define NUMPIXELS 8
Adafruit_NeoPixel pixels(NUMPIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);

#define MQ7_PIN 34
#define MQ135_PIN 35
#define PM25_ANALOG_PIN 32
#define PM25_LED_PIN 4
#define ROLE_PIN 26

const char* ssid = "fiyona";
const char* password = "ruki1234";
const char* mqtt_server = "broker.hivemq.com";
const int mqtt_port = 1883;

const char* MQTT_TOPIC_TELEMETRY = "takim12/telemetry";
const char* MQTT_TOPIC_GAZ = "btu/rukiye/proje/gaz";
const char* MQTT_TOPIC_HAVA = "btu/rukiye/proje/hava";
const char* MQTT_TOPIC_TOZ = "btu/rukiye/proje/toz";
const char* MQTT_TOPIC_DURUM = "btu/rukiye/proje/durum";

// Most 1-channel relay modules used with ESP32 are active LOW:
// LOW energizes COM-NO and starts the fan, HIGH releases the relay.
// With NO wiring, the fan must be off when the relay is not energized.
const int FAN_ON_LEVEL = LOW;
const int FAN_OFF_LEVEL = HIGH;

// Old raw ADC test thresholds are kept as the DANGER trigger points.
// WARNING turns yellow shortly before those limits so the third state is visible.
const int CO_WARNING_THRESHOLD = 900;
const int CO_DANGER_THRESHOLD = 1200;
const int AIR_WARNING_THRESHOLD = 2000;
const int AIR_DANGER_THRESHOLD = 2000;
const int PM_WARNING_THRESHOLD = 2000;
const int PM_DANGER_THRESHOLD = 2000;

const unsigned long SENSOR_INTERVAL_MS = 2000;
const unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
const unsigned long DANGER_BLINK_INTERVAL_MS = 500;

WiFiClient espClient;
PubSubClient client(espClient);

unsigned long lastMsg = 0;
unsigned long lastWiFiAttempt = 0;
unsigned long lastDangerBlink = 0;
bool dangerLedOn = true;
bool displayOk = false;

bool manualOverride = false;
bool manualFanState = false;

const int SAMPLE_SIZE = 10;
int pmSamples[SAMPLE_SIZE] = {0};
int sampleIndex = 0;
int sampleCount = 0;

enum RiskLevel {
  SAFE,
  WARNING,
  DANGER
};

RiskLevel currentRisk = SAFE;

void callback(char* topic, byte* payload, unsigned int length) {
  String message = "";
  for (unsigned int i = 0; i < length; i++) {
    message += (char)payload[i];
  }
  Serial.print("Mqtt Komut: ");
  Serial.println(message);

  if (message == "FAN_ON") {
    manualOverride = true;
    manualFanState = true;
  } else if (message == "FAN_OFF") {
    manualOverride = true;
    manualFanState = false;
  } else if (message == "FAN_AUTO") {
    manualOverride = false;
  }
}

const char* riskText(RiskLevel risk) {
  switch (risk) {
    case SAFE: return "GUVENLI";
    case WARNING: return "UYARI";
    case DANGER: return "TEHLIKE";
    default: return "BILINMIYOR";
  }
}

void setAllPixels(uint8_t red, uint8_t green, uint8_t blue) {
  for (int i = 0; i < NUMPIXELS; i++) {
    pixels.setPixelColor(i, red, green, blue);
  }
  pixels.show();
}

void setFan(bool enabled) {
  digitalWrite(ROLE_PIN, enabled ? FAN_ON_LEVEL : FAN_OFF_LEVEL);
}

void ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWiFiAttempt < WIFI_RETRY_INTERVAL_MS) return;

  lastWiFiAttempt = now;
  WiFi.disconnect();
  WiFi.begin(ssid, password);
}

void reconnectMqtt() {
  if (WiFi.status() != WL_CONNECTED || client.connected()) return;

  String clientId = "BTU-Maden-OLED-Takim12-";
  clientId += String((uint32_t)ESP.getEfuseMac(), HEX);

  if (client.connect(clientId.c_str())) {
    client.subscribe("btu/rukiye/proje/komut");
  }
}

int readPmAverage() {
  digitalWrite(PM25_LED_PIN, HIGH);
  delayMicroseconds(280);
  int pmRaw = analogRead(PM25_ANALOG_PIN);
  delayMicroseconds(40);
  digitalWrite(PM25_LED_PIN, LOW);

  pmSamples[sampleIndex] = pmRaw;
  sampleIndex = (sampleIndex + 1) % SAMPLE_SIZE;
  if (sampleCount < SAMPLE_SIZE) sampleCount++;

  long pmSum = 0;
  for (int i = 0; i < sampleCount; i++) {
    pmSum += pmSamples[i];
  }

  return pmSum / sampleCount;
}

RiskLevel calculateRisk(int coValue, int airValue, int pmValue) {
  bool danger = coValue >= CO_DANGER_THRESHOLD ||
                airValue >= AIR_DANGER_THRESHOLD ||
                pmValue >= PM_DANGER_THRESHOLD ||
                (coValue >= CO_WARNING_THRESHOLD && pmValue >= PM_WARNING_THRESHOLD);

  if (danger) return DANGER;

  bool warning = coValue >= CO_WARNING_THRESHOLD ||
                 airValue >= AIR_WARNING_THRESHOLD ||
                 pmValue >= PM_WARNING_THRESHOLD;

  return warning ? WARNING : SAFE;
}

void applyOutputs(RiskLevel risk, bool fanOn) {
  setFan(fanOn);

  if (risk == SAFE) {
    dangerLedOn = true;
    setAllPixels(0, 255, 0);
    return;
  }

  if (risk == WARNING) {
    dangerLedOn = true;
    setAllPixels(255, 160, 0);
    return;
  }

  unsigned long now = millis();
  if (now - lastDangerBlink >= DANGER_BLINK_INTERVAL_MS) {
    lastDangerBlink = now;
    dangerLedOn = !dangerLedOn;
  }

  if (dangerLedOn) {
    setAllPixels(255, 0, 0);
  } else {
    setAllPixels(0, 0, 0);
  }
}

void publishTelemetry(int coValue, int airValue, int pmValue, RiskLevel risk, bool fanOn) {
  if (WiFi.status() != WL_CONNECTED || !client.connected()) return;

  client.publish(MQTT_TOPIC_GAZ, String(coValue).c_str());
  client.publish(MQTT_TOPIC_HAVA, String(airValue).c_str());
  client.publish(MQTT_TOPIC_TOZ, String(pmValue).c_str());
  client.publish(MQTT_TOPIC_DURUM, riskText(risk));

  String payload = "{";
  payload += "\"team\":12,";
  payload += "\"co_raw\":";
  payload += coValue;
  payload += ",\"air_raw\":";
  payload += airValue;
  payload += ",\"pm25_raw\":";
  payload += pmValue;
  payload += ",\"risk\":\"";
  payload += riskText(risk);
  payload += "\",\"fan\":";
  payload += fanOn ? "true" : "false";
  payload += ",\"override\":\"";
  payload += manualOverride ? "manual" : "auto";
  payload += "\",\"uptime_ms\":";
  payload += millis();
  payload += "}";

  client.publish(MQTT_TOPIC_TELEMETRY, payload.c_str());
}

void drawDisplay(int coValue, int airValue, int pmValue, RiskLevel risk, bool fanOn) {
  if (!displayOk) return;

  display.clearDisplay();
  display.setCursor(0, 0);
  display.println("Maden Otomasyon v4");
  display.println("-----------------");
  display.print("CO (MQ-7)  : ");
  display.println(coValue);
  display.print("Hava(MQ135): ");
  display.println(airValue);
  display.print("Toz (PM2.5): ");
  display.println(pmValue);
  display.print("WiFi       : ");
  display.println(WiFi.status() == WL_CONNECTED ? "OK" : "YOK");
  display.print("DURUM      : ");
  display.println(riskText(risk));
  display.print("FAN        : ");
  display.println(fanOn ? "ACIK" : "KAPALI");
  display.display();
}

void setup() {
  Serial.begin(115200);
  delay(500);

  digitalWrite(ROLE_PIN, FAN_OFF_LEVEL);
  pinMode(ROLE_PIN, OUTPUT);
  setFan(false);

  pixels.begin();
  pixels.setBrightness(160);
  pixels.clear();
  pixels.show();

  pinMode(PM25_LED_PIN, OUTPUT);
  digitalWrite(PM25_LED_PIN, LOW);

  Wire.begin(21, 22);
  displayOk = display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (displayOk) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Sistem basliyor...");
    display.display();
  }

  WiFi.persistent(false);
  WiFi.disconnect(true);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  lastWiFiAttempt = millis();

  int retryCount = 0;
  while (WiFi.status() != WL_CONNECTED && retryCount < 12) {
    delay(500);
    retryCount++;
  }

  if (displayOk) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println(WiFi.status() == WL_CONNECTED ? "Wi-Fi Baglandi." : "Wi-Fi Yok");
    display.println("Sensorler aciliyor...");
    display.display();
    delay(1000);
  }

  setAllPixels(0, 255, 0);

  client.setServer(mqtt_server, mqtt_port);
  client.setCallback(callback);
}

void loop() {
  ensureWiFi();

  if (WiFi.status() == WL_CONNECTED) {
    reconnectMqtt();
    client.loop();
  }

  bool fanOn = manualOverride ? manualFanState : (currentRisk != SAFE);
  applyOutputs(currentRisk, fanOn);

  unsigned long now = millis();
  if (now - lastMsg < SENSOR_INTERVAL_MS) return;
  lastMsg = now;

  int coValue = analogRead(MQ7_PIN);
  int airValue = analogRead(MQ135_PIN);
  int pmAvgValue = readPmAverage();

  currentRisk = calculateRisk(coValue, airValue, pmAvgValue);
  fanOn = manualOverride ? manualFanState : (currentRisk != SAFE);

  applyOutputs(currentRisk, fanOn);
  publishTelemetry(coValue, airValue, pmAvgValue, currentRisk, fanOn);
  drawDisplay(coValue, airValue, pmAvgValue, currentRisk, fanOn);
}
