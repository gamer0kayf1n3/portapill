/**
 * ui-manager.js
 * 
 * Manages all DOM manipulation and UI rendering.
 * Keeps UI logic separate from business logic.
 */

import { CONSTANTS } from './constants.js';

export class UIManager {
    constructor() {
        this.currentDeviceId = null;
        this.messageTimeouts = new Map();
    }

    /**
     * Escapes HTML to prevent XSS attacks
     * @param {String} text - Text to escape
     * @returns {String} HTML-safe text
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Renders the list of devices in the home screen
     * @param {Array} devices - Array of PillboxDevice instances
     */
    renderDeviceList(devices) {
        const container = document.getElementById('pillboxList');
        if (!container) return;

        if (devices.length === 0) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = devices.map(device => this._renderDeviceCard(device)).join('');
    }

    /**
     * Renders a single device card
     * @private
     */
    _renderDeviceCard(device) {
        const status = device.connected ? 'Connected' : 'Disconnected';
        const configText = this._getDeviceConfigText(device);
        
        return `
            <div class="pillboxListEl" 
                 onclick="window.app.openDeviceForm(${device.id})" 
                 role="button" 
                 aria-label="Open ${this.escapeHtml(device.name)} configuration" 
                 tabindex="0">
                <p class="pillboxName">${this.escapeHtml(device.name)}</p>
                <p class="pillboxStatus">${status}</p>
                <p class="pillboxConfig">${configText}</p>
            </div>
        `;
    }

    /**
     * Gets the configuration text for a device card
     * @private
     */
    _getDeviceConfigText(device) {
        if (!device.alarmConfig.nextAlarm) {
            return 'Not configured';
        }

        const { nextAlarmMinutes, nextAlarmIndex } = device.calculateNextAlarm(
            device.alarmConfig.startTime,
            device.alarmConfig.frequency,
            device.alarmConfig.count
        );

        if (nextAlarmMinutes === null) {
            return 'No upcoming alarms';
        }

        const hours = Math.floor(nextAlarmMinutes / 60);
        const minutes = nextAlarmMinutes % 60;
        return `Next: ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} - Dose ${nextAlarmIndex + 1}/${device.alarmConfig.count} every ${device.alarmConfig.frequency}h`;
    }

    /**
     * Opens the device configuration modal
     * @param {PillboxDevice} device - Device to configure
     * @param {Function} createNumberScroller - Scroller factory function
     * @param {Function} createSeparator - Separator factory function
     */
    openDeviceModal(device, createNumberScroller, createSeparator) {
        this.currentDeviceId = device.id;
        
        const formContainer = document.getElementById('deviceFormContainer');
        if (!formContainer) return;

        // Build the modal content
        formContainer.innerHTML = this._buildDeviceModalHTML(device);

        // Create scrollers
        this._initializeScrollers(device, createNumberScroller, createSeparator);

        // Show modal
        const modal = document.getElementById('deviceFormModal');
        if (modal) {
            modal.classList.remove('hidden');
        }

        // Update UI elements
        this.updateDeviceUI(device);
    }

    /**
     * Builds the HTML for device modal
     * @private
     */
    _buildDeviceModalHTML(device) {
        return `
            <div class="device-header">
                <div id="container-${device.id}" class="container"></div>
                <div id="alarmPreview-${device.id}" 
                     style="display:none;color:white;text-align:center;padding:8px;font-size:12px">
                </div>
            </div>
            <div class="device-name">
                <input type="text" 
                       value="${this.escapeHtml(device.name)}" 
                       onchange="window.app.updateDeviceName(${device.id}, this.value)" 
                       aria-label="Device name">
            </div>
            <div id="message-${device.id}" class="message hidden"></div>
            <div class="status-bar">
                <div class="status-item">
                    <span id="connectionStatus-${device.id}" class="connection-badge disconnected">Disconnected</span>
                    <span id="alarmStatus-${device.id}" class="status-badge status-no_alarm">no_alarm</span>
                    <span id="deviceTime-${device.id}" class="status-value">--:--:--</span>
                    <span class="status-label">Next Alarm:</span>
                    <span id="nextAlarm-${device.id}" class="status-value">Not set</span>
                </div>
            </div>
            <div class="button-group">
                <button class="remove-btn" 
                        onclick="window.app.removeDevice(${device.id})" 
                        aria-label="Remove device">Remove Device</button>
                <button id="connectBtn-${device.id}" 
                        class="btn-connect" 
                        onclick="window.app.connectDevice(${device.id})" 
                        aria-label="Connect">Connect</button>
                <button id="disconnectBtn-${device.id}" 
                        class="btn-disconnect hidden" 
                        onclick="window.app.disconnectDevice(${device.id})" 
                        aria-label="Disconnect">Disconnect</button>
                <button id="setAlarmBtn-${device.id}" 
                        class="btn-primary" 
                        disabled 
                        onclick="window.app.setDeviceAlarm(${device.id})" 
                        aria-label="Set alarm">Set Alarm</button>
                <button id="resetBtn-${device.id}" 
                        class="btn-danger" 
                        disabled 
                        onclick="window.app.resetDevice(${device.id})" 
                        aria-label="Reset">Reset</button>
            </div>
            <div style="margin-top:20px;padding:16px;background:#f5f5f5;border-radius:8px">
                <h4 style="margin:0 0 12px 0;font-size:14px">Alarm History</h4>
                <div id="history-${device.id}"></div>
            </div>
        `;
    }

