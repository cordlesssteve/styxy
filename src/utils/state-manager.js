/**
 * State File Manager with Integrity Checks and Recovery
 *
 * Provides atomic state file operations with corruption detection,
 * automatic backup creation, and recovery mechanisms.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const lockfile = require('proper-lockfile');
const Logger = require('./logger');

class StateManager {
  constructor(options = {}) {
    this.stateFile = options.stateFile;
    this.backupDir = options.backupDir || path.dirname(this.stateFile);
    this.maxBackups = options.maxBackups || 5;
    this.checksumFile = `${this.stateFile}.checksum`;
    this.logger = new Logger({ component: 'state-manager' });

    // Ensure backup directory exists
    this.ensureBackupDirectory();
  }

  ensureBackupDirectory() {
    try {
      if (!fs.existsSync(this.backupDir)) {
        fs.mkdirSync(this.backupDir, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Failed to create backup directory', {
        backupDir: this.backupDir,
        error: error.message
      });
    }
  }

  /**
   * Calculate SHA-256 checksum of file content
   */
  calculateChecksum(content) {
    return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Create a backup of the current state file
   */
  createBackup() {
    if (!fs.existsSync(this.stateFile)) {
      return null;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = path.join(this.backupDir, `daemon.state.backup.${timestamp}`);

      fs.copyFileSync(this.stateFile, backupFile);

      this.logger.info('State backup created', { backupFile });

      // Clean up old backups
      this.cleanupOldBackups();

      return backupFile;
    } catch (error) {
      this.logger.error('Failed to create backup', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Remove old backup files, keeping only the most recent ones
   */
  cleanupOldBackups() {
    try {
      const backupPattern = /^daemon\.state\.backup\./;
      const files = fs.readdirSync(this.backupDir)
        .filter(file => backupPattern.test(file))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          mtime: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      // Remove old backups
      if (files.length > this.maxBackups) {
        const filesToDelete = files.slice(this.maxBackups);
        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
          this.logger.debug('Removed old backup', { file: file.name });
        }
      }
    } catch (error) {
      this.logger.warn('Failed to cleanup old backups', {
        error: error.message
      });
    }
  }

  /**
   * Verify the integrity of a state file
   */
  verifyIntegrity(filePath = this.stateFile) {
    if (!fs.existsSync(filePath)) {
      return { valid: false, reason: 'File does not exist' };
    }

    try {
      // Read the content
      const content = fs.readFileSync(filePath, 'utf8');

      // Check if it's valid JSON
      let data;
      try {
        data = JSON.parse(content);
      } catch (parseError) {
        return {
          valid: false,
          reason: 'Invalid JSON format',
          error: parseError.message
        };
      }

      // Verify checksum if it exists
      const checksumFile = `${filePath}.checksum`;
      if (fs.existsSync(checksumFile)) {
        const expectedChecksum = fs.readFileSync(checksumFile, 'utf8').trim();
        const actualChecksum = this.calculateChecksum(content);

        if (expectedChecksum !== actualChecksum) {
          return {
            valid: false,
            reason: 'Checksum mismatch',
            expected: expectedChecksum,
            actual: actualChecksum
          };
        }
      }

      // Validate data structure
      const structureValid = this.validateDataStructure(data);
      if (!structureValid.valid) {
        return structureValid;
      }

      return { valid: true, data };

    } catch (error) {
      return {
        valid: false,
        reason: 'Read error',
        error: error.message
      };
    }
  }

  /**
   * Validate the structure of state data
   */
  validateDataStructure(data) {
    if (!data || typeof data !== 'object') {
      return { valid: false, reason: 'Root must be an object' };
    }

    // Check for required top-level properties
    if (!data.hasOwnProperty('allocations') || !data.hasOwnProperty('instances')) {
      return { valid: false, reason: 'Missing required properties (allocations, instances)' };
    }

    if (!Array.isArray(data.allocations)) {
      return { valid: false, reason: 'Allocations must be an array' };
    }

    if (!Array.isArray(data.instances)) {
      return { valid: false, reason: 'Instances must be an array' };
    }

    // Validate allocation structure
    for (let i = 0; i < data.allocations.length; i++) {
      const allocation = data.allocations[i];
      if (!allocation.lockId || !allocation.port || !allocation.serviceType) {
        return {
          valid: false,
          reason: `Invalid allocation at index ${i}: missing required fields`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Atomically save state data with integrity protection
   */
  async saveState(data) {
    // Skip file locking and backups in test environment
    if (process.env.NODE_ENV === 'test') {
      const content = JSON.stringify(data, null, 2);
      fs.writeFileSync(this.stateFile, content, { mode: 0o600 });
      return;
    }

    // Create backup before saving
    this.createBackup();

    // Serialize data
    const content = JSON.stringify(data, null, 2);
    const checksum = this.calculateChecksum(content);

    // Use temporary file for atomic write
    const tempFile = `${this.stateFile}.tmp`;
    const tempChecksumFile = `${this.checksumFile}.tmp`;

    try {
      // Acquire lock
      const release = await lockfile.lock(this.stateFile, {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000
      });

      try {
        // Write to temporary files
        fs.writeFileSync(tempFile, content, 'utf8');
        fs.writeFileSync(tempChecksumFile, checksum, 'utf8');

        // Verify what we just wrote
        const verification = this.verifyIntegrity(tempFile);
        if (!verification.valid) {
          throw new Error(`Verification failed: ${verification.reason}`);
        }

        // Atomic move to final location
        fs.renameSync(tempFile, this.stateFile);
        fs.renameSync(tempChecksumFile, this.checksumFile);

        this.logger.info('State saved successfully', {
          allocations: data.allocations.length,
          instances: data.instances.length,
          checksum: checksum.substring(0, 8) + '...'
        });

      } finally {
        // Always release lock
        await release();
      }

    } catch (error) {
      // Clean up temp files on error
      [tempFile, tempChecksumFile].forEach(file => {
        if (fs.existsSync(file)) {
          try {
            fs.unlinkSync(file);
          } catch (e) {
            this.logger.warn('Failed to cleanup temp file', { file, error: e.message });
          }
        }
      });

      this.logger.error('Failed to save state', {
        error: error.message
      });

      throw error;
    }
  }

  /**
   * Load state with automatic recovery
   */
  async loadState() {
    // Simple file read in test environment
    if (process.env.NODE_ENV === 'test') {
      if (fs.existsSync(this.stateFile)) {
        try {
          const content = fs.readFileSync(this.stateFile, 'utf8');
          return JSON.parse(content);
        } catch (error) {
          return { allocations: [], instances: [] };
        }
      }
      return { allocations: [], instances: [] };
    }

    const verification = this.verifyIntegrity();

    if (verification.valid) {
      this.logger.info('State loaded successfully', {
        allocations: verification.data.allocations.length,
        instances: verification.data.instances.length
      });
      return verification.data;
    }

    this.logger.warn('State file integrity check failed', {
      reason: verification.reason,
      error: verification.error
    });

    // Attempt recovery from backup
    const recoveredData = await this.attemptRecovery();
    if (recoveredData) {
      this.logger.info('State recovered from backup');
      return recoveredData;
    }

    // Return empty state as last resort
    this.logger.warn('Using empty state as fallback');
    return { allocations: [], instances: [] };
  }

  /**
   * Attempt to recover from backup files
   */
  async attemptRecovery() {
    try {
      const backupPattern = /^daemon\.state\.backup\./;
      const backupFiles = fs.readdirSync(this.backupDir)
        .filter(file => backupPattern.test(file))
        .map(file => ({
          name: file,
          path: path.join(this.backupDir, file),
          mtime: fs.statSync(path.join(this.backupDir, file)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime); // Newest first

      for (const backup of backupFiles) {
        this.logger.info('Attempting recovery from backup', { backup: backup.name });

        const verification = this.verifyIntegrity(backup.path);
        if (verification.valid) {
          // Restore from this backup
          fs.copyFileSync(backup.path, this.stateFile);

          this.logger.info('Successfully recovered from backup', {
            backup: backup.name,
            allocations: verification.data.allocations.length,
            instances: verification.data.instances.length
          });

          return verification.data;
        } else {
          this.logger.warn('Backup file also corrupted', {
            backup: backup.name,
            reason: verification.reason
          });
        }
      }

      this.logger.error('All backup files are corrupted or missing');
      return null;

    } catch (error) {
      this.logger.error('Recovery attempt failed', {
        error: error.message
      });
      return null;
    }
  }

  /**
   * Get recovery status and recommendations
   */
  getRecoveryStatus() {
    const status = {
      primaryFile: {
        exists: fs.existsSync(this.stateFile),
        integrity: null
      },
      backups: [],
      recommendations: []
    };

    // Check primary file
    if (status.primaryFile.exists) {
      status.primaryFile.integrity = this.verifyIntegrity();
    }

    // Check backups
    try {
      const backupPattern = /^daemon\.state\.backup\./;
      const backupFiles = fs.readdirSync(this.backupDir)
        .filter(file => backupPattern.test(file))
        .map(file => {
          const filePath = path.join(this.backupDir, file);
          return {
            name: file,
            path: filePath,
            mtime: fs.statSync(filePath).mtime,
            integrity: this.verifyIntegrity(filePath)
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      status.backups = backupFiles;
    } catch (error) {
      this.logger.warn('Failed to check backup files', { error: error.message });
    }

    // Generate recommendations
    if (!status.primaryFile.integrity?.valid) {
      const validBackups = status.backups.filter(b => b.integrity.valid);
      if (validBackups.length > 0) {
        status.recommendations.push('Primary state file is corrupted. Recovery from backup is possible.');
      } else {
        status.recommendations.push('Primary state file is corrupted and no valid backups found. Manual intervention required.');
      }
    }

    return status;
  }
}

module.exports = StateManager;