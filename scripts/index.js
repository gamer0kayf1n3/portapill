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

class PillboxDevice {
    constructor(id) {
        this.id = id;
        this.name = `Pillbox ${id}`;
        this.device = null;
        this.server = null;
        this.service = null;
        this.characteristics = {};
        this.timeCheckInterval = null;
        this.connected = false;
    }

    async connect() {
        try {
            this.showMessage('Connecting...', 'success');

            this.device = await navigator.bluetooth.requestDevice({
                filters: [{
                    services: [SERVICE_UUID]  // Use services in filters
                }],
                optionalServices: []  // Can add additional services here if needed
            });

            this.device.addEventListener('gattserverdisconnected', () => this.onDisconnected());

            this.server = await this.device.gatt.connect();
            this.service = await this.server.getPrimaryService(SERVICE_UUID);

            for (const [key, uuid] of Object.entries(CHAR_UUIDS)) {
                this.characteristics[key] = await this.service.getCharacteristic(uuid);
            }

            await this.characteristics.status.startNotifications();
            this.characteristics.status.addEventListener('characteristicvaluechanged',
                (e) => this.handleStatusChange(e));

            this.connected = true;
            this.updateUI();
            this.showMessage('Connected!', 'success');

            await this.syncTime();
            this.timeCheckInterval = setInterval(() => this.checkAndSyncTime(), 10000);

        } catch (error) {
            this.showMessage('Connection failed: ' + error.message, 'error');
        }
    }

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            this.device.gatt.disconnect();
        }
    }

    onDisconnected() {
        this.connected = false;
        if (this.timeCheckInterval) {
            clearInterval(this.timeCheckInterval);
            this.timeCheckInterval = null;
        }
        this.updateUI();
        this.showMessage('Disconnected', 'error');
    }

    async syncTime() {
        try {
            const now = new Date();
            const secondsSinceMidnight = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

            const view = new DataView(new ArrayBuffer(4));
            view.setUint32(0, secondsSinceMidnight, true);
            await this.characteristics.currentTime.writeValue(view);
        } catch (error) {
            console.error('Time sync failed:', error);
        }
    }

    async checkAndSyncTime() {
        try {
            const now = new Date();
            const localSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

            const deviceView = await this.characteristics.currentTime.readValue();
            const deviceSeconds = deviceView.getUint32(0, true);

            const diff = Math.abs(localSeconds - deviceSeconds);

            if (diff > 10 && diff < 86390) {
                await this.syncTime();
            }

            this.displayTime(deviceSeconds);

        } catch (error) {
            console.error('Time check failed:', error);
        }
    }

    displayTime(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        const timeStr = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        document.getElementById(`deviceTime-${this.id}`).textContent = timeStr;
    }

    async setAlarm() {
        try {
            const startTimeValue = document.getElementById(`startTime-${this.id}`).value;
            const frequencyValue = parseInt(document.getElementById(`frequency-${this.id}`).value);
            const countValue = parseInt(document.getElementById(`count-${this.id}`).value);

            if (!startTimeValue || !frequencyValue || !countValue) {
                this.showMessage('Please fill in all fields', 'error');
                return;
            }

            const [hours, minutes] = startTimeValue.split(':').map(Number);
            const startTimeMinutes = hours * 60 + minutes;

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

            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();

            let nextAlarmMinutes = startTimeMinutes;
            for (let i = 0; i < countValue; i++) {
                const alarmTime = startTimeMinutes + (i * frequencyValue);
                if (alarmTime > currentMinutes) {
                    nextAlarmMinutes = alarmTime % 1440;
                    break;
                }
            }

            const nextHours = Math.floor(nextAlarmMinutes / 60);
            const nextMins = nextAlarmMinutes % 60;
            document.getElementById(`nextAlarm-${this.id}`).textContent =
                `${String(nextHours).padStart(2, '0')}:${String(nextMins).padStart(2, '0')}`;

            this.showMessage('Alarm set!', 'success');

        } catch (error) {
            this.showMessage('Failed to set alarm: ' + error.message, 'error');
        }
    }

    async reset() {
        try {
            const confirmed = confirm(`Reset ${this.name}?`);
            if (!confirmed) return;

            const view = new DataView(new ArrayBuffer(1));
            view.setUint8(0, 1);
            await this.characteristics.reset.writeValue(view);

            document.getElementById(`nextAlarm-${this.id}`).textContent = 'Not set';
            this.showMessage('Reset successful!', 'success');

        } catch (error) {
            this.showMessage('Reset failed: ' + error.message, 'error');
        }
    }

    handleStatusChange(event) {
        const decoder = new TextDecoder();
        const status = decoder.decode(event.target.value);

        const badge = document.getElementById(`alarmStatus-${this.id}`);
        badge.textContent = status;
        badge.className = 'status-badge status-' + status;

        if (status === 'triggered') {
            this.showMessage('⏰ Alarm triggered!', 'error');
        } else if (status === 'dismissed') {
            this.showMessage('✓ Dismissed', 'success');
        }
    }

    updateName(newName) {
        this.name = newName;
    }

    showMessage(message, type) {
        const msgElement = document.getElementById(`message-${this.id}`);
        msgElement.textContent = message;
        msgElement.className = `message ${type}`;
        msgElement.classList.remove('hidden');

        setTimeout(() => {
            msgElement.classList.add('hidden');
        }, 3000);
    }

    updateUI() {
        const connStatus = document.getElementById(`connectionStatus-${this.id}`);
        const connBtn = document.getElementById(`connectBtn-${this.id}`);
        const disconnBtn = document.getElementById(`disconnectBtn-${this.id}`);
        const setBtn = document.getElementById(`setAlarmBtn-${this.id}`);
        const resetBtn = document.getElementById(`resetBtn-${this.id}`);

        if (this.connected) {
            connStatus.textContent = 'Connected';
            connStatus.className = 'connection-badge connected';
            connBtn.classList.add('hidden');
            disconnBtn.classList.remove('hidden');
            setBtn.disabled = false;
            resetBtn.disabled = false;
        } else {
            connStatus.textContent = 'Disconnected';
            connStatus.className = 'connection-badge disconnected';
            connBtn.classList.remove('hidden');
            disconnBtn.classList.add('hidden');
            setBtn.disabled = true;
            resetBtn.disabled = true;
        }
    }

    render() {
        const statusText = this.connected ? 'Connected' : 'Disconnected';
        const configText = this.getConfigText();

        return `
        <div class="pillboxListEl" onclick="openDeviceForm(${this.id})">
            <p class="pillboxName">${this.name}</p>
            <p class="pillboxStatus">${statusText}</p>
            <p class="pillboxConfig">${configText}</p>
        </div>
    `;
    }

    getConfigText() {
        const nextAlarmEl = document.getElementById(`nextAlarm-${this.id}`);
        const startTimeEl = document.getElementById(`startTime-${this.id}`);
        const countEl = document.getElementById(`count-${this.id}`);
        const frequencyEl = document.getElementById(`frequency-${this.id}`);

        if (!nextAlarmEl || nextAlarmEl.textContent === 'Not set') {
            return 'Not configured';
        }

        const nextAlarm = nextAlarmEl.textContent;
        const count = countEl ? countEl.value : '?';
        const frequency = frequencyEl ? frequencyEl.value : '?';

        return `Opens at ${nextAlarm}: ?/${count} every ${frequency} mins`;
    }
}

