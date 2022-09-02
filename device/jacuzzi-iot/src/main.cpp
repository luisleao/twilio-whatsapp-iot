#include <Arduino.h>
#include <OneWire.h>
#include <DallasTemperature.h>

#include <ArduinoJson.h>
#include <Golioth.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include "secrets.h"


#define BUBBLES 5
#define HEATER 18
#define SENSOR_LEVEL 16
#define SENSOR_TEMP 4

#define MIN_TEMP 5.0f
#define MAX_TEMP 40.0f


// Setup a oneWire instance to communicate with any OneWire devices
OneWire oneWire(SENSOR_TEMP);
// Pass our oneWire reference to Dallas Temperature sensor 
DallasTemperature sensors(&oneWire);



// LATER - WIFI
int status = WL_IDLE_STATUS;
WiFiClientSecure net;
GoliothClient *client = GoliothClient::getInstance();





bool active = false;
bool clean = false;
bool bubbles = false;
bool heater = false;
bool level_sensor = false;
float temp = 0.0;
float temp_target = 0.0;

unsigned long lastMillis = 0;
unsigned long counter = 0;




void shutdownAllRelays() {
  digitalWrite(BUBBLES, HIGH);
  digitalWrite(HEATER, HIGH);
  // client->setLightDBStateAtPath("/bubbles", String(false).c_str());
  // client->setLightDBStateAtPath("/heater", String(false).c_str());
}
void setBubbles(bool active) {
  digitalWrite(BUBBLES, active ? LOW : HIGH);
}
void setHeater(bool active) {
  digitalWrite(HEATER, active ? LOW : HIGH);
}




void onLightDBMessage(String path, String payload) {

  // paths
  // - bubbles
  // - heater
  // - temp-target
  // - clean


  // IF heater changes to ON, check if bubbles is on first
  // IF header changes to OFF, turn on bubbles 30 seconds later
  Serial.println("incoming: " + path + " - " + payload);

  if (path == "active") {
    Serial.println("ACTIVE!!!");
    active = payload == "true" || payload == "1";
  }

  if (path == "clean") {
    Serial.println("CLEAN!!!");
    clean = payload == "true" || payload == "1";
  }

  if (path == "bubbles") {
    Serial.println("BUBBLES!!!");
    bubbles = payload == "true" || payload == "1";
  }

  if (path == "heater") {
    Serial.println("HEATER!!!");
    heater = payload == "true" || payload == "1";
  }

  if (path == "temp_target") {
    temp_target = payload.toFloat();
  }
}

void connect() {
  Serial.print("checking wifi...");
  int tries = 0;
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    if (tries > 10) {
      Serial.println("Wifi not connected");
      return;
    }
    Serial.print(".");
    delay(1000);
    tries++;
  }
  Serial.println("\nconnected to WiFi!\n");

  Serial.println("connecting to cloud gateway...");
  tries = 0;

#ifdef ESP32
  net.setCACert(GOLIOTH_ROOT_CA);
#endif

  client->setClient(net);
  client->setPSKId(PSK_ID);
  client->setPSK(PSK);
  while (!client->connect()) {
    if (tries > 10) {
      Serial.println("not connected");
      return;
    }
    Serial.print(".");
    delay(1000);
    tries++;
  }

  Serial.println("Connected to MQTT");

  client->onHello([](String name) { Serial.println(name); });
  client->listenHello();
  client->onLightDBMessage(onLightDBMessage);

  client->listenLightDBStateAtPath("/active");
  client->listenLightDBStateAtPath("/clean");
  client->listenLightDBStateAtPath("/bubbles");
  client->listenLightDBStateAtPath("/heater");
  client->listenLightDBStateAtPath("/temp_target");
}


void setup() {
  // runs once
  Serial.begin(115200);
  pinMode(BUILTIN_LED, OUTPUT);
  pinMode(BUBBLES, OUTPUT);
  pinMode(HEATER, OUTPUT);
  pinMode(SENSOR_LEVEL, INPUT_PULLUP); // HIGH = OFF | LOW = ON
  
  digitalWrite(BUILTIN_LED, LOW);
  shutdownAllRelays();

  sensors.begin();
  connect();
}


void loop() {
  // while (true) {}

  client->poll();

  if (!net.connected() || !client->connected()) {
    // shutdown all relays
    shutdownAllRelays();
    connect();
  }

  // TODO: update how long header is on
  // OK: update level sensor
  // OK: update temperature
  // OK: check if header is on, but bubbles is off
  // OK: if level is low, turn of heater and bubbles

  bool level_current = digitalRead(SENSOR_LEVEL) == LOW; // LOW = ON
  if (level_current != level_sensor) {
    // TODO: mudou status
    Serial.print("LEVEL ");
    Serial.println(level_current);

    // se desligou, desligar HEATER e BUBBLES
    if (!level_current) {
      shutdownAllRelays();
    }

    level_sensor = level_current;
    digitalWrite(BUILTIN_LED, HIGH);
    client->setLightDBStateAtPath("/level_sensor", String(level_sensor).c_str());
    client->setLightDBStateAtPath("/millis", String(millis()).c_str());
    digitalWrite(BUILTIN_LED, LOW);

  }

  sensors.begin();
  sensors.requestTemperatures(); 
  temp = sensors.getTempCByIndex(0); // use getTempFByIndex for F

  if (temp < 126.9) { // verificar se é negativo
    client->logError(String("Temperature sensor disconected").c_str());
  }

  // check bubbles and heater
  bool can_active_bubbles = level_sensor;
  digitalWrite(BUBBLES, (active || clean) && bubbles && can_active_bubbles ? LOW : HIGH);


  bool can_active_heater = bubbles && can_active_bubbles 
    && temp < temp_target && 
    temp > MIN_TEMP && 
    temp <= MAX_TEMP;
  digitalWrite(HEATER, (active && !clean) && heater && can_active_heater ? LOW : HIGH);


  if (millis() - lastMillis > 5 * 1000) {
    // check heater
    lastMillis = millis();
    counter++;

    digitalWrite(BUILTIN_LED, HIGH);
    client->setLightDBStateAtPath("/counter", String(counter).c_str());
    client->setLightDBStateAtPath("/temp", String(temp).c_str());
    client->setLightDBStateAtPath("/can_active_bubbles", String(can_active_bubbles).c_str());
    client->setLightDBStateAtPath("/can_active_heater", String(can_active_heater).c_str());
    client->setLightDBStateAtPath("/millis", String(millis()).c_str());
    digitalWrite(BUILTIN_LED, LOW);

    Serial.print(millis());
    
    Serial.print(" ACT: ");
    Serial.print(active);
    Serial.print(" CLEAN: ");
    Serial.print(clean);
    Serial.print(" L: ");
    Serial.print(level_current);
    Serial.print(" ");
    Serial.print(" B: ");
    Serial.print(bubbles);
    Serial.print(" > ");
    Serial.print(can_active_bubbles);
    Serial.print(" H: ");
    Serial.print(heater);
    Serial.print(" > ");
    Serial.print(can_active_heater);
    Serial.print(" ");
    Serial.print(temp);
    Serial.print("ºC ");
    Serial.print(" TARGET ");
    Serial.print(temp_target);
    Serial.print("ºC ");
    Serial.println();

    lastMillis = millis();

  }


  // - nao ligar heater se bubbles == false
}