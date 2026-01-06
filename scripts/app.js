/**
 * app.js
 * 
 * Main application controller. Coordinates all modules and
 * exposes global functions for HTML event handlers.
 */

import { PillboxDevice } from './pillbox-device.js';
import { UIManager } from './ui-manager.js';
import { StorageManager } from './storage-manager.js';

class PortaPillApp {
    constructor() {
        this.devices = [];
        this.deviceIdCounter = 0;
        this.uiManager = new UIManager();
    }

    /**
     * Initializes the application
     */
    async initialize() {
        // Check browser compatibility
        if (!navigator.bluetooth) {
            alert('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or Opera.');
            return;
        }

        // Check localStorage availability
        if (!StorageManager.isAvailable()) {
            console.warn('localStorage is not available. Data will not persist.');
        }

        // Load saved devices
        this._loadDevices();

        // Render initial UI
        this._renderDevices();

        // Set up modal backdrop click handler
        this._setupModalHandlers();

        console.log('PortaPill initialized with', this.devices.length, 'devices');
    }

    /**
     * Loads devices from storage
     * @private
     */
    _loadDevices() {
        const { devices: savedDevices, deviceIdCounter } = StorageManager.loadDevices();

        this.deviceIdCounter = deviceIdCounter;
        this.devices = savedDevices.map(deviceData =>
            new PillboxDevice(deviceData.id, deviceData, this.uiManager)
        );

        // Auto-reconnect to devices with stored IDs
        this.devices.forEach(device => {
            if (device.deviceId && device.alarmConfig.nextAlarm) {
                device.connect(true);
            }
        });
    }

    /**
     * Saves all devices to storage
     * @private
     */
    _saveDevices() {
        StorageManager.saveDevices(this.devices, this.deviceIdCounter);
    }

    /**
     * Renders the device list
     * @private
     */
    _renderDevices() {
        this.uiManager.renderDeviceList(this.devices);
    }

    /**
     * Sets up modal event handlers
     * @private
     */
    _setupModalHandlers() {
        const modal = document.getElementById('deviceFormModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target.id === 'deviceFormModal') {
                    this.closeDeviceForm();
                }
            });
        }
    }

    /**
     * Finds a device by ID
     * @private
     */
    _findDevice(id) {
        return this.devices.find(device => device.id === id);
    }

    // ============================================
    // Public API - Called from HTML onclick handlers
    // ============================================

    /**
     * Adds a new device
     */
    addNewDevice() {
        this.deviceIdCounter++;
        const device = new PillboxDevice(this.deviceIdCounter, null, this.uiManager);
        this.devices.push(device);

        this._saveDevices();
        this._renderDevices();
        this.openDeviceForm(device.id);
    }

    /**
     * Removes a device
     * @param {Number} id - Device ID to remove
     */
    removeDevice(id) {
        const device = this._findDevice(id);
        if (!device) return;

        const confirmed = confirm(`Remove ${device.name}? This will delete all history.`);
        if (!confirmed) return;

        device.destroy();
        this.devices = this.devices.filter(d => d.id !== id);

        this._saveDevices();
        this.closeDeviceForm();
        this._renderDevices();
    }

    /**
     * Opens device configuration form
     * @param {Number} id - Device ID to configure
     */
    openDeviceForm(id) {
        const device = this._findDevice(id);
        if (!device) return;

        // Import scroller functions from global scope
        // These are defined in range-input.js
        const createNumberScroller = window.createNumberScroller;
        const createSeparator = window.createSeparator;

        this.uiManager.openDeviceModal(device, createNumberScroller, createSeparator);
    }

    /**
     * Closes device configuration form
     */
    closeDeviceForm() {
        // Clear scroller references so they get recreated next time
        const currentDeviceId = this.uiManager.getCurrentDeviceId();
        if (currentDeviceId) {
            const device = this._findDevice(currentDeviceId);
            if (device) {
                device.scrollers = {};
            }
        }

        this.uiManager.closeDeviceModal();
        this._renderDevices();
    }

    /**
     * Connects to a device
     * @param {Number} id - Device ID to connect
     */
    async connectDevice(id) {
        const device = this._findDevice(id);
        if (device) {
            await device.connect();
            this._saveDevices();
        }
    }

    /**
     * Disconnects from a device
     * @param {Number} id - Device ID to disconnect
     */
    async disconnectDevice(id) {
        const device = this._findDevice(id);
        if (device) {
            await device.disconnect();
            this._saveDevices();
        }
    }

    /**
     * Sets alarm for a device
     * @param {Number} id - Device ID
     */
    async setDeviceAlarm(id) {
        const device = this._findDevice(id);
        if (device) {
            await device.setAlarm();
            this._saveDevices();
            this._renderDevices();
        }
    }

    /**
     * Resets a device
     * @param {Number} id - Device ID
     */
    async resetDevice(id) {
        const device = this._findDevice(id);
        if (device) {
            await device.reset();
            this._saveDevices();
            this._renderDevices();
        }
    }

    /**
     * Updates device name
     * @param {Number} id - Device ID
     * @param {String} newName - New name
     */
    updateDeviceName(id, newName) {
        const device = this._findDevice(id);
        if (device) {
            device.updateName(newName);
            this._saveDevices();
            this._renderDevices();
        }
    }
}

// ============================================
// Initialize application
// ============================================

const app = new PortaPillApp();

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.initialize());
} else {
    app.initialize();
}

// Expose app to global scope for HTML onclick handlers
window.app = app;

// Expose individual functions for backward compatibility
window.addNewDevice = () => app.addNewDevice();
window.removeDevice = (id) => app.removeDevice(id);
window.openDeviceForm = (id) => app.openDeviceForm(id);
window.closeDeviceForm = () => app.closeDeviceForm();
window.connectDevice = (id) => app.connectDevice(id);
window.disconnectDevice = (id) => app.disconnectDevice(id);
window.setDeviceAlarm = (id) => app.setDeviceAlarm(id);
window.resetDevice = (id) => app.resetDevice(id);
window.updateDeviceName = (id, name) => app.updateDeviceName(id, name);

// At the end of app.js, add:
Object.defineProperty(window, 'devices', {
    get() {
        return app.devices;
    }
});