function addNewDevice() {
    deviceIdCounter++;
    const device = new PillboxDevice(deviceIdCounter);
    devices.push(device);
    renderDevices();
}

function removeDevice(id) {
    const device = devices.find(d => d.id === id);
    if (device) {
        if (device.connected) {
            device.disconnect();
        }
        devices = devices.filter(d => d.id !== id);
        renderDevices();
    }
}

function renderDevices() {
    const container = document.getElementById('pillboxList');

    if (devices.length === 0) {
        container.innerHTML = '';
    } else {
        container.innerHTML = devices.map(d => d.render()).join('');
    }
}

function connectDevice(id) {
    const device = devices.find(d => d.id === id);
    if (device) device.connect();
}

function disconnectDevice(id) {
    const device = devices.find(d => d.id === id);
    if (device) device.disconnect();
}

function setDeviceAlarm(id) {
    const device = devices.find(d => d.id === id);
    if (device) device.setAlarm();
}

function resetDevice(id) {
    const device = devices.find(d => d.id === id);
    if (device) device.reset();
}

function updateDeviceName(id, newName) {
    const device = devices.find(d => d.id === id);
    if (device) device.updateName(newName);
}

// Check for Web Bluetooth support
if (!navigator.bluetooth) {
    alert('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.');
}

// Initialize
renderDevices();

