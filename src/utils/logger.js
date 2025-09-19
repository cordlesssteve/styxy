/**
 * Structured Logging System
 *
 * Provides centralized, configurable logging with structured output
 * for better monitoring and debugging capabilities.
 */

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(options = {}) {
    this.level = options.level || process.env.STYXY_LOG_LEVEL || 'info';
    this.logDir = options.logDir || path.join(process.env.HOME, '.styxy', 'logs');
    this.enableConsole = options.enableConsole !== false;
    this.enableFile = options.enableFile !== false;
    this.component = options.component || 'styxy';

    // Reduce console spam in test environment
    if (process.env.NODE_ENV === 'test') {
      this.enableConsole = false;
      this.enableFile = false;
    }

    // Ensure log directory exists
    if (this.enableFile) {
      this.ensureLogDirectory();
    }

    // Log levels (higher number = more verbose)
    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };

    this.currentLevel = this.levels[this.level] || this.levels.info;
  }

  ensureLogDirectory() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create log directory:', error.message);
    }
  }

  shouldLog(level) {
    return this.levels[level] <= this.currentLevel;
  }

  formatMessage(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      component: this.component,
      message,
      ...meta
    };

    // Add process info for error logs
    if (level === 'error' && !meta.pid) {
      logEntry.pid = process.pid;
      logEntry.memory = process.memoryUsage();
    }

    return logEntry;
  }

  writeToFile(logEntry) {
    if (!this.enableFile) return;

    try {
      const logFile = path.join(this.logDir, `styxy-${new Date().toISOString().split('T')[0]}.log`);
      const logLine = JSON.stringify(logEntry) + '\n';
      fs.appendFileSync(logFile, logLine);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  writeToConsole(logEntry) {
    if (!this.enableConsole) return;

    const { timestamp, level, component, message, ...meta } = logEntry;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';

    const output = `[${timestamp}] ${level} [${component}] ${message}${metaStr}`;

    switch (level.toLowerCase()) {
      case 'error':
        console.error(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      default:
        console.log(output);
    }
  }

  log(level, message, meta = {}) {
    if (!this.shouldLog(level)) return;

    const logEntry = this.formatMessage(level, message, meta);

    this.writeToConsole(logEntry);
    this.writeToFile(logEntry);
  }

  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  trace(message, meta = {}) {
    this.log('trace', message, meta);
  }

  // Audit logging for security events
  audit(event, details = {}) {
    this.log('info', `AUDIT: ${event}`, {
      audit: true,
      event,
      timestamp: new Date().toISOString(),
      ...details
    });
  }

  // Performance logging
  performance(operation, duration, meta = {}) {
    this.log('debug', `PERF: ${operation} took ${duration}ms`, {
      performance: true,
      operation,
      duration,
      ...meta
    });
  }

  // Create child logger with additional context
  child(additionalMeta = {}) {
    const childLogger = new Logger({
      level: this.level,
      logDir: this.logDir,
      enableConsole: this.enableConsole,
      enableFile: this.enableFile,
      component: this.component
    });

    // Override log method to include additional metadata
    const originalLog = childLogger.log.bind(childLogger);
    childLogger.log = (level, message, meta = {}) => {
      return originalLog(level, message, { ...additionalMeta, ...meta });
    };

    return childLogger;
  }
}

// Create default logger instance
const defaultLogger = new Logger();

module.exports = Logger;
module.exports.default = defaultLogger;