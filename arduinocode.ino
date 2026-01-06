// ESP32-C3 Pillbox Alarm System
// Hours-based version with FIXED state management for past alarm times

#include <ArduinoBLE.h>
#define LED_BUILTIN 22
#define BUZZERS_PIN 10

// BLE Service and Characteristics
BLEService pillboxService("19B10000-E8F2-537E-4F6C-D104768A1214");

BLEUnsignedLongCharacteristic startTimeChar("19B10001-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEUnsignedLongCharacteristic frequencyChar("19B10002-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEUnsignedIntCharacteristic countChar("19B10003-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEStringCharacteristic statusChar("19B10004-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify, 20);
BLEUnsignedLongCharacteristic currentTimeChar("19B10005-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite | BLENotify);
BLEBoolCharacteristic resetChar("19B10006-E8F2-537E-4F6C-D104768A1214", BLERead | BLEWrite);
BLEUnsignedLongCharacteristic nextAlarmChar("19B10007-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify);
BLEUnsignedIntCharacteristic alarmsCompletedChar("19B10008-E8F2-537E-4F6C-D104768A1214", BLERead | BLENotify);

// Pillbox variables (received in minutes, stored as-is)
unsigned long startTime = 0;        // in minutes from midnight
unsigned long frequency = 0;        // in minutes (but will be used as hours)
unsigned int count = 0;             // number of alarms
String status = "no_alarm";
unsigned long currentTime = 0;      // in seconds from midnight

// Runtime variables
unsigned long nextAlarmTime = 0;    // in seconds from midnight
unsigned int alarmsCompleted = 0;
unsigned long lastMillis = 0;
unsigned long lastUpdateMillis = 0;
const unsigned long UPDATE_INTERVAL = 5000; // Send updates every 5 seconds

// Hardware control function
void triggerAlarm() {
  Serial.println("=====================================");
  Serial.println(">>> ALARM TRIGGERED! <<<");
  Serial.print(">>> Alarm #");
  Serial.print(alarmsCompleted + 1);
  Serial.print(" of ");
  Serial.println(count);
  Serial.println("=====================================");
  digitalWrite(BUZZERS_PIN, HIGH);
  delay(2000);
  digitalWrite(BUZZERS_PIN, LOW);
  // TODO: Add your alarm implementation here
  // Examples:
  // - Turn on buzzer: digitalWrite(BUZZER_PIN, HIGH);
  // - Flash LED: for (int i=0; i<10; i++) { digitalWrite(LED_PIN, !digitalRead(LED_PIN)); delay(500); }
  // - Activate servo: servo.write(90);
  
  updateStatus("triggered");
  alarmsCompleted++;
  alarmsCompletedChar.writeValue(alarmsCompleted);
  
  // Move to next alarm
  if (alarmsCompleted >= count) {
    Serial.println("[INFO] All alarms completed! Auto-clearing configuration...");
    
    // Auto-clear everything so user can set new alarm
    startTime = 0;
    frequency = 0;
    count = 0;
    alarmsCompleted = 0;
    nextAlarmTime = 0;
    
    // Update BLE characteristics
    startTimeChar.writeValue(0);
    frequencyChar.writeValue(0);
    countChar.writeValue(0);
    alarmsCompletedChar.writeValue(0);
    nextAlarmChar.writeValue(0);
    
    updateStatus("no_alarm");
    Serial.println("[INFO] Device ready for new alarm configuration");
  } else {
    updateStatus("no_alarm");
    calculateNextAlarm();
  }
  
  Serial.println("-------------------------------------");
}

void setup() {
  Serial.begin(115200);

  pinMode(LED_BUILTIN, OUTPUT);
  pinMode(BUZZERS_PIN, OUTPUT);
  
  Serial.println("\n\n=====================================");
  Serial.println("ESP32-C3 Pillbox Alarm System");
  Serial.println("Version: 2.1 (Fixed State Management)");
  Serial.println("=====================================\n");

  if (!BLE.begin()) {
    Serial.println("[ERROR] Starting BLE failed!");
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
  pillboxService.addCharacteristic(nextAlarmChar);
  pillboxService.addCharacteristic(alarmsCompletedChar);

  BLE.addService(pillboxService);

  startTimeChar.writeValue(0);
  frequencyChar.writeValue(0);
  countChar.writeValue(0);
  statusChar.writeValue("no_alarm");
  currentTimeChar.writeValue(0);
  resetChar.writeValue(false);
  nextAlarmChar.writeValue(0);
  alarmsCompletedChar.writeValue(0);

  BLE.advertise();
  Serial.println("[INFO] BLE device active, waiting for connections...");
  Serial.println("[INFO] Device name: Pillbox");
  Serial.println("-------------------------------------\n");
}

void loop() {
  BLEDevice central = BLE.central();

  if (central) {
    Serial.println("\n[CONNECT] Client connected!");
    Serial.print("[CONNECT] Address: ");
    Serial.println(central.address());
    digitalWrite(LED_BUILTIN, HIGH);

    while (central.connected()) {
      handleBLEUpdates();
      updateInternalClock();
      checkAlarm();
      sendPeriodicUpdates();
      delay(100);
    }

    digitalWrite(LED_BUILTIN, LOW);
    Serial.println("\n[DISCONNECT] Client disconnected");
    Serial.print("[DISCONNECT] Address: ");
    Serial.println(central.address());
    Serial.println("-------------------------------------\n");
  }
}

void handleBLEUpdates() {
  // Check for reset command
  if (resetChar.written()) {
    if (resetChar.value()) {
      Serial.println("\n[RESET] Reset command received!");
      clearVariables();
      resetChar.writeValue(false);
      Serial.println("[RESET] System reset complete");
    }
  }

  // Check for start time update (received in minutes from client)
  if (startTimeChar.written()) {
    startTime = startTimeChar.value();
    Serial.print("[CONFIG] Start time updated: ");
    Serial.print(startTime);
    Serial.print(" minutes from midnight (");
    Serial.print(startTime / 60);
    Serial.print(":");
    if ((startTime % 60) < 10) Serial.print("0");
    Serial.print(startTime % 60);
    Serial.println(")");
    
    if (startTime >= 1440) {
      Serial.println("[WARNING] Invalid start time (>=1440 minutes), using modulo");
      startTime = startTime % 1440;
      startTimeChar.writeValue(startTime);
    }
    calculateNextAlarm();
  }

  // Check for frequency update (received as hours in minutes, e.g., 60 = 1 hour)
  if (frequencyChar.written()) {
    frequency = frequencyChar.value();
    Serial.print("[CONFIG] Frequency updated: ");
    Serial.print(frequency);
    Serial.print(" minutes (");
    Serial.print(frequency / 60.0, 1);
    Serial.println(" hours)");
    
    if (frequency == 0) {
      Serial.println("[WARNING] Frequency set to 0 - alarms disabled");
    }
    calculateNextAlarm();
  }

  // Check for count update
  if (countChar.written()) {
    count = countChar.value();
    Serial.print("[CONFIG] Alarm count updated: ");
    Serial.println(count);
    
    if (count == 0) {
      Serial.println("[WARNING] Count set to 0 - alarms disabled");
    }
    calculateNextAlarm();
  }

  // Check for current time update
  if (currentTimeChar.written()) {
    unsigned long newTime = currentTimeChar.value();
    
    if (newTime >= 86400) {
      Serial.println("[WARNING] Invalid time (>=86400 seconds), using modulo");
      newTime = newTime % 86400;
    }
    
    currentTime = newTime;
    lastMillis = millis();
    Serial.print("[TIME] Current time set to: ");
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
    
    // Handle day rollover (just wrap time, alarms continue across days)
    if (currentTime >= 86400) {
      unsigned long oldTime = currentTime;
      currentTime = currentTime % 86400;
      Serial.println("\n[TIME] Day rollover detected");
      Serial.print("[TIME] Time wrapped from ");
      Serial.print(oldTime);
      Serial.print(" to ");
      Serial.println(currentTime);
      Serial.println("[INFO] Alarm sequence continues (multi-day support)");
    }
  }
}

void calculateNextAlarm() {
  if (startTime == 0 || frequency == 0 || count == 0) {
    if (nextAlarmTime != 0) {
      Serial.println("[INFO] Alarm schedule cleared (invalid config)");
    }
    nextAlarmTime = 0;
    nextAlarmChar.writeValue(0);
    alarmsCompleted = 0;
    alarmsCompletedChar.writeValue(0);
    return;
  }

  unsigned long startTimeSeconds = startTime * 60; // Convert minutes to seconds
  unsigned long frequencySeconds = frequency * 60; // Convert minutes to seconds

  Serial.println("\n[CALC] Calculating next alarm...");
  Serial.print("[CALC] Current time: ");
  printTime(currentTime);
  Serial.print("[CALC] Alarms completed: ");
  Serial.print(alarmsCompleted);
  Serial.print("/");
  Serial.println(count);

  // Find the next alarm time
  for (unsigned int i = alarmsCompleted; i < count; i++) {
    unsigned long alarmTime = startTimeSeconds + (i * frequencySeconds);
    
    // Handle day rollover for alarm times
    unsigned long alarmTimeOfDay = alarmTime % 86400;
    
    // Calculate how far in the future this alarm is
    long timeUntilAlarm = (long)alarmTimeOfDay - (long)currentTime;
    
    // If alarm is in the past today, it's actually tomorrow (add 24 hours)
    if (timeUntilAlarm < -60) {  // -60 second grace period for alarms that just passed
      timeUntilAlarm += 86400;
      Serial.print("[CALC] Alarm #");
      Serial.print(i + 1);
      Serial.print(" scheduled for tomorrow at: ");
      printTime(alarmTimeOfDay);
    } else if (timeUntilAlarm >= -60 && timeUntilAlarm <= 60) {
      Serial.print("[CALC] Alarm #");
      Serial.print(i + 1);
      Serial.println(" is imminent (within 60 seconds)");
    }
    
    // Use the alarm's time-of-day (wrapped to 24h) as the target
    nextAlarmTime = alarmTimeOfDay;
    nextAlarmChar.writeValue(nextAlarmTime);
    
    Serial.print("[CALC] Next alarm (#");
    Serial.print(i + 1);
    Serial.print(") scheduled at: ");
    printTime(nextAlarmTime);
    
    if (timeUntilAlarm > 0) {
      Serial.print("[CALC] Time until alarm: ");
      unsigned long secondsUntil = timeUntilAlarm;
      Serial.print(secondsUntil / 3600);
      Serial.print("h ");
      Serial.print((secondsUntil % 3600) / 60);
      Serial.print("m ");
      Serial.print(secondsUntil % 60);
      Serial.println("s");
    }
    return;
  }

  // All alarms completed (shouldn't normally reach here due to auto-clear)
  Serial.println("[INFO] All alarms completed");
  nextAlarmTime = 0;
  nextAlarmChar.writeValue(0);
}

void checkAlarm() {
  if (nextAlarmTime == 0) {
    return;
  }

  // Check if it's time for the alarm (with 2-second tolerance to avoid missing)
  // Handle both cases: alarm hasn't wrapped around day, and alarm has wrapped
  long timeDiff = (long)currentTime - (long)nextAlarmTime;
  
  if (timeDiff >= 0 && timeDiff <= 2) {
    // Alarm is happening now (within 2 second window)
    triggerAlarm();
  } else if (timeDiff < -86395) {
    // Current time wrapped past midnight but alarm hasn't triggered yet
    // Example: alarm at 23:59:50 (86390s), current time is 00:00:05 (5s)
    // timeDiff = 5 - 86390 = -86385, which is < -86395
    // This means we just crossed midnight and should trigger
    triggerAlarm();
  }
}

void sendPeriodicUpdates() {
  unsigned long currentMillis = millis();
  
  if (currentMillis - lastUpdateMillis >= UPDATE_INTERVAL) {
    lastUpdateMillis = currentMillis;
    
    // Send current time to client
    currentTimeChar.writeValue(currentTime);
    
    // Log current status
    Serial.print("[UPDATE] Time: ");
    printTime(currentTime);
    
    if (nextAlarmTime > 0) {
      Serial.print("[UPDATE] Next alarm at: ");
      printTime(nextAlarmTime);
      
      // Calculate time until alarm (handling day wraparound)
      long timeUntilAlarm = (long)nextAlarmTime - (long)currentTime;
      if (timeUntilAlarm < 0) {
        timeUntilAlarm += 86400; // Alarm is tomorrow
      }
      
      Serial.print("[UPDATE] Time until alarm: ");
      Serial.print(timeUntilAlarm / 3600);
      Serial.print("h ");
      Serial.print((timeUntilAlarm % 3600) / 60);
      Serial.print("m ");
      Serial.print(timeUntilAlarm % 60);
      Serial.println("s");
    }
  }
}

void updateStatus(String newStatus) {
  if (status != newStatus) {
    status = newStatus;
    statusChar.writeValue(status);
    Serial.print("[STATUS] Changed to: ");
    Serial.println(status);
  }
}

void clearVariables() {
  startTime = 0;  
  frequency = 0;
  count = 0;
  currentTime = 0;
  nextAlarmTime = 0;
  alarmsCompleted = 0;
  
  startTimeChar.writeValue(0);
  frequencyChar.writeValue(0);
  countChar.writeValue(0);
  currentTimeChar.writeValue(0);
  nextAlarmChar.writeValue(0);
  alarmsCompletedChar.writeValue(0);
  updateStatus("no_alarm");
  
  Serial.println("[RESET] All variables cleared!");
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