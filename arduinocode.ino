// !!IMPORTANT! BECAUSE OF HOW THIS PRODUCT IS STILL UNDER PROTOTYPING,
// SOME FUNCTIONS ARE EMPTY! THIS IS INTENTIONAL, AS ANOTHER DEVELOPER
// MAY FIT THE SPECIFIC INPUTS AND OUTPUTS OF THEIR SCHEMATIC INTO
// THIS CODE.
#include <ArduinoBLE.h>

// BLE Service and Characteristics
BLEService pillboxService("19B10000-E8F2-537E-4F6C-D104768A1214");

BLEUnsignedLongCharacteristic startTimeChar("19B10001-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEUnsignedLongCharacteristic frequencyChar("19B10002-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEUnsignedIntCharacteristic countChar("19B10003-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEStringCharacteristic statusChar("19B10004-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 20);
BLEUnsignedLongCharacteristic currentTimeChar("19B10005-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEBoolCharacteristic resetChar("19B10006-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);

// Pillbox variables
unsigned long startTime = 0;        // in minutes from midnight
unsigned long frequency = 0;        // in minutes
unsigned int count = 0;             // number of alarms
String status = "no_alarm";
unsigned long currentTime = 0;      // in seconds from midnight
bool reset = false;

// Runtime variables
unsigned long nextAlarmTime = 0;    // in seconds from midnight
unsigned int alarmsCompleted = 0;
bool alarmTriggered = false;
unsigned long lastMillis = 0;
const int BUTTON_PIN = 2;           // Button to dismiss alarm

// Hardware control functions (placeholders)
void openPillbox() {
  // TODO: Add servo code to open pillbox
  Serial.println("Opening pillbox...");
}

void closePillbox() {
  // TODO: Add servo code to close pillbox
  Serial.println("Closing pillbox...");
}

void startAlarmSound() {
  // TODO: Add speaker/buzzer code
  Serial.println("Starting alarm sound...");
}

void stopAlarmSound() {
  // TODO: Stop speaker/buzzer
  Serial.println("Stopping alarm sound...");
}

void setup() {
  Serial.begin(9600);
  while (!Serial);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_BUILTIN, OUTPUT);

  if (!BLE.begin()) {
    Serial.println("Starting BLE failed!");
    while (1);
  }

  BLE.setLocalName("Pillbox");
  BLE.setAdvertisedService(pillboxService);

  pillboxService.addCharacteristic(startTimeChar);
  pillboxService.addCharacteristic(frequencyChar);
  pillboxService.addCharacteristic(countChar);
  pillboxService.addCharacteristic(statusChar);
  pillboxService.addCharacteristic(currentTimeChar);
  pillboxService.addCharacteristic(resetChar);

  BLE.addService(pillboxService);

  startTimeChar.writeValue(0);
  frequencyChar.writeValue(0);
  countChar.writeValue(0);
  statusChar.writeValue("no_alarm");
  currentTimeChar.writeValue(0);
  resetChar.writeValue(false);

  BLE.advertise();
  Serial.println("Pillbox BLE device active, waiting for connections...");
}

void loop() {
  BLEDevice central = BLE.central();

  if (central) {
    Serial.print("Connected to central: ");
    Serial.println(central.address());
    digitalWrite(LED_BUILTIN, HIGH);

    while (central.connected()) {
      handleBLEUpdates();
      updateInternalClock();
      checkAlarm();
      handleButton();
      delay(100);
    }

    digitalWrite(LED_BUILTIN, LOW);
    Serial.print("Disconnected from central: ");
    Serial.println(central.address());
  }
}

void handleBLEUpdates() {
  // Check for reset command
  if (resetChar.written()) {
    reset = resetChar.value();
    if (reset) {
      Serial.println("Reset command received!");
      clearVariables();
      resetChar.writeValue(false);
    }
  }

  // Check for start time update
  if (startTimeChar.written()) {
    startTime = startTimeChar.value();
    Serial.print("Start time updated: ");
    Serial.print(startTime);
    Serial.println(" minutes");
    calculateNextAlarm();
  }

  // Check for frequency update
  if (frequencyChar.written()) {
    frequency = frequencyChar.value();
    Serial.print("Frequency updated: ");
    Serial.print(frequency);
    Serial.println(" minutes");
    calculateNextAlarm();
  }

  // Check for count update
  if (countChar.written()) {
    count = countChar.value();
    Serial.print("Count updated: ");
    Serial.println(count);
    calculateNextAlarm();
  }

  // Check for current time update
  if (currentTimeChar.written()) {
    currentTime = currentTimeChar.value();
    lastMillis = millis();
    Serial.print("Current time updated: ");
    printTime(currentTime);
    calculateNextAlarm();
  }
}

