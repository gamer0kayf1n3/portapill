/**
 * constants.js
 * 
 * Central configuration for the PortaPill application.
 * All timing, limits, and Bluetooth UUIDs are defined here.
 */

export const CONSTANTS = {
    CONNECTION_TIMEOUT: 30000,  // Increased from 10000 to 15000ms
    RECONNECT_DELAY: 2000,
    RECONNECT_MAX_ATTEMPTS: 5,
    TIME_SYNC_INTERVAL: 60000,
    TIME_SYNC_THRESHOLD: 5,
    CLOCK_UPDATE_INTERVAL: 1000,
    NEXT_ALARM_UPDATE_INTERVAL: 5000,
    MESSAGE_TIMEOUT: 3000,
    MAX_HISTORY_ENTRIES: 50,
    SECONDS_PER_DAY: 86400,
    MINUTES_PER_DAY: 1440
};

/**
 * Bluetooth Service UUID
 * Must match the UUID programmed into the pillbox devices
 */
export const SERVICE_UUID = '19b10000-e8f2-537e-4f6c-d104768a1214';

/**
 * Bluetooth Characteristic UUIDs
 * Each characteristic represents a different device property
 */
export const CHAR_UUIDS = {
    startTime: '19b10001-e8f2-537e-4f6c-d104768a1214',   // uint32: alarm start time in minutes
    frequency: '19b10002-e8f2-537e-4f6c-d104768a1214',   // uint32: hours between alarms
    count: '19b10003-e8f2-537e-4f6c-d104768a1214',       // uint16: number of alarms
    status: '19b10004-e8f2-537e-4f6c-d104768a1214',      // string: current alarm status
    currentTime: '19b10005-e8f2-537e-4f6c-d104768a1214', // uint32: device time in seconds
    reset: '19b10006-e8f2-537e-4f6c-d104768a1214'        // uint8: reset trigger
};