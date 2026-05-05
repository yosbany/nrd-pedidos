// Standardized logging system for NRD applications
// This module provides structured logging for auditing and debugging

const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  AUDIT: 4 // Special level for audit logs
};

const LOG_COLORS = {
  DEBUG: '#6B7280',   // Gray
  INFO: '#3B82F6',    // Blue
  WARN: '#F59E0B',    // Orange
  ERROR: '#EF4444',   // Red
  AUDIT: '#10B981'    // Green
};

class Logger {
  constructor(appName, options = {}) {
    this.appName = appName;
    this.logLevel = options.logLevel !== undefined ? options.logLevel : LOG_LEVELS.INFO;
    this.enableColors = options.enableColors !== undefined ? options.enableColors : true;
    this.enableTimestamp = options.enableTimestamp !== undefined ? options.enableTimestamp : true;
    this.enableStack = options.enableStack !== undefined ? options.enableStack : false;
  }

  // Format timestamp
  getTimestamp() {
    if (!this.enableTimestamp) return '';
    const now = new Date();
    return now.toISOString();
  }

  // Format log message
  formatMessage(level, message, data = null) {
    const timestamp = this.getTimestamp();
    const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level);
    
    const parts = [];
    if (timestamp) parts.push(`[${timestamp}]`);
    parts.push(`[${this.appName}]`);
    parts.push(`[${levelName}]`);
    parts.push(message);
    
    return parts.join(' ');
  }

  // Format data for logging
  formatData(data) {
    if (data === null || data === undefined) return null;
    if (data instanceof Error) {
      const errorObj = {
        name: data.name,
        message: data.message,
        stack: this.enableStack ? data.stack : undefined
      };
      return errorObj;
    }
    try {
      return JSON.parse(JSON.stringify(data));
    } catch (e) {
      return String(data);
    }
  }

  // Log with level
  log(level, message, data = null) {
    if (level < this.logLevel) return;

    const formattedMessage = this.formatMessage(level, message, data);
    const formattedData = this.formatData(data);
    const levelName = Object.keys(LOG_LEVELS).find(key => LOG_LEVELS[key] === level);
    const color = this.enableColors ? LOG_COLORS[levelName] : null;

    const logMethod = level === LOG_LEVELS.ERROR ? console.error :
                     level === LOG_LEVELS.WARN ? console.warn :
                     console.log;

    if (color && this.enableColors) {
      logMethod(`%c${formattedMessage}`, `color: ${color}; font-weight: bold`, formattedData || '');
    } else {
      logMethod(formattedMessage, formattedData || '');
    }
  }

  // Public API methods
  debug(message, data = null) {
    this.log(LOG_LEVELS.DEBUG, message, data);
  }

  info(message, data = null) {
    this.log(LOG_LEVELS.INFO, message, data);
  }

  warn(message, data = null) {
    this.log(LOG_LEVELS.WARN, message, data);
  }

  error(message, error = null) {
    this.log(LOG_LEVELS.ERROR, message, error);
  }

  // Audit logging for important events (user actions, data changes, etc.)
  audit(action, details = null) {
    const auditData = {
      action,
      timestamp: new Date().toISOString(),
      user: this.getCurrentUser(),
      details
    };
    this.log(LOG_LEVELS.AUDIT, `AUDIT: ${action}`, auditData);
  }

  // Get current user for audit logs
  getCurrentUser() {
    try {
      // Try to get user from nrd if available
      if (typeof window !== 'undefined' && window.nrd && window.nrd.auth) {
        const user = window.nrd.auth.getCurrentUser();
        return user ? {
          uid: user.uid,
          email: user.email
        } : null;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  // Group logs together
  group(label) {
    console.group(`[${this.appName}] ${label}`);
  }

  groupEnd() {
    console.groupEnd();
  }

  // Log performance
  time(label) {
    console.time(`[${this.appName}] ${label}`);
  }

  timeEnd(label) {
    console.timeEnd(`[${this.appName}] ${label}`);
  }
}

// Create and export default logger instance
const logger = new Logger('NRD Pedidos', {
  logLevel: LOG_LEVELS.DEBUG, // Change to INFO in production
  enableColors: true,
  enableTimestamp: true,
  enableStack: false
});

// Export logger instance and Logger class
window.logger = logger;
