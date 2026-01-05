# PortaPill Companion App

The PortaPill Companion App is an app that serves as a dashboard for connected PortaPill devices designed to be control its settings.

## But what is PortaPill?

PortaPill is an IoT-enabled device that contains medicines, pills, and tablets designed to facilitate medicine intake and aid caretakers in hospitals in managing their patient's dosages.

# PortaPill - Architecture Documentation

## Overview

PortaPill is a web application for managing smart pillbox devices via Web Bluetooth API. The application allows users to connect to multiple pillboxes, set medication alarms, and track alarm history.

## Architecture

The application follows a modular architecture with clear separation of concerns:

```
portapill/
├── index.html
├── scripts/
│   ├── constants.js          # Application constants
│   ├── storage-manager.js    # Data persistence layer
│   ├── ui-manager.js          # DOM manipulation & rendering
│   ├── pillbox-device.js     # Bluetooth device logic
│   ├── range-input.js         # Number scroller component
│   ├── app.js                 # Application initialization
│   ├── tab-navigation.js      # Tab switching logic
│   └── focus-box-connector.js # Home screen focus box
└── style.css
```

## Module Responsibilities

### 1. constants.js
Centralizes all application constants including:
- Timing intervals
- Bluetooth UUIDs
- Storage keys
- Limits and thresholds

### 2. storage-manager.js
Handles all data persistence operations:
- Save/load device configurations
- Manage device counter
- Handle localStorage operations
- Error handling for storage failures

**Key Methods:**
- `saveDevices(devices, counter)` - Persists device state
- `loadDevices()` - Retrieves saved devices
- Automatic error handling with console logging

### 3. ui-manager.js
Manages all DOM manipulation and rendering:
- Device list rendering
- Modal management
- Status updates
- Message display
- History display

**Key Methods:**
- `renderDeviceList(devices)` - Renders the pillbox list
- `openDeviceModal(device)` - Opens device configuration modal
- `closeDeviceModal()` - Closes modal and cleans up
- `updateDeviceUI(device)` - Updates device status in UI
- `showMessage(deviceId, message, type, persist)` - Displays user messages

### 4. pillbox-device.js
Core device logic and Bluetooth communication:
- BLE connection management
- Time synchronization
- Alarm configuration
- Status notifications
- Auto-reconnection

**Key Methods:**
- `connect(isReconnect)` - Establishes BLE connection
- `disconnect()` - Closes connection
- `syncTime()` - Synchronizes device time
- `setAlarm()` - Configures alarm schedule
- `reset()` - Clears device configuration

**Properties:**
- `id` - Unique device identifier
- `name` - User-defined device name
- `connected` - Connection status
- `alarmConfig` - Current alarm configuration
- `alarmHistory` - Array of alarm events

### 5. range-input.js
Reusable number scroller component:
- Smooth scrolling interface
- Touch-friendly
- Configurable min/max values
- Programmatic value setting

**API:**
```javascript
createNumberScroller(min, max, initialValue, id)
// Returns: { element, getValue(), setValue(value) }
```

### 6. app.js
Main application controller:
- Initializes modules
- Coordinates device operations
- Exposes global functions for HTML onclick handlers
- Handles browser compatibility checks

## Data Flow

### Device Connection Flow
```
User clicks Connect
    → app.connectDevice(id)
    → device.connect()
    → BLE pairing dialog
    → device.syncTime()
    → device.readAlarmConfig()
    → UIManager.updateDeviceUI()
    → StorageManager.saveDevices()
```

### Alarm Setting Flow
```
User configures scrollers
    → User clicks Set Alarm
    → app.setDeviceAlarm(id)
    → device.setAlarm()
    → Write to BLE characteristics
    → Update local config
    → StorageManager.saveDevices()
    → UIManager.updateDeviceUI()
```

### Auto-Reconnection Flow
```
Device disconnects
    → device.onDisconnected()
    → Check shouldReconnect flag
    → Wait RECONNECT_DELAY
    → device.connect(true)
    → Attempt up to RECONNECT_MAX_ATTEMPTS
```

## Data Models

