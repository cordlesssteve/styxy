/**
 * Audit Logger for Auto-Allocation Events (Feature #2)
 *
 * Provides comprehensive audit trail of all auto-allocation activities:
 * - JSON lines format for easy parsing
 * - Automatic log rotation
 * - Query and filtering capabilities
 * - Immutable append-only logging
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class AuditLogger {
  constructor(configDir) {
    this.configDir = configDir || path.join(process.env.HOME, '.styxy');
    this.auditFile = path.join(this.configDir, 'audit.log');
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
    this.maxRotatedLogs = 5;

    // Ensure audit directory exists
    this.ensureAuditDirectory();
  }

  /**
   * Log an auto-allocation event
   */
  log(action, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      action,
      ...data,
      user: os.userInfo().username,
      pid: process.pid,
      hostname: os.hostname()
    };

    this.writeLogEntry(logEntry);
  }

  /**
   * Write a log entry to the audit file
   */
  writeLogEntry(entry) {
    try {
      // Check if rotation needed before writing
      this.checkRotation();

      // Append JSON line
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.auditFile, line, { mode: 0o600 });
    } catch (error) {
      // Log to console if file write fails
      console.error('Failed to write audit log:', error.message);
    }
  }

  /**
   * Check if log rotation is needed and perform if necessary
   */
  checkRotation() {
    if (!fs.existsSync(this.auditFile)) {
      return; // File doesn't exist yet
    }

    try {
      const stats = fs.statSync(this.auditFile);

      if (stats.size >= this.maxFileSize) {
        this.rotateLog();
      }
    } catch (error) {
      console.error('Failed to check log rotation:', error.message);
    }
  }

  /**
   * Rotate the current audit log
   */
  rotateLog() {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const rotatedFile = `${this.auditFile}.${timestamp}`;

      // Rename current log
      fs.renameSync(this.auditFile, rotatedFile);

      // Cleanup old rotated logs
      this.cleanupRotatedLogs();
    } catch (error) {
      console.error('Failed to rotate audit log:', error.message);
    }
  }

  /**
   * Clean up old rotated logs, keeping only the most recent N
   */
  cleanupRotatedLogs() {
    try {
      const dir = path.dirname(this.auditFile);
      const baseFilename = path.basename(this.auditFile);

      // Find all rotated log files
      const files = fs.readdirSync(dir)
        .filter(f => f.startsWith(baseFilename + '.'))
        .map(f => ({
          name: f,
          path: path.join(dir, f),
          mtime: fs.statSync(path.join(dir, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

      // Delete old logs
      if (files.length > this.maxRotatedLogs) {
        const filesToDelete = files.slice(this.maxRotatedLogs);
        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup rotated logs:', error.message);
    }
  }

  /**
   * Get recent audit entries
   */
  getRecentAudits(limit = 100) {
    if (!fs.existsSync(this.auditFile)) {
      return [];
    }

    try {
      const content = fs.readFileSync(this.auditFile, 'utf8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);

      // Get last N lines
      const recentLines = lines.slice(-limit);

      // Parse JSON
      return recentLines.map(line => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      }).filter(entry => entry !== null);
    } catch (error) {
      console.error('Failed to read audit log:', error.message);
      return [];
    }
  }

  /**
   * Get audit entries by action type
   */
  getAuditsByAction(action, limit = 100) {
    const allAudits = this.getRecentAudits(limit * 2); // Get more to filter
    return allAudits
      .filter(entry => entry.action === action)
      .slice(-limit);
  }

  /**
   * Get audit entries by service type
   */
  getAuditsByServiceType(serviceType, limit = 100) {
    const allAudits = this.getRecentAudits(limit * 2); // Get more to filter
    return allAudits
      .filter(entry => entry.serviceType === serviceType)
      .slice(-limit);
  }

  /**
   * Get audit entries within a time range
   */
  getAuditsByTimeRange(startTime, endTime, limit = 100) {
    const allAudits = this.getRecentAudits(limit * 2);
    const start = new Date(startTime).getTime();
    const end = new Date(endTime).getTime();

    return allAudits
      .filter(entry => {
        const entryTime = new Date(entry.timestamp).getTime();
        return entryTime >= start && entryTime <= end;
      })
      .slice(-limit);
  }

  /**
   * Get summary statistics for audit log
   */
  getStatistics() {
    const allAudits = this.getRecentAudits(1000); // Get last 1000 entries

    if (allAudits.length === 0) {
      return {
        totalEntries: 0,
        byAction: {},
        byServiceType: {},
        oldestEntry: null,
        newestEntry: null
      };
    }

    const byAction = {};
    const byServiceType = {};

    for (const entry of allAudits) {
      // Count by action
      byAction[entry.action] = (byAction[entry.action] || 0) + 1;

      // Count by service type
      if (entry.serviceType) {
        byServiceType[entry.serviceType] = (byServiceType[entry.serviceType] || 0) + 1;
      }
    }

    return {
      totalEntries: allAudits.length,
      byAction,
      byServiceType,
      oldestEntry: allAudits[0].timestamp,
      newestEntry: allAudits[allAudits.length - 1].timestamp
    };
  }

  /**
   * Search audit log by custom filter function
   */
  search(filterFn, limit = 100) {
    const allAudits = this.getRecentAudits(limit * 2);
    return allAudits.filter(filterFn).slice(-limit);
  }

  /**
   * Export audit log to JSON file
   */
  export(outputFile) {
    const allAudits = this.getRecentAudits(10000); // Export last 10000 entries

    try {
      const json = JSON.stringify(allAudits, null, 2);
      fs.writeFileSync(outputFile, json, { mode: 0o600 });
      return allAudits.length;
    } catch (error) {
      throw new Error(`Failed to export audit log: ${error.message}`);
    }
  }

  /**
   * Clear audit log (use with caution)
   */
  clear() {
    if (fs.existsSync(this.auditFile)) {
      // Create backup before clearing
      const backupFile = `${this.auditFile}.backup-${Date.now()}`;
      fs.copyFileSync(this.auditFile, backupFile);

      // Clear the log
      fs.writeFileSync(this.auditFile, '', { mode: 0o600 });
    }
  }

  /**
   * Get audit log file size
   */
  getFileSize() {
    if (!fs.existsSync(this.auditFile)) {
      return 0;
    }

    try {
      const stats = fs.statSync(this.auditFile);
      return stats.size;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get human-readable file size
   */
  getFileSizeFormatted() {
    const bytes = this.getFileSize();

    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Ensure audit directory exists
   */
  ensureAuditDirectory() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }
  }
}

module.exports = AuditLogger;
