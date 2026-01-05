/**
 * storage-manager.js
 * 
 * Handles all data persistence operations using localStorage.
 * Provides a clean interface for saving and loading device data.
 */

import { CONSTANTS } from './constants.js';

export class StorageManager {
    /**
     * Saves all devices and the device ID counter to localStorage
     * @param {Array} devices - Array of device objects to save
     * @param {Number} deviceIdCounter - Current device ID counter
     */
    static saveDevices(devices, deviceIdCounter) {
        try {
            const data = {
                devices: devices.map(device => device.toJSON()),
                deviceIdCounter
            };
            localStorage.setItem(CONSTANTS.STORAGE_KEY, JSON.stringify(data));
        } catch (error) {
            console.error('Failed to save devices to localStorage:', error);
        }
    }

    /**
     * Loads devices and device ID counter from localStorage
     * @returns {Object} { devices: Array, deviceIdCounter: Number }
     */
    static loadDevices() {
        try {
            const json = localStorage.getItem(CONSTANTS.STORAGE_KEY);
            if (!json) {
                return { devices: [], deviceIdCounter: 0 };
            }

            const data = JSON.parse(json);
            return {
                devices: data.devices || [],
                deviceIdCounter: data.deviceIdCounter || 0
            };
        } catch (error) {
            console.error('Failed to load devices from localStorage:', error);
            return { devices: [], deviceIdCounter: 0 };
        }
    }

    /**
     * Clears all device data from storage
     * Use with caution - this is irreversible
     */
    static clearAll() {
        try {
            localStorage.removeItem(CONSTANTS.STORAGE_KEY);
        } catch (error) {
            console.error('Failed to clear storage:', error);
        }
    }

    /**
     * Checks if localStorage is available and working
     * @returns {Boolean} true if localStorage is available
     */
    static isAvailable() {
        try {
            const test = '__storage_test__';
            localStorage.setItem(test, test);
            localStorage.removeItem(test);
            return true;
        } catch (error) {
            return false;
        }
    }
}