### Device Data Structure
```javascript
{
  id: Number,              // Unique device ID
  name: String,            // User-defined name
  deviceId: String,        // Bluetooth device ID
  alarmConfig: {
    startTime: Number,     // Minutes since midnight
    frequency: Number,     // Hours between alarms
    count: Number,         // Number of alarms per day
    nextAlarm: Boolean     // Whether alarm is configured
  },
  alarmHistory: [
    {
      timestamp: String,   // ISO 8601 format
      action: String,      // 'triggered' or 'dismissed'
      alarmTime: String    // HH:MM format
    }
  ]
}
```

### Bluetooth Characteristics
| Characteristic | UUID | Type | Description |
|---------------|------|------|-------------|
| startTime | 19b10001... | uint32 | Alarm start time (minutes) |
| frequency | 19b10002... | uint32 | Hours between alarms |
| count | 19b10003... | uint16 | Number of alarms |
| status | 19b10004... | string | Current status (triggered/dismissed/no_alarm) |
| currentTime | 19b10005... | uint32 | Device time (seconds since midnight) |
| reset | 19b10006... | uint8 | Reset trigger |

## Key Features

### Time Synchronization
- Automatic sync every 10 seconds
- Threshold-based syncing (10 second difference)
- Handles midnight rollover correctly

### Alarm Calculation
- Calculates next alarm based on current time
- Handles wrap-around to next day
- Shows alarm index (e.g., "3/10")

### Connection Management
- Persistent device storage via localStorage
- Auto-reconnect on disconnect (up to 3 attempts)
- Connection timeout (30 seconds)

### Operation Locking
- Prevents concurrent BLE operations
- Uses async lock pattern
- Ensures operation serialization

### History Tracking
- Stores last 100 alarm events
- Auto-saves to localStorage
- Displays most recent 10 events

## Error Handling

### Connection Errors
- Timeout after 30 seconds
- User-friendly error messages
- Automatic cleanup on failure

### Storage Errors
- Try-catch on all localStorage operations
- Console logging for debugging
- Graceful degradation

### Bluetooth Errors
- Characteristic availability checks
- Operation-specific error messages
- Connection state validation

## Browser Compatibility

**Required:**
- Web Bluetooth API support
- Chrome, Edge, or Opera browser
- HTTPS connection (required for Bluetooth API)

**Checked at startup:**
```javascript
if (!navigator.bluetooth) {
  alert('Web Bluetooth is not supported...');
}
```

## Security Considerations

1. **User Consent**: All Bluetooth operations require explicit user interaction
2. **XSS Prevention**: HTML escaping on user-provided names
3. **localStorage**: Data stored locally, no server transmission
4. **Device Permissions**: Web Bluetooth API handles device permissions

## Future Enhancement Areas

1. **Cloud Sync**: Add optional cloud backup
2. **Medication Database**: Link alarms to medication names
3. **Notifications**: Web notifications for alarms
4. **Analytics**: Usage patterns and adherence tracking
5. **Export**: CSV/PDF export of history
6. **Multi-user**: Support for multiple users/caregivers

## Development Guidelines

### Adding New Features
1. Identify which module the feature belongs to
2. Update the relevant module
3. Update constants.js if new constants needed
4. Update this documentation
5. Test connection/disconnection scenarios

### Modifying BLE Communication
1. Update CHAR_UUIDS in constants.js
2. Add characteristic handling in pillbox-device.js
3. Test with actual hardware
4. Update data models documentation

### UI Changes
1. All DOM manipulation goes in ui-manager.js
2. Use provided helper functions
3. Maintain accessibility attributes
4. Test modal interactions

## Testing Checklist

- [ ] Connect to device
- [ ] Set alarm with various configurations
- [ ] Disconnect and auto-reconnect
- [ ] Manual disconnect
- [ ] Time synchronization
- [ ] Multiple devices simultaneously
- [ ] localStorage persistence
- [ ] Reset device
- [ ] Remove device
- [ ] Rename device
- [ ] History tracking
- [ ] Browser refresh (persistence)
- [ ] Connection timeout handling
- [ ] Midnight rollover calculations