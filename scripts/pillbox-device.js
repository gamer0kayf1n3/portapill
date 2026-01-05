/**
 * pillbox-device.js
 * 
 * Core device logic and Bluetooth communication.
 * Handles connection, time sync, alarm configuration, and notifications.
 */

import { CONSTANTS, SERVICE_UUID, CHAR_UUIDS } from './constants.js';

export class PillboxDevice {
    /**
     * Creates a new PillboxDevice instance
     * @param {Number} id - Unique device identifier
     * @param {Object} savedData - Previously saved device data
     * @param {Object} uiManager - Reference to UIManager instance
     */
    constructor(id, savedData = null, uiManager = null) {
        this.id = id;
        this.name = savedData?.name || `Pillbox ${id}`;
        this.uiManager = uiManager;
        
        // Bluetooth objects
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        
        // UI components
        this.scrollers = {};
        
        // Intervals
        this.timeCheckInterval = null;
        this.clockUpdateInterval = null;
        this.nextAlarmUpdateInterval = null;
        
        // Connection state
        this.connected = false;
        this.connecting = false;
        this.shouldReconnect = false;
        this.reconnectAttempts = 0;
        this.deviceId = savedData?.deviceId || null;
        
        // Operation locking
        this.operationLock = false;
        
        // Data
        this.alarmConfig = savedData?.alarmConfig || {
            startTime: 0,
            frequency: 1,
            count: 1,
            nextAlarm: null
        };
        this.alarmHistory = savedData?.alarmHistory || [];
    }

    /**
     * Executes an operation with a lock to prevent concurrent operations
     * @param {Function} operation - Async operation to execute
     * @returns {Promise} Result of the operation
     */
    async withLock(operation) {
        while (this.operationLock) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        this.operationLock = true;
        try {
            return await operation();
        } finally {
            this.operationLock = false;
        }
    }

