/**
 * constants.js
 * 
 * Central configuration for the PortaPill application.
 * All timing, limits, and Bluetooth UUIDs are defined here.
 */

export const CONSTANTS = {
    // Time synchronization
    TIME_SYNC_INTERVAL: 10000,      // Check time every 10 seconds
    TIME_SYNC_THRESHOLD: 10,        // Sync if off by more than 10 seconds
    
    // Time calculations
    SECONDS_PER_DAY: 86400,
    MINUTES_PER_DAY: 1440,
    
    // UI timeouts
    MESSAGE_TIMEOUT: 5000,          // Hide messages after 5 seconds
    CONNECTION_TIMEOUT: 30000,      // Connection attempt timeout
    
    // Limits
    MAX_HISTORY_ENTRIES: 100,       // Maximum alarm history to store
    
    // Update intervals
    CLOCK_UPDATE_INTERVAL: 1000,    // Update clock display every second
    NEXT_ALARM_UPDATE_INTERVAL: 60000, // Update next alarm every minute
    
    // Reconnection
    RECONNECT_DELAY: 2000,          // Wait 2 seconds before reconnecting
    RECONNECT_MAX_ATTEMPTS: 3,      // Try reconnecting 3 times
    
    // Storage
    STORAGE_KEY: 'pillbox_devices'  // localStorage key
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