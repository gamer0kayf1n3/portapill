// Bluetooth Pillbox Simulator Module with Real-Time Alarm Scheduling
// This module overrides the Web Bluetooth API and triggers alarms at actual scheduled times
const queryString = window.location.search;
const urlParams = new URLSearchParams(queryString);

// Get the value of a specific parameter
if (urlParams.get("debug") == "1") {
    alert("Debug mode is on. Simulating Bluetooth devices...");
    class SimulatedBluetoothDevice {
        constructor(name) {
            this.name = name;
            this.id = `simulated-${Math.random().toString(36).substr(2, 9)}`;
            this.gatt = new SimulatedBluetoothRemoteGATTServer(this);
            this._listeners = {};
        }

        addEventListener(event, callback) {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }
            this._listeners[event].push(callback);
        }

        removeEventListener(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            }
        }

        _dispatchEvent(event) {
            if (this._listeners[event.type]) {
                this._listeners[event.type].forEach(callback => callback(event));
            }
        }
    }

    class SimulatedBluetoothRemoteGATTServer {
        constructor(device) {
            this.device = device;
            this.connected = false;
        }

        async connect() {
            await this._delay(500);
            this.connected = true;
            return this;
        }

        disconnect() {
            this.connected = false;
            this.device._dispatchEvent({ type: 'gattserverdisconnected' });
        }

        async getPrimaryService(serviceUuid) {
            if (!this.connected) {
                throw new Error('GATT Server is disconnected');
            }
            await this._delay(100);
            return new SimulatedBluetoothRemoteGATTService(serviceUuid, this);
        }

        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    class SimulatedBluetoothRemoteGATTService {
        constructor(uuid, server) {
            this.uuid = uuid;
            this.device = server.device;
            this.characteristics = new Map();

            // Shared alarm configuration for all characteristics
            this._sharedAlarmConfig = {
                startTime: 0,
                frequency: 0,
                count: 0,
                active: false
            };
            this._scheduledAlarms = [];
            this._alarmTimeouts = [];
        }

        async getCharacteristic(characteristicUuid) {
            await this._delay(50);

            if (!this.characteristics.has(characteristicUuid)) {
                this.characteristics.set(
                    characteristicUuid,
                    new SimulatedBluetoothRemoteGATTCharacteristic(characteristicUuid, this)
                );
            }

            return this.characteristics.get(characteristicUuid);
        }

        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    class SimulatedBluetoothRemoteGATTCharacteristic {
        constructor(uuid, service) {
            this.uuid = uuid;
            this.service = service;
            this._value = new DataView(new ArrayBuffer(4));
            this._listeners = {};
            this._notifying = false;

            this._initializeValue();
        }

        _initializeValue() {
            // Set initial time to current time and update every second
            if (this.uuid === '19b10005-e8f2-537e-4f6c-d104768a1214') { // currentTime
                const now = new Date();
                const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                this._value.setUint32(0, seconds, true);

                setInterval(() => {
                    const now = new Date();
                    const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
                    this._value.setUint32(0, seconds, true);
                }, 1000);
            }

            // Set initial status
            if (this.uuid === '19b10004-e8f2-537e-4f6c-d104768a1214') { // status
                const encoder = new TextEncoder();
                this._value = new DataView(encoder.encode('no_alarm').buffer);
            }
        }

        async readValue() {
            await this._delay(50);
            return this._value;
        }

        async writeValue(value) {
            await this._delay(50);
            this._value = value;

            // Use shared alarm config from service
            const alarmConfig = this.service._sharedAlarmConfig;

            console.log('🔔 DEBUG - Before write, config is:', JSON.stringify(alarmConfig));

            // Track alarm configuration
            if (this.uuid === '19b10001-e8f2-537e-4f6c-d104768a1214') { // startTime
                alarmConfig.startTime = value.getUint32(0, true);
                console.log(`🔔 Alarm Start Time Set: ${this._formatMinutes(alarmConfig.startTime)} (${alarmConfig.startTime} minutes)`);
                console.log('🔔 DEBUG - After startTime, config is:', JSON.stringify(alarmConfig));
            }

            if (this.uuid === '19b10002-e8f2-537e-4f6c-d104768a1214') { // frequency
                const frequencyHours = value.getUint32(0, true);
                alarmConfig.frequency = frequencyHours * 60; // Convert hours to minutes
                console.log(`🔔 Alarm Frequency Set: Every ${frequencyHours} hour(s) = ${alarmConfig.frequency} minutes`);
                console.log('🔔 DEBUG - After frequency, config is:', JSON.stringify(alarmConfig));
            }

            if (this.uuid === '19b10003-e8f2-537e-4f6c-d104768a1214') { // count
                alarmConfig.count = value.getUint16(0, true);
                console.log(`🔔 Alarm Count Set: ${alarmConfig.count} times`);
                console.log(`🔔 DEBUG - Final config state:`, JSON.stringify(alarmConfig));

                // When count is written (last parameter), schedule all alarms
                this._scheduleAlarms();
            }

            // Handle reset
            if (this.uuid === '19b10006-e8f2-537e-4f6c-d104768a1214') { // reset
                console.log('🔔 Alarm Reset');
                this._cancelAllAlarms();
                alarmConfig.startTime = 0;
                alarmConfig.frequency = 0;
                alarmConfig.count = 0;
                this._notifyStatusChange('no_alarm');
            }

            return;
        }

        _scheduleAlarms() {
            // Cancel any existing alarms
            this._cancelAllAlarms();

            const alarmConfig = this.service._sharedAlarmConfig;
            const { startTime, frequency, count } = alarmConfig;

            console.log('🔔 DEBUG - Scheduling with config:', JSON.stringify(alarmConfig));

            // Check if all required values are set (startTime can be 0 for midnight)
            if (frequency === 0 || count === 0) {
                console.warn('⚠️ Incomplete alarm configuration', { startTime, frequency, count });
                return;
            }

            console.log('\n🔔 ===== SCHEDULING ALARMS =====');
            console.log(`📅 Start: ${this._formatMinutes(startTime)}`);
            console.log(`⏱️  Every: ${frequency} minutes (${frequency / 60} hours)`);
            console.log(`🔢 Count: ${count} times`);

            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            this.service._scheduledAlarms = [];

            // Calculate all alarm times
            for (let i = 0; i < count; i++) {
                const alarmTimeMinutes = (startTime + (i * frequency)) % 1440; // Wrap at 24 hours
                const alarmTime = this._minutesToDate(alarmTimeMinutes);

                // If alarm time has passed today, schedule for tomorrow
                if (alarmTimeMinutes <= currentMinutes) {
                    alarmTime.setDate(alarmTime.getDate() + 1);
                }

                this.service._scheduledAlarms.push({
                    index: i,
                    timeMinutes: alarmTimeMinutes,
                    date: alarmTime
                });
            }

            // Sort by actual date/time
            this.service._scheduledAlarms.sort((a, b) => a.date - b.date);

            // Schedule each alarm
            this.service._scheduledAlarms.forEach((alarm, idx) => {
                const msUntilAlarm = alarm.date - now;

                console.log(`⏰ Alarm ${idx + 1}/${count}: ${this._formatMinutes(alarm.timeMinutes)} (in ${this._formatDuration(msUntilAlarm)})`);

                const timeout = setTimeout(() => {
                    this._triggerAlarm(idx + 1, count);
                }, msUntilAlarm);

                this.service._alarmTimeouts.push(timeout);
            });

            this._notifyStatusChange('armed');
            console.log('✅ All alarms scheduled!\n');
        }

        _triggerAlarm(alarmNumber, totalAlarms) {
            console.log(`\n🚨 ===== ALARM ${alarmNumber}/${totalAlarms} TRIGGERED! =====`);
            console.log(`🕐 Time: ${new Date().toLocaleTimeString()}`);

            this._notifyStatusChange('triggered');

            // Auto-dismiss after 30 seconds
            setTimeout(() => {
                console.log(`✓ Alarm ${alarmNumber} auto-dismissed`);
                this._notifyStatusChange('dismissed');

                // If there are more alarms, go back to armed state
                if (alarmNumber < totalAlarms) {
                    setTimeout(() => {
                        this._notifyStatusChange('armed');
                        console.log(`🔔 Waiting for next alarm...\n`);
                    }, 2000);
                } else {
                    setTimeout(() => {
                        this._notifyStatusChange('no_alarm');
                        console.log(`✅ All alarms completed\n`);
                    }, 2000);
                }
            }, 30000); // 30 seconds to dismiss
        }

        _cancelAllAlarms() {
            this.service._alarmTimeouts.forEach(timeout => clearTimeout(timeout));
            this.service._alarmTimeouts = [];
            this.service._scheduledAlarms = [];
        }

        _minutesToDate(minutes) {
            const date = new Date();
            date.setHours(Math.floor(minutes / 60));
            date.setMinutes(minutes % 60);
            date.setSeconds(0);
            date.setMilliseconds(0);
            return date;
        }

        _formatMinutes(minutes) {
            const hours = Math.floor(minutes / 60);
            const mins = minutes % 60;
            return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
        }

        _formatDuration(ms) {
            const seconds = Math.floor(ms / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);

            if (hours > 0) {
                return `${hours}h ${minutes % 60}m`;
            } else if (minutes > 0) {
                return `${minutes}m ${seconds % 60}s`;
            } else {
                return `${seconds}s`;
            }
        }

        async startNotifications() {
            await this._delay(50);
            this._notifying = true;
        }

        async stopNotifications() {
            await this._delay(50);
            this._notifying = false;
        }

        addEventListener(event, callback) {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }
            this._listeners[event].push(callback);
        }

        removeEventListener(event, callback) {
            if (this._listeners[event]) {
                this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
            }
        }

        _notifyStatusChange(status) {
            if (!this._notifying) return;

            const encoder = new TextEncoder();
            this._value = new DataView(encoder.encode(status).buffer);

            const event = {
                type: 'characteristicvaluechanged',
                target: this
            };

            if (this._listeners['characteristicvaluechanged']) {
                this._listeners['characteristicvaluechanged'].forEach(callback => callback(event));
            }
        }

        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    // Mock the navigator.bluetooth API
    class SimulatedBluetooth {
        constructor() {
            this.deviceCounter = 0;
        }

        async requestDevice(options) {
            await this._delay(1000);

            this.deviceCounter++;
            const device = new SimulatedBluetoothDevice(`Pillbox Simulator ${this.deviceCounter}`);

            console.log('🔵 Simulated Bluetooth: Device selected', device.name);

            return device;
        }

        async getAvailability() {
            return true;
        }

        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }
    }

    // Override navigator.bluetooth
    if (typeof navigator !== 'undefined') {
        Object.defineProperty(navigator, 'bluetooth', {
            value: new SimulatedBluetooth(),
            writable: false,
            configurable: true
        });

        console.log('🔵 ===== BLUETOOTH SIMULATOR INITIALIZED =====');
        console.log('🔵 Web Bluetooth API is now simulated');
        console.log('🔵 All device connections will be simulated');
        console.log('🔵 Alarms will trigger at scheduled times');
        console.log('🔵 Check console for alarm notifications\n');
    }

    // Export for module use
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            SimulatedBluetooth,
            SimulatedBluetoothDevice,
            SimulatedBluetoothRemoteGATTServer,
            SimulatedBluetoothRemoteGATTService,
            SimulatedBluetoothRemoteGATTCharacteristic
        };
    }

}