void updateInternalClock() {
  // Update current time based on millis()
  unsigned long currentMillis = millis();
  unsigned long elapsedMillis = currentMillis - lastMillis;
  
  if (elapsedMillis >= 1000) {
    unsigned long elapsedSeconds = elapsedMillis / 1000;
    currentTime += elapsedSeconds;
    lastMillis = currentMillis - (elapsedMillis % 1000);
    
    // Handle day rollover
    if (currentTime >= 86400) {
      currentTime = currentTime % 86400;
    }
    
    // Update BLE characteristic
    currentTimeChar.writeValue(currentTime);
  }
}

void calculateNextAlarm() {
  if (startTime == 0 || frequency == 0 || count == 0) {
    nextAlarmTime = 0;
    alarmsCompleted = 0;
    return;
  }

  unsigned long startTimeSeconds = startTime * 60;
  unsigned long frequencySeconds = frequency * 60;

  // Find the next alarm time
  for (unsigned int i = alarmsCompleted; i < count; i++) {
    unsigned long alarmTime = startTimeSeconds + (i * frequencySeconds);
    
    // Handle day rollover
    alarmTime = alarmTime % 86400;
    
    if (alarmTime > currentTime) {
      nextAlarmTime = alarmTime;
      Serial.print("Next alarm at: ");
      printTime(nextAlarmTime);
      return;
    }
  }

  // All alarms completed
  if (alarmsCompleted >= count) {
    Serial.println("All alarms completed!");
    nextAlarmTime = 0;
    updateStatus("no_alarm");
  }
}

void checkAlarm() {
  if (nextAlarmTime == 0 || alarmTriggered) {
    return;
  }

  // Check if it's time for the alarm (with 2-second tolerance)
  if (currentTime >= nextAlarmTime && currentTime <= nextAlarmTime + 2) {
    triggerAlarm();
  }
}

void triggerAlarm() {
  Serial.println("ALARM TRIGGERED!");
  alarmTriggered = true;
  
  openPillbox();
  startAlarmSound();
  updateStatus("triggered");
  
  alarmsCompleted++;
}

void handleButton() {
  if (!alarmTriggered) {
    return;
  }

  // Check if button is pressed (LOW because of INPUT_PULLUP)
  if (digitalRead(BUTTON_PIN) == LOW) {
    dismissAlarm();
    delay(500); // Debounce
  }
}

void dismissAlarm() {
  Serial.println("Alarm dismissed!");
  
  stopAlarmSound();
  closePillbox();
  updateStatus("dismissed");
  
  delay(1000);
  
  alarmTriggered = false;
  
  // Check if all alarms are done
  if (alarmsCompleted >= count) {
    updateStatus("no_alarm");
    nextAlarmTime = 0;
    Serial.println("All alarms completed!");
  } else {
    updateStatus("no_alarm");
    calculateNextAlarm();
  }
}

void updateStatus(String newStatus) {
  status = newStatus;
  statusChar.writeValue(status);
  Serial.print("Status updated to: ");
  Serial.println(status);
}

void clearVariables() {
  startTime = 0;
  frequency = 0;
  count = 0;
  currentTime = 0;
  nextAlarmTime = 0;
  alarmsCompleted = 0;
  alarmTriggered = false;
  
  startTimeChar.writeValue(0);
  frequencyChar.writeValue(0);
  countChar.writeValue(0);
  currentTimeChar.writeValue(0);
  updateStatus("no_alarm");
  
  Serial.println("All variables cleared!");
}

void printTime(unsigned long seconds) {
  unsigned long hours = seconds / 3600;
  unsigned long minutes = (seconds % 3600) / 60;
  unsigned long secs = seconds % 60;
  
  Serial.print(hours);
  Serial.print(":");
  if (minutes < 10) Serial.print("0");
  Serial.print(minutes);
  Serial.print(":");
  if (secs < 10) Serial.print("0");
  Serial.println(secs);
}