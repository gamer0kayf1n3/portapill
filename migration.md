# PortaPill Refactoring - Migration Guide

## Overview

The monolithic `index.js` has been refactored into modular ES6 modules with clear separation of concerns.

## New File Structure

```
scripts/
├── constants.js          # All application constants
├── storage-manager.js    # localStorage operations
├── ui-manager.js         # DOM manipulation
├── pillbox-device.js     # Bluetooth device logic
├── app.js                # Application coordinator
├── range-input.js        # (Unchanged)
├── tab-navigation.js     # (Unchanged)
├── pillbox-sim.js        # (Unchanged)
└── focus-box-connector.js # (Unchanged)
```

## Migration Steps

### 1. Backup Current Code
```bash
cp scripts/index.js scripts/index.js.backup
```

### 2. Create New Module Files

Create the following new files in the `scripts/` directory:
- `constants.js`
- `storage-manager.js`
- `ui-manager.js`
- `pillbox-device.js`
- `app.js`

Copy the code from the artifacts into each respective file.

### 3. Update HTML

Replace the old script tag:
```html
<!-- OLD -->
<script src="scripts/index.js"></script>

<!-- NEW -->
<script type="module" src="scripts/app.js"></script>
```

### 4. Remove Old File

After verifying everything works:
```bash
rm scripts/index.js
```

## Key Changes

### Module Exports/Imports

**constants.js:**
```javascript
export const CONSTANTS = { /* ... */ };
export const SERVICE_UUID = '...';
export const CHAR_UUIDS = { /* ... */ };
```

**storage-manager.js:**
```javascript
import { CONSTANTS } from './constants.js';
export class StorageManager { /* ... */ }
```

**ui-manager.js:**
```javascript
import { CONSTANTS } from './constants.js';
export class UIManager { /* ... */ }
```

**pillbox-device.js:**
```javascript
import { CONSTANTS, SERVICE_UUID, CHAR_UUIDS } from './constants.js';
export class PillboxDevice { /* ... */ }
```

**app.js:**
```javascript
import { PillboxDevice } from './pillbox-device.js';
import { UIManager } from './ui-manager.js';
import { StorageManager } from './storage-manager.js';
```

### Global Functions

All functions called from HTML onclick handlers are exposed via `window.app`:

```javascript
// In app.js
window.app = app;
window.addNewDevice = () => app.addNewDevice();
window.connectDevice = (id) => app.connectDevice(id);
// etc...
```

HTML can still use onclick handlers as before:
```html
<button onclick="connectDevice(123)">Connect</button>
```

## Benefits

### 1. Separation of Concerns
- **PillboxDevice**: Only handles Bluetooth and device logic
- **UIManager**: Only handles DOM manipulation
- **StorageManager**: Only handles data persistence
- **App**: Coordinates everything

### 2. Easier Testing
Each module can now be tested independently:
```javascript
// Test storage
import { StorageManager } from './storage-manager.js';
// Test without needing DOM or Bluetooth

// Test UI
import { UIManager } from './ui-manager.js';
// Test without needing Bluetooth
```

### 3. Better Maintainability
- Changes to UI don't affect Bluetooth logic
- Changes to storage don't affect UI
- Clear boundaries between modules

### 4. Improved Readability
- Each file has a single, clear purpose
- Easier to find specific functionality
- Better code organization

## Breaking Changes

### None for End Users
The refactoring maintains backward compatibility. All HTML event handlers continue to work as before.

### For Developers

If you have custom code that directly accessed global variables:

**Before:**
```javascript
// These were global
devices[0].connect();
saveDevices();
```

**After:**
```javascript
// Access through app instance
window.app.connectDevice(devices[0].id);
// saveDevices is now private to app
```

## Testing Checklist

After migration, test the following:

- [ ] Page loads without errors
- [ ] Can add new device
- [ ] Can open device modal
- [ ] Can connect to device
- [ ] Can set alarm
- [ ] Can disconnect device
- [ ] Can remove device
- [ ] Device persists after page reload
- [ ] Auto-reconnect works
- [ ] History tracking works
- [ ] Multiple devices work simultaneously

## Troubleshooting

### Module Import Errors

**Error:** `Uncaught SyntaxError: Cannot use import statement outside a module`

**Fix:** Ensure `app.js` is loaded with `type="module"`:
```html
<script type="module" src="scripts/app.js"></script>
```

### CORS Errors

**Error:** `Access to script at 'file://...' from origin 'null' has been blocked by CORS`

**Fix:** Serve files through a local server:
```bash
# Python 3
python -m http.server 8000

# Node.js
npx http-server
```

Then access via `http://localhost:8000`

### Function Not Defined

**Error:** `Uncaught ReferenceError: connectDevice is not defined`

**Fix:** Ensure all onclick functions are exposed in `app.js`:
```javascript
window.connectDevice = (id) => app.connectDevice(id);
```

## Rollback Plan

If issues occur, restore the backup:

```bash
cp scripts/index.js.backup scripts/index.js
```

And revert HTML:
```html
<script src="scripts/index.js"></script>
```

## Future Enhancements

With the new modular structure, it's now easier to add:

1. **Unit Tests**: Test each module independently
2. **TypeScript**: Add type definitions per module
3. **Build Process**: Use bundlers like Webpack or Vite
4. **Code Splitting**: Load modules on demand
5. **Alternative Storage**: Swap StorageManager for IndexedDB
6. **Mock Bluetooth**: Create mock PillboxDevice for testing

## Support

If you encounter issues during migration:

1. Check browser console for errors
2. Verify all files are in correct locations
3. Ensure file extensions are `.js`
4. Confirm server is running (not file://)
5. Check that all imports have `.js` extension