    /**
     * Initializes the number scrollers in the modal
     * @private
     */
    _initializeScrollers(device, createNumberScroller, createSeparator) {
        const container = document.getElementById(`container-${device.id}`);
        if (!container) return;

        container.innerHTML = '';

        // Count scroller
        device.scrollers.count = createNumberScroller(
            1, 99, 
            device.alarmConfig.count || 1, 
            `count-${device.id}`
        );
        container.appendChild(device.scrollers.count.element);
        container.appendChild(createSeparator('times every'));

        // Frequency scroller
        device.scrollers.frequency = createNumberScroller(
            1, 24, 
            device.alarmConfig.frequency || 1, 
            `frequency-${device.id}`
        );
        container.appendChild(device.scrollers.frequency.element);
        container.appendChild(createSeparator('hours starting'));

        // Hour scroller
        const hours = Math.floor((device.alarmConfig.startTime || 0) / 60);
        device.scrollers.hour = createNumberScroller(
            0, 23, 
            hours, 
            `hour-${device.id}`
        );
        container.appendChild(device.scrollers.hour.element);
        container.appendChild(createSeparator(':'));

        // Minute scroller
        const minutes = (device.alarmConfig.startTime || 0) % 60;
        device.scrollers.minute = createNumberScroller(
            0, 59, 
            minutes, 
            `minute-${device.id}`
        );
        container.appendChild(device.scrollers.minute.element);

        // Add scroll listener for preview
        container.addEventListener('scroll', () => {
            this.updateAlarmPreview(device);
        }, true);
    }

    /**
     * Closes the device configuration modal
     */
    closeDeviceModal() {
        const modal = document.getElementById('deviceFormModal');
        if (modal) {
            modal.classList.add('hidden');
        }
        this.currentDeviceId = null;
    }

    /**
     * Updates all UI elements for a device
     * @param {PillboxDevice} device - Device to update
     */
    updateDeviceUI(device) {
        this._updateConnectionStatus(device);
        this._updateButtons(device);
        this.updateHistoryDisplay(device);
        this.updateNextAlarmDisplay(device);
    }

    /**
     * Updates connection status badge
     * @private
     */
    _updateConnectionStatus(device) {
        const statusEl = document.getElementById(`connectionStatus-${device.id}`);
        if (!statusEl) return;

        if (device.connecting) {
            statusEl.textContent = 'Connecting...';
            statusEl.className = 'connection-badge connecting';
        } else if (device.connected) {
            statusEl.textContent = 'Connected';
            statusEl.className = 'connection-badge connected';
        } else {
            statusEl.textContent = 'Disconnected';
            statusEl.className = 'connection-badge disconnected';
        }
    }

    /**
     * Updates button states
     * @private
     */
    _updateButtons(device) {
        const connectBtn = document.getElementById(`connectBtn-${device.id}`);
        const disconnectBtn = document.getElementById(`disconnectBtn-${device.id}`);
        const setAlarmBtn = document.getElementById(`setAlarmBtn-${device.id}`);
        const resetBtn = document.getElementById(`resetBtn-${device.id}`);

        if (connectBtn) {
            connectBtn.classList.toggle('hidden', device.connected || device.connecting);
            connectBtn.disabled = device.connecting;
        }

        if (disconnectBtn) {
            disconnectBtn.classList.toggle('hidden', !device.connected);
        }

        if (setAlarmBtn) {
            setAlarmBtn.disabled = !device.connected;
        }

        if (resetBtn) {
            resetBtn.disabled = !device.connected;
        }
    }

