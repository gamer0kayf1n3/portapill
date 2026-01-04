// Constants
const CONSTANTS = {
    TIME_SYNC_INTERVAL: 10000,
    TIME_SYNC_THRESHOLD: 10,
    SECONDS_PER_DAY: 86400,
    MINUTES_PER_DAY: 1440,
    MESSAGE_TIMEOUT: 5000,
    CONNECTION_TIMEOUT: 30000,
    MAX_HISTORY_ENTRIES: 100,
    CLOCK_UPDATE_INTERVAL: 1000,
    NEXT_ALARM_UPDATE_INTERVAL: 60000,
    RECONNECT_DELAY: 2000,
    RECONNECT_MAX_ATTEMPTS: 3,
    STORAGE_KEY: 'pillbox_devices'
};

const SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214';
const CHAR_UUIDS = {
    startTime: '19b10001-e8f2-537e-4f6c-d104768a1214',
    frequency: '19b10002-e8f2-537e-4f6c-d104768a1214',
    count: '19b10003-e8f2-537e-4f6c-d104768a1214',
    status: '19b10004-e8f2-537e-4f6c-d104768a1214',
    currentTime: '19b10005-e8f2-537e-4f6c-d104768a1214',
    reset: '19b10006-e8f2-537e-4f6c-d104768a1214'
};

let devices = [];
let deviceIdCounter = 0;
let currentDeviceId = null;

class PillboxDevice {
    constructor(id, savedData = null) {
        this.id = id;
        this.name = savedData?.name || `Pillbox ${id}`;
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.scrollers = {};
        this.timeCheckInterval = null;
        this.clockUpdateInterval = null;
        this.nextAlarmUpdateInterval = null;
        this.connected = false;
        this.connecting = false;
        this.messageTimeout = null;
        this.reconnectAttempts = 0;
        this.shouldReconnect = false;
        this.alarmConfig = savedData?.alarmConfig || { startTime: 0, frequency: 1, count: 1, nextAlarm: null };
        this.alarmHistory = savedData?.alarmHistory || [];
        this.deviceId = savedData?.deviceId || null;
        this.operationLock = false;
    }

