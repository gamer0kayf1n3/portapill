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
        if (this.connecting || this.connected) {
            console.log('Already connecting or connected, skipping...');
            return;
        }

        return this.withLock(async () => {
            try {
                this.connecting = true;
                this._showMessage(
                    isReconnect ? 'Reconnecting...' : 'Connecting...',
                    'info',
                    true
                );

                console.log(`[${new Date().toLocaleTimeString()}] Starting connection...`);

                // Try to connect with extended timeout
                const connectPromise = this.deviceId && isReconnect
                    ? this._reconnectToDevice()
                    : this._connectNewDevice();

                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Connection timeout')), CONSTANTS.CONNECTION_TIMEOUT)
                );

                // Replace the connection section (lines ~104-145) with this:

                console.log('Requesting device...');
                await Promise.race([connectPromise, timeoutPromise]);
                console.log('Device acquired:', this.device?.name || 'Unknown');

                // Check if device still exists and has GATT
                if (!this.device || !this.device.gatt) {
                    throw new Error('Device lost after acquisition');
                }

                // Small delay to let device settle
                await new Promise(resolve => setTimeout(resolve, 500));

                // IMPORTANT: Set up disconnect handler AFTER we're fully connected
                // Don't set it up here to avoid premature disconnection handling

                // Ensure clean state before connecting
                if (this.device.gatt.connected) {
                    console.log('Device GATT already connected, disconnecting first...');
                    try {
                        await this.device.gatt.disconnect();
                    } catch (e) {
                        console.log('Disconnect error (ignoring):', e.message);
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // Connect to GATT server with explicit timeout and retry logic
                console.log('Connecting to GATT server...');
                let gattAttempts = 0;
                const maxGattAttempts = 3;

                while (gattAttempts < maxGattAttempts) {
                    try {
                        gattAttempts++;
                        console.log(`GATT connection attempt ${gattAttempts}/${maxGattAttempts}...`);

                        const gattConnectPromise = this.device.gatt.connect();
                        const gattTimeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('GATT connection timeout')), 20000)
                        );

                        this.server = await Promise.race([gattConnectPromise, gattTimeoutPromise]);

                        // Verify connection
                        if (this.server && this.server.connected) {
                            console.log('GATT connection successful!');
                            break;
                        } else {
                            throw new Error('GATT server not connected after connect()');
                        }
                    } catch (error) {
                        console.error(`GATT attempt ${gattAttempts} failed:`, error.message);

                        if (gattAttempts >= maxGattAttempts) {
                            throw new Error(`GATT connection failed after ${maxGattAttempts} attempts: ${error.message}`);
                        }

                        // Wait before retry
                        console.log('Waiting before retry...');
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }

                // Verify GATT is actually connected
                if (!this.server || !this.server.connected) {
                    throw new Error('GATT connection failed - server not connected');
                }

                console.log('GATT connected, getting service...');

                // Get service with timeout
                const servicePromise = this.server.getPrimaryService(SERVICE_UUID);
                const serviceTimeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Service discovery timeout')), 8000) // Increased timeout
                );

                this.service = await Promise.race([servicePromise, serviceTimeoutPromise]);
                console.log('Service found, getting characteristics...');

                // Get all characteristics with timeout
                const charPromises = Object.entries(CHAR_UUIDS).map(async ([key, uuid]) => {
                    try {
                        const charPromise = this.service.getCharacteristic(uuid);
                        const charTimeout = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error(`Characteristic ${key} timeout`)), 5000) // Increased timeout
                        );
                        this.characteristics[key] = await Promise.race([charPromise, charTimeout]);
                        console.log(`✓ Characteristic ${key} acquired`);
                    } catch (error) {
                        console.warn(`✗ Characteristic ${key} not available:`, error.message);
                    }
                });

                await Promise.all(charPromises);
                console.log('All characteristics processed');

                // NOW set up disconnect handler after everything is ready
                if (this.device._disconnectHandler) {
                    this.device.removeEventListener('gattserverdisconnected', this.device._disconnectHandler);
                }
                this.device._disconnectHandler = () => this._onDisconnected();
                this.device.addEventListener('gattserverdisconnected', this.device._disconnectHandler);

                // Subscribe to status notifications
                if (this.characteristics.status) {
                    console.log('Starting status notifications...');
                    await this.characteristics.status.startNotifications();
                    this.characteristics.status.addEventListener(
                        'characteristicvaluechanged',
                        (event) => this._handleStatusChange(event)
                    );
                    console.log('✓ Status notifications active');
                }

                // Update state
                this.connected = true;
                this.connecting = false;
                this.shouldReconnect = true;
                this.reconnectAttempts = 0;

                console.log(`[${new Date().toLocaleTimeString()}] Connection successful!`);
                this._updateUI();
                this._showMessage('Connected!', 'success');

                // Initialize device
                console.log('Syncing time...');
                await this.syncTime();
                console.log('Reading alarm config...');
                await this.readAlarmConfig();
                console.log('Starting intervals...');
                this._startIntervals();
                console.log('Device fully initialized');

            } catch (error) {
                this.connecting = false;
                this.connected = false;

                // Clear references on failure
                this.server = null;
                this.service = null;
                this.characteristics = {};

                this._updateUI();

                console.error(`[${new Date().toLocaleTimeString()}] Connection error:`, error);

                let message;
                if (error.message === 'Connection timeout') {
                    message = 'Connection timeout. Device may be busy or out of range.';
                } else if (error.message === 'Device lost after acquisition') {
                    message = 'Device disconnected during pairing. Try again.';
                } else if (error.message === 'GATT connection timeout') {
                    message = 'GATT connection timeout. Try again.';
                } else if (error.message.includes('GATT connection failed')) {
                    message = 'GATT connection failed. Device may need reset.';
                } else if (error.message.includes('Service discovery timeout')) {
                    message = 'Service discovery timeout. Device may need reset.';
                } else if (error.message.includes('GATT Server is disconnected')) {
                    message = 'Device disconnected unexpectedly. Try again.';
                } else if (error.message.includes('pair again')) {
                    message = 'Device not found. Please reconnect manually.';
                } else {
                    message = 'Connection failed: ' + error.message;
                }

                this._showMessage(message, 'error');

                // Don't retry if device needs re-pairing
                if (error.message.includes('pair again')) {
                    this.shouldReconnect = false;
                    this.deviceId = null;
                }
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

        try {
            console.log('[RECONNECT] Attempting to find device with ID:', this.deviceId);

            // Try to get previously paired devices
            const devices = await navigator.bluetooth.getDevices();
            console.log('[RECONNECT] Found', devices.length, 'paired device(s)');

            this.device = devices.find(d => d.id === this.deviceId);

            if (!this.device) {
                console.log('[RECONNECT] Device not in paired list, clearing deviceId and requesting new pairing');
                // Device not found, clear deviceId so user can pair fresh
                this.deviceId = null;

                // Try fresh pairing instead of failing
                console.log('[RECONNECT] Requesting fresh device pairing...');
                this.device = await navigator.bluetooth.requestDevice({
                    filters: [{ services: [SERVICE_UUID] }]
                });
                this.deviceId = this.device.id;
                console.log('[RECONNECT] Fresh pairing successful, new ID:', this.deviceId);
                return;
            }

            // Check if device is already connected (shouldn't be, but handle it)
            if (this.device.gatt.connected) {
                console.log('[RECONNECT] Device already connected, disconnecting first...');
                await this.device.gatt.disconnect();
                // Wait a bit before reconnecting
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log('[RECONNECT] Device found, ready to connect');

        } catch (error) {
            console.error('[RECONNECT] Reconnection preparation failed:', error);
            throw error;
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
        this.reconnectAttempts = 0;

        if (this.device) {
            // Remove disconnect handler to prevent reconnection
            if (this.device._disconnectHandler) {
                this.device.removeEventListener('gattserverdisconnected', this.device._disconnectHandler);
                this.device._disconnectHandler = null;
            }

            if (this.device.gatt && this.device.gatt.connected) {
                await this.device.gatt.disconnect();
            }
        }

        // Clear all references
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.connected = false;
        this._updateUI();
    }

    /**
     * Handles device disconnection
     * @private
     */
    _onDisconnected() {
        this.connected = false;
        this._stopIntervals();

        // Clear stale Bluetooth references
        this.server = null;
        this.service = null;
        this.characteristics = {};

        this._updateUI();
        this._showMessage('Disconnected', 'error');

        // Auto-reconnect if appropriate
        if (this.shouldReconnect && this.reconnectAttempts < CONSTANTS.RECONNECT_MAX_ATTEMPTS) {
            this.reconnectAttempts++;
            const delay = CONSTANTS.RECONNECT_DELAY * this.reconnectAttempts;

            console.log(`[DISCONNECT] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${CONSTANTS.RECONNECT_MAX_ATTEMPTS})`);

            setTimeout(() => {
                if (this.shouldReconnect) {
                    this.connect(true);
                }
            }, delay);
        } else if (this.reconnectAttempts >= CONSTANTS.RECONNECT_MAX_ATTEMPTS) {
            this._showMessage('Auto-reconnect failed. Click Connect to retry.', 'error');
            this.shouldReconnect = false;
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
            let deviceStartTime = 0;
            let deviceFrequency = 0;
            let deviceCount = 0;

            // Read start time (in minutes)
            if (this.characteristics.startTime) {
                const view = await this.characteristics.startTime.readValue();
                deviceStartTime = view.getUint32(0, true);
            }

            // Read frequency (in minutes, but represents hours)
            if (this.characteristics.frequency) {
                const view = await this.characteristics.frequency.readValue();
                const frequencyMinutes = view.getUint32(0, true);
                deviceFrequency = Math.round(frequencyMinutes / 60); // Convert to hours
            }

            // Read count
            if (this.characteristics.count) {
                const view = await this.characteristics.count.readValue();
                deviceCount = view.getUint16(0, true);
            }

            console.log('[CONFIG] Device config read:', {
                startTime: deviceStartTime,
                frequency: deviceFrequency,
                count: deviceCount
            });

            console.log('[CONFIG] Client saved config:', {
                startTime: this.alarmConfig.startTime,
                frequency: this.alarmConfig.frequency,
                count: this.alarmConfig.count,
                nextAlarm: this.alarmConfig.nextAlarm
            });

            // Check if device has been reset (all zeros) but client has saved config
            const deviceIsCleared = (deviceStartTime === 0 && deviceFrequency === 0 && deviceCount === 0);
            const clientHasConfig = (this.alarmConfig.nextAlarm === true &&
                this.alarmConfig.startTime > 0 &&
                this.alarmConfig.count > 0);

            console.log('[CONFIG] Device cleared:', deviceIsCleared, 'Client has config:', clientHasConfig);

            if (deviceIsCleared && clientHasConfig) {
                console.log('[CONFIG] Device was reset but client has saved config');
                console.log('[CONFIG] Restoring client config to device:', this.alarmConfig);
                this._showMessage('Restoring previous alarm...', 'info', true);

                // Wait a moment for device to be ready
                await new Promise(resolve => setTimeout(resolve, 500));

                // Restore config to device
                await this._restoreConfigToDevice();
                this._showMessage('Previous alarm restored!', 'success');
            } else if (!deviceIsCleared) {
                // Device has config, update local state
                this.alarmConfig.startTime = deviceStartTime;
                this.alarmConfig.frequency = deviceFrequency;
                this.alarmConfig.count = deviceCount;

                if (deviceStartTime > 0) {
                    this.alarmConfig.nextAlarm = true;
                    this._updateScrollersFromConfig();
                    this._updateNextAlarm();
                    console.log('[CONFIG] Loaded config from device');
                }
            } else {
                console.log('[CONFIG] Both device and client have no config');
            }
        } catch (error) {
            console.error('[CONFIG] Failed to read alarm config:', error);
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

                // Convert start time to decimal hours (e.g., 7:30 = 7.5 hours)
                const startTimeHours = hours + (minutes / 60);

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

                // Write start time (as minutes for backward compatibility with storage)
                let view = new DataView(new ArrayBuffer(4));
                const startTimeMinutes = hours * 60 + minutes;
                view.setUint32(0, startTimeMinutes, true);
                await this.characteristics.startTime.writeValue(view);

                // Write frequency (as minutes - will be interpreted as hours by ESP32)
                view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, frequency * 60, true); // Convert hours to minutes
                await this.characteristics.frequency.writeValue(view);

                // Write count
                view = new DataView(new ArrayBuffer(2));
                view.setUint16(0, count, true);
                await this.characteristics.count.writeValue(view);

                // Update local config (still store as minutes for compatibility)
                this.alarmConfig = {
                    startTime: startTimeMinutes,
                    frequency: frequency, // Store as hours
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

    async _restoreConfigToDevice() {
        try {
            console.log('[RESTORE] Starting config restoration...');

            // Sync time first
            console.log('[RESTORE] Syncing time...');
            await this.syncTime();

            // Write start time
            console.log('[RESTORE] Writing startTime:', this.alarmConfig.startTime);
            let view = new DataView(new ArrayBuffer(4));
            view.setUint32(0, this.alarmConfig.startTime, true);
            await this.characteristics.startTime.writeValue(view);

            // Write frequency (convert hours to minutes)
            const frequencyMinutes = this.alarmConfig.frequency * 60;
            console.log('[RESTORE] Writing frequency:', this.alarmConfig.frequency, 'hours (', frequencyMinutes, 'minutes)');
            view = new DataView(new ArrayBuffer(4));
            view.setUint32(0, frequencyMinutes, true);
            await this.characteristics.frequency.writeValue(view);

            // Write count
            console.log('[RESTORE] Writing count:', this.alarmConfig.count);
            view = new DataView(new ArrayBuffer(2));
            view.setUint16(0, this.alarmConfig.count, true);
            await this.characteristics.count.writeValue(view);

            console.log('[RESTORE] Successfully restored config to device');

            // Update UI
            this._updateScrollersFromConfig();
            this._updateNextAlarm();

            console.log('[RESTORE] UI updated');
        } catch (error) {
            console.error('[RESTORE] Failed to restore config:', error);
            this._showMessage('Failed to restore alarm: ' + error.message, 'error');
            throw error;
        }
    }

}