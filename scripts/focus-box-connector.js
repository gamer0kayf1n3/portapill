// Focus Box Connector - Links Bluetooth Simulator to UI
// Add this after both the simulator and your pillbox code

class FocusBoxManager {
    constructor() {
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
        
        // Start monitoring
        this.startMonitoring();
    }

    startMonitoring() {
        // Update every second
        this.updateInterval = setInterval(() => {
            this.updateDisplay();
        }, 1000);
        
        // Initial update
        this.updateDisplay();
    }

    updateDisplay() {
        const nextAlarmInfo = this.findNextAlarm();
        
        if (!nextAlarmInfo) {
            this.showNoAlarms();
            return;
        }

        this.nextAlarm = nextAlarmInfo;
        this.showAlarmInfo(nextAlarmInfo);
    }

    findNextAlarm() {
        // Find the device with the nearest upcoming alarm
        let nearestAlarm = null;
        let nearestDevice = null;
        const now = new Date();

        devices.forEach(device => {
            if (!device.connected || !device.service) return;

            const service = device.service;
            if (!service._scheduledAlarms || service._scheduledAlarms.length === 0) return;

            // Find the next alarm for this device
            const nextAlarm = service._scheduledAlarms.find(alarm => alarm.date > now);
            
            if (nextAlarm) {
                if (!nearestAlarm || nextAlarm.date < nearestAlarm.date) {
                    nearestAlarm = nextAlarm;
                    nearestDevice = device;
                }
            }
        });

        if (!nearestAlarm || !nearestDevice) return null;

        // Get alarm configuration
        const service = nearestDevice.service;
        const config = service._sharedAlarmConfig;
        
        return {
            device: nearestDevice,
            alarm: nearestAlarm,
            config: config,
            msUntil: nearestAlarm.date - now,
            totalAlarms: service._scheduledAlarms.length,
            currentAlarmNumber: nearestAlarm.index + 1
        };
    }

    showAlarmInfo(info) {
        const { device, alarm, config, msUntil, totalAlarms, currentAlarmNumber } = info;

        // Update pillbox name
        this.elements.pillboxText.textContent = device.name;

        // Update time until alarm
        this.elements.timeText.textContent = this.formatTimeUntil(msUntil);

        // Update configuration text
        const ordinal = this.getOrdinal(currentAlarmNumber);
        const hours = config.frequency / 60;
        const hourText = hours === 1 ? 'hour' : 'hours';
        this.elements.configText.textContent = 
            `${ordinal} out of ${totalAlarms} every ${hours} ${hourText}`;

        // Update top text based on urgency
        if (msUntil < 60000) { // Less than 1 minute
            this.elements.toptext.textContent = "⏰ ALARM IMMINENT!";
            this.elements.focusBox.style.borderColor = '#ef4444';
        } else if (msUntil < 300000) { // Less than 5 minutes
            this.elements.toptext.textContent = "Next alarm soon";
            this.elements.focusBox.style.borderColor = '#f59e0b';
        } else {
            this.elements.toptext.textContent = "The next alarm is";
            this.elements.focusBox.style.borderColor = '#3b82f6';
        }

        // Show the focus box
        this.elements.focusBox.style.opacity = '1';
    }

    showNoAlarms() {
        this.elements.toptext.textContent = "No alarms scheduled";
        this.elements.pillboxText.textContent = "—";
        this.elements.timeText.textContent = "—";
        this.elements.configText.textContent = "Connect a device and set an alarm";
        this.elements.focusBox.style.borderColor = '#6b7280';
        this.elements.focusBox.style.opacity = '0.7';
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
    // Check if focus box exists
    if (document.getElementById('focusBox')) {
        focusBoxManager = new FocusBoxManager();
        console.log('🎯 Focus Box connected to Bluetooth Simulator');
    } else {
        console.warn('⚠️ Focus Box not found in DOM');
    }
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