    async withLock(operation) {
        while (this.operationLock) await new Promise(r => setTimeout(r, 100));
        this.operationLock = true;
        try { return await operation(); } finally { this.operationLock = false; }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async connect(isReconnect = false) {
        if (this.connecting || this.connected) return;
        return this.withLock(async () => {
            try {
                this.connecting = true;
                this.showMessage(isReconnect ? 'Reconnecting...' : 'Connecting...', 'info', true);

                const connectPromise = this.deviceId && isReconnect ? this.reconnectToDevice() : this.connectNewDevice();
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), CONSTANTS.CONNECTION_TIMEOUT));
                await Promise.race([connectPromise, timeoutPromise]);

                this.device.addEventListener('gattserverdisconnected', () => this.onDisconnected());
                this.server = await this.device.gatt.connect();
                this.service = await this.server.getPrimaryService(SERVICE_UUID);

                for (const [key, uuid] of Object.entries(CHAR_UUIDS)) {
                    try { this.characteristics[key] = await this.service.getCharacteristic(uuid); }
                    catch (e) { console.warn(`Characteristic ${key} not available:`, e); }
                }

                if (this.characteristics.status) {
                    await this.characteristics.status.startNotifications();
                    this.characteristics.status.addEventListener('characteristicvaluechanged', (e) => this.handleStatusChange(e));
                }

                this.connected = true;
                this.connecting = false;
                this.shouldReconnect = true;
                this.reconnectAttempts = 0;
                this.updateUI();
                this.showMessage('Connected!', 'success');

                await this.syncTime();
                await this.readAlarmConfig();
                this.startIntervals();
                saveDevices();
            } catch (error) {
                this.connecting = false;
                this.connected = false;
                this.updateUI();
                this.showMessage(error.message === 'Connection timeout' ? 'Connection timeout. Please try again.' : 'Connection failed: ' + error.message, 'error');
                console.error('Connection error:', error);
            }
        });
    }

    async reconnectToDevice() {
        if (!this.deviceId) throw new Error('No device ID stored');
        const devices = await navigator.bluetooth.getDevices();
        this.device = devices.find(d => d.id === this.deviceId);
        if (!this.device) throw new Error('Previously connected device not found');
    }

    async connectNewDevice() {
        this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE_UUID] }] });
        this.deviceId = this.device.id;
    }

    async disconnect() {
        this.shouldReconnect = false;
        if (this.device && this.device.gatt.connected) await this.device.gatt.disconnect();
    }

    onDisconnected() {
        this.connected = false;
        this.stopIntervals();
        this.updateUI();
        this.showMessage('Disconnected', 'error');
        if (this.shouldReconnect && this.reconnectAttempts < CONSTANTS.RECONNECT_MAX_ATTEMPTS) {
            this.reconnectAttempts++;
            setTimeout(() => { if (this.shouldReconnect) this.connect(true); }, CONSTANTS.RECONNECT_DELAY);
        }
    }

    startIntervals() {
        this.timeCheckInterval = setInterval(() => this.checkAndSyncTime(), CONSTANTS.TIME_SYNC_INTERVAL);
        this.clockUpdateInterval = setInterval(() => this.updateClock(), CONSTANTS.CLOCK_UPDATE_INTERVAL);
        this.nextAlarmUpdateInterval = setInterval(() => this.updateNextAlarmDisplay(), CONSTANTS.NEXT_ALARM_UPDATE_INTERVAL);
    }

    stopIntervals() {
        [this.timeCheckInterval, this.clockUpdateInterval, this.nextAlarmUpdateInterval].forEach(i => { if (i) clearInterval(i); });
        this.timeCheckInterval = this.clockUpdateInterval = this.nextAlarmUpdateInterval = null;
    }

    async syncTime() {
        if (!this.characteristics.currentTime) return;
        try {
            const now = new Date();
            const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            const view = new DataView(new ArrayBuffer(4));
            view.setUint32(0, secondsSinceMidnight, true);
            await this.characteristics.currentTime.writeValue(view);
        } catch (error) {
            console.error('Time sync failed:', error);
            this.showMessage('Time sync failed', 'error');
        }
    }

    async checkAndSyncTime() {
        if (!this.characteristics.currentTime) return;
        try {
            const now = new Date();
            const localSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
            const deviceView = await this.characteristics.currentTime.readValue();
            const deviceSeconds = deviceView.getUint32(0, true);
            const diff = Math.abs(localSeconds - deviceSeconds);
            const diffAcrossMidnight = CONSTANTS.SECONDS_PER_DAY - diff;
            const actualDiff = Math.min(diff, diffAcrossMidnight);
            if (actualDiff > CONSTANTS.TIME_SYNC_THRESHOLD) await this.syncTime();
            this.displayTime(deviceSeconds);
        } catch (error) { console.error('Time check failed:', error); }
    }

    updateClock() {
        const now = new Date();
        const seconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        this.displayTime(seconds);
    }

    displayTime(seconds) {
        const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
        const el = document.getElementById(`deviceTime-${this.id}`);
        if (el) el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    calculateNextAlarm(startTimeMinutes, frequency, count, fromMinutes = null) {
        const now = fromMinutes !== null ? fromMinutes : (new Date().getHours() * 60 + new Date().getMinutes());
        let nextAlarmMinutes = null, nextAlarmIndex = 0;
        for (let i = 0; i < count; i++) {
            let alarmTime = (startTimeMinutes + (i * frequency * 60)) % CONSTANTS.MINUTES_PER_DAY;
            if (alarmTime > now) { nextAlarmMinutes = alarmTime; nextAlarmIndex = i; break; }
        }
        if (nextAlarmMinutes === null && count > 0) { nextAlarmMinutes = startTimeMinutes % CONSTANTS.MINUTES_PER_DAY; nextAlarmIndex = 0; }
        return { nextAlarmMinutes, nextAlarmIndex };
    }

    updateNextAlarmDisplay() {
        const el = document.getElementById(`nextAlarm-${this.id}`);
        if (!el) return;
        if (!this.alarmConfig.nextAlarm) { el.textContent = 'Not set'; return; }
        const { nextAlarmMinutes, nextAlarmIndex } = this.calculateNextAlarm(this.alarmConfig.startTime, this.alarmConfig.frequency, this.alarmConfig.count);
        if (nextAlarmMinutes !== null) {
            const h = Math.floor(nextAlarmMinutes / 60), m = nextAlarmMinutes % 60;
            el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (${nextAlarmIndex + 1}/${this.alarmConfig.count})`;
        }
    }

    async readAlarmConfig() {
        if (!this.connected) return;
        try {
            if (this.characteristics.startTime) {
                const v = await this.characteristics.startTime.readValue();
                this.alarmConfig.startTime = v.getUint32(0, true);
            }
            if (this.characteristics.frequency) {
                const v = await this.characteristics.frequency.readValue();
                this.alarmConfig.frequency = v.getUint32(0, true);
            }
            if (this.characteristics.count) {
                const v = await this.characteristics.count.readValue();
                this.alarmConfig.count = v.getUint16(0, true);
            }
            if (this.alarmConfig.startTime > 0) {
                this.alarmConfig.nextAlarm = true;
                this.updateScrollersFromConfig();
                this.updateNextAlarmDisplay();
            }
            saveDevices();
        } catch (error) { console.error('Failed to read alarm config:', error); }
    }

    updateScrollersFromConfig() {
        if (this.scrollers.hour && this.scrollers.minute && this.scrollers.frequency && this.scrollers.count) {
            const h = Math.floor(this.alarmConfig.startTime / 60), m = this.alarmConfig.startTime % 60;
            this.scrollers.hour.setValue(h);
            this.scrollers.minute.setValue(m);
            this.scrollers.frequency.setValue(this.alarmConfig.frequency);
            this.scrollers.count.setValue(this.alarmConfig.count);
        }
    }

    async setAlarm() {
        if (!this.connected) { this.showMessage('Please connect to device first', 'error'); return; }
        return this.withLock(async () => {
            try {
                this.showMessage('Setting alarm...', 'info', true);
                const hours = this.scrollers.hour.getValue(), minutes = this.scrollers.minute.getValue();
                const frequencyValue = this.scrollers.frequency.getValue(), countValue = this.scrollers.count.getValue();
                const startTimeMinutes = hours * 60 + minutes;
                if (countValue < 1) { this.showMessage('Count must be at least 1', 'error'); return; }
                if (frequencyValue < 1) { this.showMessage('Frequency must be at least 1 hour', 'error'); return; }
                await this.syncTime();
                let view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, startTimeMinutes, true);
                await this.characteristics.startTime.writeValue(view);
                view = new DataView(new ArrayBuffer(4));
                view.setUint32(0, frequencyValue, true);
                await this.characteristics.frequency.writeValue(view);
                view = new DataView(new ArrayBuffer(2));
                view.setUint16(0, countValue, true);
                await this.characteristics.count.writeValue(view);
                this.alarmConfig = { startTime: startTimeMinutes, frequency: frequencyValue, count: countValue, nextAlarm: true };
                this.updateNextAlarmDisplay();
                this.showMessage('Alarm set!', 'success');
                saveDevices();
            } catch (error) {
                this.showMessage('Failed to set alarm: ' + error.message, 'error');
                console.error('Set alarm error:', error);
            }
        });
    }

    async reset() {
        if (!this.connected) { this.showMessage('Please connect to device first', 'error'); return; }
        const confirmed = confirm(`Reset ${this.name}? This will clear all alarms.`);
        if (!confirmed) return;
        return this.withLock(async () => {
            try {
                this.showMessage('Resetting...', 'info', true);
                const view = new DataView(new ArrayBuffer(1));
                view.setUint8(0, 1);
                await this.characteristics.reset.writeValue(view);
                this.alarmConfig = { startTime: 0, frequency: 1, count: 1, nextAlarm: null };
                const el = document.getElementById(`nextAlarm-${this.id}`);
                if (el) el.textContent = 'Not set';
                this.showMessage('Reset successful!', 'success');
                saveDevices();
            } catch (error) {
                this.showMessage('Reset failed: ' + error.message, 'error');
                console.error('Reset error:', error);
            }
        });
    }

    handleStatusChange(event) {
        const decoder = new TextDecoder();
        const status = decoder.decode(event.target.value);
        const badge = document.getElementById(`alarmStatus-${this.id}`);
        if (badge) {
            badge.textContent = status;
            badge.className = 'status-badge status-' + status;
        }
        if (status === 'triggered') { this.showMessage('⏰ Alarm triggered!', 'error'); this.addToHistory('triggered'); }
        else if (status === 'dismissed') { this.showMessage('✓ Dismissed', 'success'); this.addToHistory('dismissed'); }
    }

    addToHistory(action) {
        const entry = {
            timestamp: new Date().toISOString(),
            action: action,
            alarmTime: this.alarmConfig.nextAlarm ? `${Math.floor(this.alarmConfig.startTime / 60)}:${String(this.alarmConfig.startTime % 60).padStart(2, '0')}` : 'Unknown'
        };
        this.alarmHistory.unshift(entry);
        if (this.alarmHistory.length > CONSTANTS.MAX_HISTORY_ENTRIES) this.alarmHistory = this.alarmHistory.slice(0, CONSTANTS.MAX_HISTORY_ENTRIES);
        saveDevices();
        this.updateHistoryDisplay();
    }

    updateHistoryDisplay() {
        const hc = document.getElementById(`history-${this.id}`);
        if (!hc) return;
        if (this.alarmHistory.length === 0) { hc.innerHTML = '<p style="color:#999;font-size:12px">No history yet</p>'; return; }
        const html = this.alarmHistory.slice(0, 10).map(e => {
            const d = new Date(e.timestamp);
            const t = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const ds = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            return `<div style="padding:8px 0;border-bottom:1px solid #eee;font-size:12px"><div style="display:flex;justify-content:space-between"><span style="font-weight:600">${e.action === 'triggered' ? '⏰ Triggered' : '✓ Dismissed'}</span><span style="color:#666">${ds} ${t}</span></div></div>`;
        }).join('');
        hc.innerHTML = html;
    }

    updateName(newName) { this.name = this.escapeHtml(newName) || `Pillbox ${this.id}`; saveDevices(); renderDevices(); }
    showMessage(msg, type, persist = false) {
        const el = document.getElementById(`message-${this.id}`);
        if (!el) return;
        el.textContent = msg;
        el.className = `message ${type}`;
        el.classList.remove('hidden');
        if (this.messageTimeout) clearTimeout(this.messageTimeout);
        if (!persist) this.messageTimeout = setTimeout(() => el.classList.add('hidden'), CONSTANTS.MESSAGE_TIMEOUT);
    }

    updateUI() {
        const cs = document.getElementById(`connectionStatus-${this.id}`);
        const cb = document.getElementById(`connectBtn-${this.id}`);
        const db = document.getElementById(`disconnectBtn-${this.id}`);
        const sb = document.getElementById(`setAlarmBtn-${this.id}`);
        const rb = document.getElementById(`resetBtn-${this.id}`);
        const c = document.getElementById(`container-${this.id}`);
        if (!c) return;
        if (cs) {
            if (this.connecting) { cs.textContent = 'Connecting...'; cs.className = 'connection-badge connecting'; }
            else if (this.connected) { cs.textContent = 'Connected'; cs.className = 'connection-badge connected'; }
            else { cs.textContent = 'Disconnected'; cs.className = 'connection-badge disconnected'; }
        }
        if (cb) { cb.classList.toggle('hidden', this.connected || this.connecting); cb.disabled = this.connecting; }
        if (db) db.classList.toggle('hidden', !this.connected);
        if (sb) sb.disabled = !this.connected;
        if (rb) rb.disabled = !this.connected;
        if (!this.scrollers.count) {
            c.innerHTML = "";
            this.scrollers.count = createNumberScroller(1, 99, this.alarmConfig.count || 1, `count-${this.id}`);
            c.appendChild(this.scrollers.count.element);
            c.appendChild(createSeparator("times every"));
            this.scrollers.frequency = createNumberScroller(1, 24, this.alarmConfig.frequency || 1, `frequency-${this.id}`);
            c.appendChild(this.scrollers.frequency.element);
            c.appendChild(createSeparator("hours starting"));
            const h = Math.floor((this.alarmConfig.startTime || 0) / 60);
            this.scrollers.hour = createNumberScroller(0, 23, h, `hour-${this.id}`);
            c.appendChild(this.scrollers.hour.element);
            c.appendChild(createSeparator(":"));
            const m = (this.alarmConfig.startTime || 0) % 60;
            this.scrollers.minute = createNumberScroller(0, 59, m, `minute-${this.id}`);
            c.appendChild(this.scrollers.minute.element);
            c.addEventListener('scroll', () => this.updateNextAlarmPreview(), true);
        }
        this.updateHistoryDisplay();
    }

    updateNextAlarmPreview() {
        const h = this.scrollers.hour.getValue(), m = this.scrollers.minute.getValue();
        const f = this.scrollers.frequency.getValue(), cnt = this.scrollers.count.getValue();
        const stm = h * 60 + m;
        const { nextAlarmMinutes, nextAlarmIndex } = this.calculateNextAlarm(stm, f, cnt);
        const pe = document.getElementById(`alarmPreview-${this.id}`);
        if (pe && nextAlarmMinutes !== null) {
            const ah = Math.floor(nextAlarmMinutes / 60), am = nextAlarmMinutes % 60;
            pe.textContent = `Preview: ${String(ah).padStart(2, '0')}:${String(am).padStart(2, '0')} (${nextAlarmIndex + 1}/${cnt})`;
            pe.style.display = 'block';
        }
    }

    render() {
        const st = this.connected ? 'Connected' : 'Disconnected';
        const ct = this.getConfigText();
        return `<div class="pillboxListEl" onclick="openDeviceForm(${this.id})" role="button" aria-label="Open ${this.escapeHtml(this.name)} configuration" tabindex="0"><p class="pillboxName">${this.escapeHtml(this.name)}</p><p class="pillboxStatus">${st}</p><p class="pillboxConfig">${ct}</p></div>`;
    }

    getConfigText() {
        if (!this.alarmConfig.nextAlarm) return 'Not configured';
        const { nextAlarmMinutes, nextAlarmIndex } = this.calculateNextAlarm(this.alarmConfig.startTime, this.alarmConfig.frequency, this.alarmConfig.count);
        if (nextAlarmMinutes === null) return 'No upcoming alarms';
        const h = Math.floor(nextAlarmMinutes / 60), m = nextAlarmMinutes % 60;
        return `Next: ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} - Dose ${nextAlarmIndex + 1}/${this.alarmConfig.count} every ${this.alarmConfig.frequency}h`;
    }

    destroy() { this.shouldReconnect = false; if (this.connected) this.disconnect(); this.stopIntervals(); }
    toJSON() { return { id: this.id, name: this.name, deviceId: this.deviceId, alarmConfig: this.alarmConfig, alarmHistory: this.alarmHistory }; }
}

function saveDevices() {
    try {
        const data = { devices: devices.map(d => d.toJSON()), deviceIdCounter };
        localStorage.setItem(CONSTANTS.STORAGE_KEY, JSON.stringify(data));
    } catch (e) { console.error('Failed to save devices:', e); }
}

function loadDevices() {
    try {
        const data = JSON.parse(localStorage.getItem(CONSTANTS.STORAGE_KEY));
        if (data) {
            deviceIdCounter = data.deviceIdCounter || 0;
            devices = data.devices.map(d => new PillboxDevice(d.id, d));
            devices.forEach(d => { if (d.deviceId && d.alarmConfig.nextAlarm) d.connect(true); });
        }
    } catch (e) { console.error('Failed to load devices:', e); }
}

function addNewDevice() { deviceIdCounter++; const d = new PillboxDevice(deviceIdCounter); devices.push(d); saveDevices(); renderDevices(); openDeviceForm(d.id); }
function removeDevice(id) {
    const d = devices.find(x => x.id === id);
    if (d) {
        const ok = confirm(`Remove ${d.name}? This will delete all history.`);
        if (!ok) return;
        d.destroy();
        devices = devices.filter(x => x.id !== id);
        saveDevices();
        closeDeviceForm();
        renderDevices();
    }
}
function renderDevices() {
    const c = document.getElementById('pillboxList');
    c.innerHTML = devices.length === 0 ? '' : devices.map(d => d.render()).join('');
}
function connectDevice(id) { const d = devices.find(x => x.id === id); if (d) d.connect(); }
function disconnectDevice(id) { const d = devices.find(x => x.id === id); if (d) d.disconnect(); }
function setDeviceAlarm(id) { const d = devices.find(x => x.id === id); if (d) d.setAlarm(); }
function resetDevice(id) { const d = devices.find(x => x.id === id); if (d) d.reset(); }
function updateDeviceName(id, n) { const d = devices.find(x => x.id === id); if (d) d.updateName(n); }

function openDeviceForm(id) {
    currentDeviceId = id;
    const d = devices.find(x => x.id === id);
    if (!d) return;
    const fc = document.getElementById('deviceFormContainer');
    fc.innerHTML = `<div class="device-header"><div id="container-${d.id}" class="container"></div><div id="alarmPreview-${d.id}" style="display:none;color:white;text-align:center;padding:8px;font-size:12px"></div></div><div class="device-name"><input type="text" value="${d.escapeHtml(d.name)}" onchange="updateDeviceName(${d.id},this.value)" aria-label="Device name"></div><div id="message-${d.id}" class="message hidden"></div><div class="status-bar"><div class="status-item"><span id="connectionStatus-${d.id}" class="connection-badge disconnected">Disconnected</span><span id="alarmStatus-${d.id}" class="status-badge status-no_alarm">no_alarm</span><span id="deviceTime-${d.id}" class="status-value">--:--:--</span><span class="status-label">Next Alarm:</span><span id="nextAlarm-${d.id}" class="status-value">Not set</span></div></div><div class="button-group"><button class="remove-btn" onclick="removeDevice(${d.id})" aria-label="Remove device">Remove Device</button><button id="connectBtn-${d.id}" class="btn-connect" onclick="connectDevice(${d.id})" aria-label="Connect">Connect</button><button id="disconnectBtn-${d.id}" class="btn-disconnect hidden" onclick="disconnectDevice(${d.id})" aria-label="Disconnect">Disconnect</button><button id="setAlarmBtn-${d.id}" class="btn-primary" disabled onclick="setDeviceAlarm(${d.id})" aria-label="Set alarm">Set Alarm</button><button id="resetBtn-${d.id}" class="btn-danger" disabled onclick="resetDevice(${d.id})" aria-label="Reset">Reset</button></div><div style="margin-top:20px;padding:16px;background:#f5f5f5;border-radius:8px"><h4 style="margin:0 0 12px 0;font-size:14px">Alarm History</h4><div id="history-${d.id}"></div></div>`;
    document.getElementById('deviceFormModal').classList.remove('hidden');
    d.updateUI();
}

function closeDeviceForm() {
    // Clear scrollers reference so they get recreated next time
    if (currentDeviceId) {
        const d = devices.find(x => x.id === currentDeviceId);
        if (d) d.scrollers = {};
    }
    document.getElementById('deviceFormModal').classList.add('hidden');
    currentDeviceId = null;
    renderDevices();
}

// Click backdrop to close
document.getElementById('deviceFormModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'deviceFormModal') closeDeviceForm();
});

if (!navigator.bluetooth) alert('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.');

loadDevices();
renderDevices();