    /**
     * Updates the device time display
     * @param {Number} deviceId - Device ID
     * @param {Number} seconds - Seconds since midnight
     */
    updateTimeDisplay(deviceId, seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const timeEl = document.getElementById(`deviceTime-${deviceId}`);
        if (timeEl) {
            timeEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    }

    /**
     * Updates the next alarm display
     * @param {PillboxDevice} device - Device to update
     */
    updateNextAlarmDisplay(device) {
        const alarmEl = document.getElementById(`nextAlarm-${device.id}`);
        if (!alarmEl) return;

        if (!device.alarmConfig.nextAlarm) {
            alarmEl.textContent = 'Not set';
            return;
        }

        const { nextAlarmMinutes, nextAlarmIndex } = device.calculateNextAlarm(
            device.alarmConfig.startTime,
            device.alarmConfig.frequency,
            device.alarmConfig.count
        );

        if (nextAlarmMinutes !== null) {
            const hours = Math.floor(nextAlarmMinutes / 60);
            const minutes = nextAlarmMinutes % 60;
            alarmEl.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} (${nextAlarmIndex + 1}/${device.alarmConfig.count})`;
        } else {
            alarmEl.textContent = 'Not set';
        }
    }

    /**
     * Updates the alarm preview when scrollers change
     * @param {PillboxDevice} device - Device to preview
     */
    updateAlarmPreview(device) {
        if (!device.scrollers.hour) return;

        const hours = device.scrollers.hour.getValue();
        const minutes = device.scrollers.minute.getValue();
        const frequency = device.scrollers.frequency.getValue();
        const count = device.scrollers.count.getValue();

        const startTimeMinutes = hours * 60 + minutes;
        const { nextAlarmMinutes, nextAlarmIndex } = device.calculateNextAlarm(
            startTimeMinutes, 
            frequency, 
            count
        );

        const previewEl = document.getElementById(`alarmPreview-${device.id}`);
        if (previewEl && nextAlarmMinutes !== null) {
            const alarmHours = Math.floor(nextAlarmMinutes / 60);
            const alarmMinutes = nextAlarmMinutes % 60;
            previewEl.textContent = `Preview: ${String(alarmHours).padStart(2, '0')}:${String(alarmMinutes).padStart(2, '0')} (${nextAlarmIndex + 1}/${count})`;
            previewEl.style.display = 'block';
        }
    }

    /**
     * Updates the alarm status badge
     * @param {Number} deviceId - Device ID
     * @param {String} status - Status text (triggered, dismissed, no_alarm)
     */
    updateAlarmStatus(deviceId, status) {
        const badge = document.getElementById(`alarmStatus-${deviceId}`);
        if (badge) {
            badge.textContent = status;
            badge.className = `status-badge status-${status}`;
        }
    }

    /**
     * Updates the alarm history display
     * @param {PillboxDevice} device - Device to update
     */
    updateHistoryDisplay(device) {
        const historyContainer = document.getElementById(`history-${device.id}`);
        if (!historyContainer) return;

        if (device.alarmHistory.length === 0) {
            historyContainer.innerHTML = '<p style="color:#999;font-size:12px">No history yet</p>';
            return;
        }

        const historyHTML = device.alarmHistory.slice(0, 10).map(entry => {
            const date = new Date(entry.timestamp);
            const time = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            const actionText = entry.action === 'triggered' ? '⏰ Triggered' : '✓ Dismissed';

            return `
                <div style="padding:8px 0;border-bottom:1px solid #eee;font-size:12px">
                    <div style="display:flex;justify-content:space-between">
                        <span style="font-weight:600">${actionText}</span>
                        <span style="color:#666">${dateStr} ${time}</span>
                    </div>
                </div>
            `;
        }).join('');

        historyContainer.innerHTML = historyHTML;
    }

    /**
     * Shows a message to the user
     * @param {Number} deviceId - Device ID
     * @param {String} message - Message text
     * @param {String} type - Message type (success, error, info)
     * @param {Boolean} persist - Whether to keep message visible
     */
    showMessage(deviceId, message, type = 'info', persist = false) {
        const messageEl = document.getElementById(`message-${deviceId}`);
        if (!messageEl) return;

        messageEl.textContent = message;
        messageEl.className = `message ${type}`;
        messageEl.classList.remove('hidden');

        // Clear existing timeout
        if (this.messageTimeouts.has(deviceId)) {
            clearTimeout(this.messageTimeouts.get(deviceId));
        }

        // Set new timeout unless persistent
        if (!persist) {
            const timeout = setTimeout(() => {
                messageEl.classList.add('hidden');
                this.messageTimeouts.delete(deviceId);
            }, CONSTANTS.MESSAGE_TIMEOUT);
            
            this.messageTimeouts.set(deviceId, timeout);
        }
    }

    /**
     * Gets the current device ID from open modal
     * @returns {Number|null} Device ID or null
     */
    getCurrentDeviceId() {
        return this.currentDeviceId;
    }
}