    /**
     * Connects to the Bluetooth device
     * @param {Boolean} isReconnect - Whether this is a reconnection attempt
     */
    async connect(isReconnect = false) {
        if (this.connecting || this.connected) return;
        
        return this.withLock(async () => {
            try {
                this.connecting = true;
                this._showMessage(
                    isReconnect ? 'Reconnecting...' : 'Connecting...', 
                    'info', 
                    true
                );

                // Try to connect with timeout
                const connectPromise = this.deviceId && isReconnect 
                    ? this._reconnectToDevice() 
                    : this._connectNewDevice();
                
                const timeoutPromise = new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Connection timeout')), CONSTANTS.CONNECTION_TIMEOUT)
                );
                
                await Promise.race([connectPromise, timeoutPromise]);

                // Set up disconnect handler
                this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());

                // Connect to GATT server
                this.server = await this.device.gatt.connect();
                this.service = await this.server.getPrimaryService(SERVICE_UUID);

                // Get all characteristics
                for (const [key, uuid] of Object.entries(CHAR_UUIDS)) {
                    try {
                        this.characteristics[key] = await this.service.getCharacteristic(uuid);
                    } catch (error) {
                        console.warn(`Characteristic ${key} not available:`, error);
                    }
                }

                // Subscribe to status notifications
                if (this.characteristics.status) {
                    await this.characteristics.status.startNotifications();
                    this.characteristics.status.addEventListener(
                        'characteristicvaluechanged', 
                        (event) => this._handleStatusChange(event)
                    );
                }

                // Update state
                this.connected = true;
                this.connecting = false;
                this.shouldReconnect = true;
                this.reconnectAttempts = 0;
                
                this._updateUI();
                this._showMessage('Connected!', 'success');

                // Initialize device
                await this.syncTime();
                await this.readAlarmConfig();
                this._startIntervals();

            } catch (error) {
                this.connecting = false;
                this.connected = false;
                this._updateUI();
                
                const message = error.message === 'Connection timeout'
                    ? 'Connection timeout. Please try again.'
                    : 'Connection failed: ' + error.message;
                
                this._showMessage(message, 'error');
                console.error('Connection error:', error);
            }
        });
    }

    /**
     * Reconnects to a previously paired device
     * @private
     */
    async _reconnectToDevice() {
        if (!this.deviceId) {
            throw new Error('No device ID stored');
        }

        const devices = await navigator.bluetooth.getDevices();
        this.device = devices.find(d => d.id === this.deviceId);
        
        if (!this.device) {
            throw new Error('Previously connected device not found');
        }
    }

    /**
     * Connects to a new device via pairing dialog
     * @private
     */
    async _connectNewDevice() {
        this.device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [SERVICE_UUID] }]
        });
        this.deviceId = this.device.id;
    }

    /**
     * Disconnects from the device
     */
    async disconnect() {
        this.shouldReconnect = false;
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
        }
    }

    /**
     * Handles device disconnection
     * @private
     */
    _onDisconnected() {
        this.connected = false;
        this._stopIntervals();
        this._updateUI();
        this._showMessage('Disconnected', 'error');

        // Auto-reconnect if appropriate
        if (this.shouldReconnect && this.reconnectAttempts < CONSTANTS.RECONNECT_MAX_ATTEMPTS) {
            this.reconnectAttempts++;
            setTimeout(() => {
                if (this.shouldReconnect) {
                    this.connect(true);
                }
            }, CONSTANTS.RECONNECT_DELAY);
        }
    }

    /**
     * Starts all update intervals
     * @private
     */
    _startIntervals() {
        this.timeCheckInterval = setInterval(
            () => this._checkAndSyncTime(), 
            CONSTANTS.TIME_SYNC_INTERVAL
        );
        
        this.clockUpdateInterval = setInterval(
            () => this._updateClock(), 
            CONSTANTS.CLOCK_UPDATE_INTERVAL
        );
        
        this.nextAlarmUpdateInterval = setInterval(
            () => this._updateNextAlarm(), 
            CONSTANTS.NEXT_ALARM_UPDATE_INTERVAL
        );
    }

    /**
     * Stops all update intervals
     * @private
     */
    _stopIntervals() {
        const intervals = [
            this.timeCheckInterval,
            this.clockUpdateInterval,
            this.nextAlarmUpdateInterval
        ];

        intervals.forEach(interval => {
            if (interval) clearInterval(interval);
        });

        this.timeCheckInterval = null;
        this.clockUpdateInterval = null;
        this.nextAlarmUpdateInterval = null;
    }

    /**
     * Synchronizes time with the device
     */
    async syncTime() {
        if (!this.characteristics.currentTime) return;

        try {
            const now = new Date();
            const secondsSinceMidnight = 
                now.getHours() * 3600 + 
                now.getMinutes() * 60 + 
                now.getSeconds();

            const view = new DataView(new ArrayBuffer(4));
            view.setUint32(0, secondsSinceMidnight, true);
            await this.characteristics.currentTime.writeValue(view);
        } catch (error) {
            console.error('Time sync failed:', error);
            this._showMessage('Time sync failed', 'error');
        }
    }

    /**
     * Checks device time and syncs if necessary
     * @private
     */
    async _checkAndSyncTime() {
        if (!this.characteristics.currentTime) return;

        try {
            // Get local time
            const now = new Date();
            const localSeconds = 
                now.getHours() * 3600 + 
                now.getMinutes() * 60 + 
                now.getSeconds();

            // Get device time
            const deviceView = await this.characteristics.currentTime.readValue();
            const deviceSeconds = deviceView.getUint32(0, true);

            // Calculate difference (handling midnight rollover)
            const diff = Math.abs(localSeconds - deviceSeconds);
            const diffAcrossMidnight = CONSTANTS.SECONDS_PER_DAY - diff;
            const actualDiff = Math.min(diff, diffAcrossMidnight);

            // Sync if difference exceeds threshold
            if (actualDiff > CONSTANTS.TIME_SYNC_THRESHOLD) {
                await this.syncTime();
            }

            this._displayTime(deviceSeconds);
        } catch (error) {
            console.error('Time check failed:', error);
        }
    }

    /**
     * Updates the clock display with current time
     * @private
     */
    _updateClock() {
        const now = new Date();
        const seconds = 
            now.getHours() * 3600 + 
            now.getMinutes() * 60 + 
            now.getSeconds();
        
        this._displayTime(seconds);
    }

    /**
     * Displays time in the UI
     * @private
     */
    _displayTime(seconds) {
        if (this.uiManager) {
            this.uiManager.updateTimeDisplay(this.id, seconds);
        }
    }

    /**
     * Updates next alarm display
     * @private
     */
    _updateNextAlarm() {
        if (this.uiManager) {
            this.uiManager.updateNextAlarmDisplay(this);
        }
    }

    /**
     * Calculates the next alarm time
     * @param {Number} startTimeMinutes - Start time in minutes since midnight
     * @param {Number} frequency - Hours between alarms
     * @param {Number} count - Number of alarms
     * @param {Number} fromMinutes - Current time (defaults to now)
     * @returns {Object} { nextAlarmMinutes, nextAlarmIndex }
     */
    calculateNextAlarm(startTimeMinutes, frequency, count, fromMinutes = null) {
        const now = fromMinutes !== null 
            ? fromMinutes 
            : (new Date().getHours() * 60 + new Date().getMinutes());

        let nextAlarmMinutes = null;
        let nextAlarmIndex = 0;

        // Check each alarm in the schedule
        for (let i = 0; i < count; i++) {
            let alarmTime = (startTimeMinutes + (i * frequency * 60)) % CONSTANTS.MINUTES_PER_DAY;
            
            if (alarmTime > now) {
                nextAlarmMinutes = alarmTime;
                nextAlarmIndex = i;
                break;
            }
        }

        // If no alarm found today, next is first alarm tomorrow
        if (nextAlarmMinutes === null && count > 0) {
            nextAlarmMinutes = startTimeMinutes % CONSTANTS.MINUTES_PER_DAY;
            nextAlarmIndex = 0;
        }

        return { nextAlarmMinutes, nextAlarmIndex };
    }

    /**
     * Reads alarm configuration from device
     */
    async readAlarmConfig() {
        if (!this.connected) return;

        try {
            // Read start time
            if (this.characteristics.startTime) {
                const view = await this.characteristics.startTime.readValue();
                this.alarmConfig.startTime = view.getUint32(0, true);
            }

            // Read frequency
            if (this.characteristics.frequency) {
                const view = await this.characteristics.frequency.readValue();
                this.alarmConfig.frequency = view.getUint32(0, true);
            }

            // Read count
            if (this.characteristics.count) {
                const view = await this.characteristics.count.readValue();
                this.alarmConfig.count = view.getUint16(0, true);
            }

            // Update UI if alarm is configured
            if (this.alarmConfig.startTime > 0) {
                this.alarmConfig.nextAlarm = true;
                this._updateScrollersFromConfig();
                this._updateNextAlarm();
            }
        } catch (error) {
            console.error('Failed to read alarm config:', error);
        }
    }

    /**
     * Updates scrollers to match current config
     * @private
     */
    _updateScrollersFromConfig() {
        if (!this.scrollers.hour || !this.scrollers.minute || 
            !this.scrollers.frequency || !this.scrollers.count) {
            return;
        }

        const hours = Math.floor(this.alarmConfig.startTime / 60);
        const minutes = this.alarmConfig.startTime % 60;

        this.scrollers.hour.setValue(hours);
        this.scrollers.minute.setValue(minutes);
        this.scrollers.frequency.setValue(this.alarmConfig.frequency);
        this.scrollers.count.setValue(this.alarmConfig.count);
    }

    /**
     * Sets the alarm configuration on the device
     */
    async setAlarm() {
        if (!this.connected) {
            this._showMessage('Please connect to device first', 'error');
            return;
        }

        return this.withLock(async () => {
            try {
                this._showMessage('Setting alarm...', 'info', true);

                // Get values from scrollers
                const hours = this.scrollers.hour.getValue();
                const minutes = this.scrollers.minute.getValue();
                const frequency = this.scrollers.frequency.getValue();
                const count = this.scrollers.count.getValue();
                const startTimeMinutes = hours * 60 + minutes;

                // Validate
                if (count < 1) {
                    this._showMessage('Count must be at least 1', 'error');
                    return;
                }
                if (frequency < 1) {
                    this._showMessage('Frequency must be at least 1 hour', 'error');
                    return;
                }

                // Sync time first
                await this.syncTime();

                // Write start time
                let view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, startTimeMinutes, true);
                await this.characteristics.startTime.writeValue(view);

                // Write frequency
                view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, frequency, true);
                await this.characteristics.frequency.writeValue(view);

                // Write count
                view = new DataView(new ArrayBuffer(2));
                view.setUint16(0, count, true);
                await this.characteristics.count.writeValue(view);

                // Update local config
                this.alarmConfig = {
                    startTime: startTimeMinutes,
                    frequency: frequency,
                    count: count,
                    nextAlarm: true
                };

                this._updateNextAlarm();
                this._showMessage('Alarm set!', 'success');

            } catch (error) {
                this._showMessage('Failed to set alarm: ' + error.message, 'error');
                console.error('Set alarm error:', error);
            }
        });
    }

    /**
     * Resets the device (clears all alarms)
     */
    async reset() {
        if (!this.connected) {
            this._showMessage('Please connect to device first', 'error');
            return;
        }

        const confirmed = confirm(`Reset ${this.name}? This will clear all alarms.`);
        if (!confirmed) return;

        return this.withLock(async () => {
            try {
                this._showMessage('Resetting...', 'info', true);

                const view = new DataView(new ArrayBuffer(1));
                view.setUint8(0, 1);
                await this.characteristics.reset.writeValue(view);

                // Clear local config
                this.alarmConfig = {
                    startTime: 0,
                    frequency: 1,
                    count: 1,
                    nextAlarm: null
                };

                this._updateNextAlarm();
                this._showMessage('Reset successful!', 'success');

            } catch (error) {
                this._showMessage('Reset failed: ' + error.message, 'error');
                console.error('Reset error:', error);
            }
        });
    }

    /**
     * Handles status change notifications from device
     * @private
     */
    _handleStatusChange(event) {
        const decoder = new TextDecoder();
        const status = decoder.decode(event.target.value);

        if (this.uiManager) {
            this.uiManager.updateAlarmStatus(this.id, status);
        }

        if (status === 'triggered') {
            this._showMessage('⏰ Alarm triggered!', 'error');
            this._addToHistory('triggered');
        } else if (status === 'dismissed') {
            this._showMessage('✓ Dismissed', 'success');
            this._addToHistory('dismissed');
        }
    }

    /**
     * Adds an entry to alarm history
     * @private
     */
    _addToHistory(action) {
        const entry = {
            timestamp: new Date().toISOString(),
            action: action,
            alarmTime: this.alarmConfig.nextAlarm
                ? `${Math.floor(this.alarmConfig.startTime / 60)}:${String(this.alarmConfig.startTime % 60).padStart(2, '0')}`
                : 'Unknown'
        };

        this.alarmHistory.unshift(entry);

        // Limit history size
        if (this.alarmHistory.length > CONSTANTS.MAX_HISTORY_ENTRIES) {
            this.alarmHistory = this.alarmHistory.slice(0, CONSTANTS.MAX_HISTORY_ENTRIES);
        }

        if (this.uiManager) {
            this.uiManager.updateHistoryDisplay(this);
        }
    }

    /**
     * Updates device name
     * @param {String} newName - New name for device
     */
    updateName(newName) {
        const escaped = this.uiManager 
            ? this.uiManager.escapeHtml(newName) 
            : newName;
        
        this.name = escaped || `Pillbox ${this.id}`;
    }

    /**
     * Shows a message in the UI
     * @private
     */
    _showMessage(message, type, persist = false) {
        if (this.uiManager) {
            this.uiManager.showMessage(this.id, message, type, persist);
        }
    }

    /**
     * Updates the UI
     * @private
     */
    _updateUI() {
        if (this.uiManager) {
            this.uiManager.updateDeviceUI(this);
        }
    }

    /**
     * Cleans up device resources
     */
    destroy() {
        this.shouldReconnect = false;
        if (this.connected) {
            this.disconnect();
        }
        this._stopIntervals();
    }

    /**
     * Converts device to JSON for storage
     * @returns {Object} Serializable device data
     */
    toJSON() {
        return {
            id: this.id,
            name: this.name,
            deviceId: this.deviceId,
            alarmConfig: this.alarmConfig,
            alarmHistory: this.alarmHistory
        };
    }
}