let currentDeviceId = null;

function openDeviceForm(id) {
    currentDeviceId = id;
    const device = devices.find(d => d.id === id);
    if (!device) return;

    const formContainer = document.getElementById('deviceFormContainer');
    formContainer.innerHTML = `
        <div class="device-header">
            <div class="device-name">
                <input type="text" value="${device.name}" 
                    onchange="updateDeviceName(${device.id}, this.value)">
            </div>
            <button class="remove-btn" onclick="removeDevice(${device.id})">Remove Device</button>
        </div>

        <div id="message-${device.id}" class="message hidden"></div>

        <div class="status-bar">
            <div class="status-item">
                <span class="status-label">Connection:</span>
                <span id="connectionStatus-${device.id}" class="connection-badge disconnected">Disconnected</span>
            </div>
            <div class="status-item">
                <span class="status-label">Status:</span>
                <span id="alarmStatus-${device.id}" class="status-badge status-no_alarm">no_alarm</span>
            </div>
            <div class="status-item">
                <span class="status-label">Device Time:</span>
                <span id="deviceTime-${device.id}" class="status-value">--:--:--</span>
            </div>
            <div class="status-item">
                <span class="status-label">Next Alarm:</span>
                <span id="nextAlarm-${device.id}" class="status-value">Not set</span>
            </div>
        </div>

        <div class="form-group">
            <label>Start Time</label>
            <input type="time" id="startTime-${device.id}" value="06:00">
        </div>

        <div class="form-group">
            <label>Frequency (minutes)</label>
            <input type="number" id="frequency-${device.id}" min="1" value="120">
        </div>

        <div class="form-group">
            <label>Number of Alarms</label>
            <input type="number" id="count-${device.id}" min="1" max="20" value="5">
        </div>

        <div class="button-group">
            <button id="connectBtn-${device.id}" class="btn-connect" 
                onclick="connectDevice(${device.id})">Connect</button>
            <button id="disconnectBtn-${device.id}" class="btn-disconnect hidden" 
                onclick="disconnectDevice(${device.id})">Disconnect</button>
            <button id="setAlarmBtn-${device.id}" class="btn-primary" disabled 
                onclick="setDeviceAlarm(${device.id})">Set Alarm</button>
            <button id="resetBtn-${device.id}" class="btn-danger" disabled 
                onclick="resetDevice(${device.id})">Reset</button>
        </div>
    `;

    document.getElementById('deviceFormModal').classList.remove('hidden');
    device.updateUI();
}

function closeDeviceForm() {
    document.getElementById('deviceFormModal').classList.add('hidden');
    currentDeviceId = null;
    renderDevices(); // Refresh the list to show updated config
}

function addNewDevice() {
    deviceIdCounter++;
    const device = new PillboxDevice(deviceIdCounter);
    devices.push(device);
    renderDevices();
    openDeviceForm(device.id); // Open form right away
}