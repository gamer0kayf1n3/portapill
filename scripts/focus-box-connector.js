// Focus Box Connector - Links Real Pillbox Devices to UI
// Replace the contents of focus-box-connector.js with this

class FocusBoxManager {
    constructor() {
        console.log('[FOCUS BOX] Initializing FocusBoxManager...');
        this.updateInterval = null;
        this.currentDevice = null;
        this.nextAlarm = null;
        
        this.elements = {
            toptext: document.getElementById('toptext'),
            pillboxText: document.getElementById('pillboxText'),
            timeText: document.getElementById('timeText'),
            configText: document.getElementById('configText'),
            focusBox: document.getElementById('focusBox')
        };
        
        console.log('[FOCUS BOX] Elements found:', {
            toptext: !!this.elements.toptext,
            pillboxText: !!this.elements.pillboxText,
            timeText: !!this.elements.timeText,
            configText: !!this.elements.configText,
            focusBox: !!this.elements.focusBox
        });
        
        // Start monitoring
        this.startMonitoring();
    }

    startMonitoring() {
        console.log('[FOCUS BOX] Starting monitoring interval...');
        // Update every second
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 1000);
        
        // Initial update
        this.updateDisplay();
    }

    updateDisplay() {
        console.log('[FOCUS BOX] Updating display...');
        console.log('[FOCUS BOX] window.devices exists:', !!window.devices);
        console.log('[FOCUS BOX] window.devices:', window.devices);
        
        const nextAlarmInfo = this.findNextAlarm();
        
        console.log('[FOCUS BOX] Next alarm info:', nextAlarmInfo);
        
        if (!nextAlarmInfo) {
            this.showNoAlarms();
            return;
        }

        this.nextAlarm = nextAlarmInfo;
        this.showAlarmInfo(nextAlarmInfo);
    }

    findNextAlarm() {
        console.log('[FOCUS BOX] Finding next alarm...');
        
        // Check if window.devices exists (exposed by app.js)
        if (!window.devices) {
            console.warn('[FOCUS BOX] window.devices is not defined');
            return null;
        }
        
        if (window.devices.length === 0) {
            console.log('[FOCUS BOX] No devices in array');
            return null;
        }

        console.log('[FOCUS BOX] Checking', window.devices.length, 'device(s)');

        let nearestAlarm = null;
        let nearestDevice = null;
        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();

        console.log('[FOCUS BOX] Current time:', now.toLocaleTimeString(), '(', nowMinutes, 'minutes )');

        window.devices.forEach((device, index) => {
            console.log(`[FOCUS BOX] Device ${index}:`, {
                id: device.id,
                name: device.name,
                connected: device.connected,
                hasAlarmConfig: !!device.alarmConfig,
                nextAlarm: device.alarmConfig?.nextAlarm,
                alarmConfig: device.alarmConfig
            });

            // Skip if not connected or no alarm configured
            if (!device.connected) {
                console.log(`[FOCUS BOX] Device ${index} not connected, skipping`);
                return;
            }
            
            if (!device.alarmConfig.nextAlarm) {
                console.log(`[FOCUS BOX] Device ${index} has no alarm configured, skipping`);
                return;
            }

            const config = device.alarmConfig;
            
            console.log(`[FOCUS BOX] Device ${index} calculating next alarm from:`, {
                startTime: config.startTime,
                frequency: config.frequency,
                count: config.count,
                currentMinutes: nowMinutes
            });

            // Calculate next alarm using device's own method
            const { nextAlarmMinutes, nextAlarmIndex } = device.calculateNextAlarm(
                config.startTime,
                config.frequency,
                config.count,
                nowMinutes
            );

            console.log(`[FOCUS BOX] Device ${index} next alarm:`, {
                nextAlarmMinutes,
                nextAlarmIndex
            });

            if (nextAlarmMinutes === null) {
                console.log(`[FOCUS BOX] Device ${index} has no upcoming alarms`);
                return;
            }

            // Convert to today's date
            let alarmDate = new Date(now);
            alarmDate.setHours(Math.floor(nextAlarmMinutes / 60));
            alarmDate.setMinutes(nextAlarmMinutes % 60);
            alarmDate.setSeconds(0);
            alarmDate.setMilliseconds(0);

            // If alarm time has passed today, it's tomorrow
            if (nextAlarmMinutes <= nowMinutes) {
                console.log(`[FOCUS BOX] Device ${index} alarm is tomorrow`);
                alarmDate.setDate(alarmDate.getDate() + 1);
            }

            console.log(`[FOCUS BOX] Device ${index} alarm date:`, alarmDate.toLocaleString());

            // Check if this is the nearest alarm
            if (!nearestAlarm || alarmDate < nearestAlarm.date) {
                console.log(`[FOCUS BOX] Device ${index} has the nearest alarm!`);
                nearestAlarm = {
                    date: alarmDate,
                    index: nextAlarmIndex,
                    minutes: nextAlarmMinutes
                };
                nearestDevice = device;
            }
        });

        if (!nearestAlarm || !nearestDevice) {
            console.log('[FOCUS BOX] No nearest alarm found');
            return null;
        }

        console.log('[FOCUS BOX] Nearest alarm:', {
            device: nearestDevice.name,
            time: nearestAlarm.date.toLocaleString(),
            msUntil: nearestAlarm.date - now
        });

        return {
            device: nearestDevice,
            alarm: nearestAlarm,
            config: nearestDevice.alarmConfig,
            msUntil: nearestAlarm.date - now,
            totalAlarms: nearestDevice.alarmConfig.count,
            currentAlarmNumber: nearestAlarm.index + 1
        };
    }

    showAlarmInfo(info) {
        console.log('[FOCUS BOX] Showing alarm info:', info);
        
        const { device, alarm, config, msUntil, totalAlarms, currentAlarmNumber } = info;

        // Update pillbox name
        this.elements.pillboxText.textContent = device.name;

        // Update time until alarm
        this.elements.timeText.textContent = this.formatTimeUntil(msUntil);

        // Update configuration text
        const ordinal = this.getOrdinal(currentAlarmNumber);
        const hours = config.frequency;
        const hourText = hours === 1 ? 'hour' : 'hours';
        this.elements.configText.textContent = 
            `${ordinal} out of ${totalAlarms} every ${hours} ${hourText}`;

        // Update top text based on urgency
        if (msUntil < 60000) { // Less than 1 minute
            this.elements.toptext.textContent = "⏰ ALARM IMMINENT!";
            this.elements.focusBox.style.borderColor = '#ef4444';
            this.elements.focusBox.classList.add('pulsing');
        } else if (msUntil < 300000) { // Less than 5 minutes
            this.elements.toptext.textContent = "Next alarm soon";
            this.elements.focusBox.style.borderColor = '#f59e0b';
            this.elements.focusBox.classList.remove('pulsing');
        } else {
            this.elements.toptext.textContent = "The next alarm is";
            this.elements.focusBox.style.borderColor = '#3b82f6';
            this.elements.focusBox.classList.remove('pulsing');
        }

        // Show the focus box
        this.elements.focusBox.style.opacity = '1';
        
        console.log('[FOCUS BOX] Display updated successfully');
    }

    showNoAlarms() {
        console.log('[FOCUS BOX] Showing no alarms state');
        
        this.elements.toptext.textContent = "No alarms scheduled";
        this.elements.pillboxText.textContent = "—";
        this.elements.timeText.textContent = "—";
        this.elements.configText.textContent = "Connect a device and set an alarm";
        this.elements.focusBox.style.borderColor = '#6b7280';
        this.elements.focusBox.style.opacity = '0.7';
        this.elements.focusBox.classList.remove('pulsing');
    }

    formatTimeUntil(ms) {
        if (ms < 0) return "now";

        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) {
            const remainingHours = hours % 24;
            return `in ${days}d ${remainingHours}h`;
        } else if (hours > 0) {
            const remainingMinutes = minutes % 60;
            return `in ${hours}h ${remainingMinutes}m`;
        } else if (minutes > 0) {
            const remainingSeconds = seconds % 60;
            return `in ${minutes}m ${remainingSeconds}s`;
        } else {
            return `in ${seconds}s`;
        }
    }

    getOrdinal(n) {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
    }

    destroy() {
        console.log('[FOCUS BOX] Destroying FocusBoxManager');
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }
    }
}

// Initialize the focus box manager when the page loads
let focusBoxManager;

// Wait for DOM to be ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFocusBox);
} else {
    initFocusBox();
}

function initFocusBox() {
    console.log('[FOCUS BOX] initFocusBox called, waiting 500ms for app initialization...');
    
    // Wait a bit for app.js to initialize
    setTimeout(() => {
        console.log('[FOCUS BOX] Attempting to create FocusBoxManager...');
        
        if (document.getElementById('focusBox')) {
            focusBoxManager = new FocusBoxManager();
            console.log('🎯 Focus Box connected to real devices');
        } else {
            console.warn('⚠️ Focus Box not found in DOM');
        }
    }, 500);
}

// Add CSS styling for focus box animations
const style = document.createElement('style');
style.textContent = `
    #focusBox {
        transition: border-color 0.3s ease, opacity 0.3s ease;
    }
    
    #focusBox.pulsing {
        animation: pulse 2s ease-in-out infinite;
    }
    
    @keyframes pulse {
        0%, 100% {
            opacity: 1;
        }
        50% {
            opacity: 0.7;
        }
    }
`;
document.head.appendChild(style);

// Export for external use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { FocusBoxManager };
}