/**
 * System Recovery - Full System Recovery Layer (Feature #3, Phase 3)
 *
 * Performs startup validation and recovery for daemon state, configuration,
 * and allocation integrity.
 */

const fs = require('fs');
const path = require('path');
const Logger = require('./logger');

class SystemRecovery {
  constructor(daemon) {
    if (!daemon) {
      throw new Error('Daemon instance required for SystemRecovery');
    }

    this.daemon = daemon;
    this.logger = new Logger({ component: 'system-recovery' });

    // Configuration (from daemon's recovery config)
    this.config = daemon.recoveryConfig?.system_recovery || {
      enabled: false,
      run_on_startup: false,
      backup_corrupted_state: true,
      max_recovery_attempts: 3
    };
  }

  /**
   * Perform full system recovery on startup
   * @returns {Promise<Object>} Recovery results
   */
  async performRecoveryOnStartup() {
    if (!this.config.enabled || !this.config.run_on_startup) {
      this.logger.info('System recovery is disabled');
      return { skipped: true };
    }

    this.logger.info('Performing system recovery checks...');

    const steps = [
      { name: 'Validate state file', fn: () => this.validateStateFile() },
      { name: 'Validate config file', fn: () => this.validateConfigFile() },
      { name: 'Clean orphaned allocations', fn: () => this.cleanOrphanedAllocations() },
      { name: 'Verify singleton integrity', fn: () => this.verifySingletonIntegrity() },
      { name: 'Rebuild indices', fn: () => this.rebuildIndices() },
    ];

    const results = {
      success: [],
      failed: [],
      warnings: []
    };

    for (const step of steps) {
      try {
        const result = await step.fn();
        results.success.push({ step: step.name, result });
        this.logger.info(`✅ ${step.name}: OK`, result);
      } catch (error) {
        results.failed.push({ step: step.name, error: error.message });
        this.logger.error(`❌ ${step.name}: FAILED`, { error: error.message });

        // Attempt automatic repair
        const repaired = await this.attemptRepair(step.name, error);
        if (repaired) {
          results.warnings.push({ step: step.name, action: 'auto-repaired' });
        }
      }
    }

    // Log summary
    this.logger.audit('SYSTEM_RECOVERY_COMPLETE', {
      success_count: results.success.length,
      failed_count: results.failed.length,
      warning_count: results.warnings.length,
      results
    });

    return results;
  }

  /**
   * Validate state file structure and integrity
   * @returns {Promise<Object>} Validation result
   */
  async validateStateFile() {
    const statePath = this.daemon.stateFile;

    if (!fs.existsSync(statePath)) {
      this.logger.warn('State file not found, will create new');
      return { created: true, valid: true };
    }

    try {
      const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      // Validate structure
      if (!stateData.allocations || !Array.isArray(stateData.allocations)) {
        throw new Error('Invalid state structure: missing allocations array');
      }

      if (!stateData.singletonServices || typeof stateData.singletonServices !== 'object') {
        throw new Error('Invalid state structure: missing singletonServices object');
      }

      // Validate allocation objects
      for (const allocation of stateData.allocations) {
        if (!allocation.port || !allocation.lockId) {
          throw new Error(`Invalid allocation: missing required fields (port: ${allocation.port})`);
        }
      }

      this.logger.info('State file validation passed', {
        allocation_count: stateData.allocations.length,
        singleton_count: Object.keys(stateData.singletonServices).length
      });

      return {
        valid: true,
        allocationCount: stateData.allocations.length,
        singletonCount: Object.keys(stateData.singletonServices).length
      };
    } catch (error) {
      throw new Error(`State file corrupted: ${error.message}`);
    }
  }

  /**
   * Validate config file structure
   * @returns {Promise<Object>} Validation result
   */
  async validateConfigFile() {
    const userConfigPath = path.join(this.daemon.configDir, 'config.json');

    // User config is optional
    if (!fs.existsSync(userConfigPath)) {
      this.logger.info('No user config file, using defaults');
      return { valid: true, user_config: false };
    }

    try {
      const config = JSON.parse(fs.readFileSync(userConfigPath, 'utf8'));

      // Check for basic structure
      if (config.service_types && typeof config.service_types !== 'object') {
        throw new Error('Invalid config: service_types must be an object');
      }

      if (config.auto_allocation && typeof config.auto_allocation !== 'object') {
        throw new Error('Invalid config: auto_allocation must be an object');
      }

      if (config.recovery && typeof config.recovery !== 'object') {
        throw new Error('Invalid config: recovery must be an object');
      }

      this.logger.info('Config file validation passed');

      return {
        valid: true,
        has_service_types: !!config.service_types,
        has_auto_allocation: !!config.auto_allocation,
        has_recovery: !!config.recovery
      };
    } catch (error) {
      throw new Error(`Config file invalid: ${error.message}`);
    }
  }

  /**
   * Clean orphaned allocations (dead processes, abandoned ports)
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanOrphanedAllocations() {
    const allocations = Array.from(this.daemon.allocations.values());
    let cleanedCount = 0;
    const cleaned = [];

    this.logger.info('Checking for orphaned allocations', {
      total_allocations: allocations.length
    });

    for (const allocation of allocations) {
      let orphaned = false;
      let reason = '';

      // Check 1: Process still running
      if (allocation.process_id) {
        try {
          process.kill(allocation.process_id, 0);
        } catch (err) {
          if (err.code === 'ESRCH') {
            orphaned = true;
            reason = `dead process (PID ${allocation.process_id})`;
          }
        }
      }

      // Check 2: Port actually in use (only if not already orphaned)
      if (!orphaned) {
        const available = await this.daemon.checkPortActuallyAvailable(allocation.port);
        if (available) {
          orphaned = true;
          reason = 'port not in use';
        }
      }

      // Clean up orphaned allocation
      if (orphaned) {
        this.logger.warn('Cleaning orphaned allocation', {
          port: allocation.port,
          serviceType: allocation.serviceType,
          reason
        });

        try {
          await this.daemon.releasePort(allocation.port, allocation.lockId);
          cleanedCount++;
          cleaned.push({
            port: allocation.port,
            serviceType: allocation.serviceType,
            reason
          });
        } catch (error) {
          this.logger.error('Failed to release orphaned allocation', {
            port: allocation.port,
            error: error.message
          });
        }
      }
    }

    this.logger.info('Orphaned allocation cleanup complete', {
      total_checked: allocations.length,
      cleaned: cleanedCount
    });

    return { cleaned: cleanedCount, details: cleaned };
  }

  /**
   * Verify singleton service integrity
   * Ensures singleton services have at most one allocation
   * @returns {Promise<Object>} Verification result
   */
  async verifySingletonIntegrity() {
    const singletonTypes = this.getSingletonServiceTypes();
    const allocations = Array.from(this.daemon.allocations.values());

    this.logger.info('Verifying singleton integrity', {
      singleton_types: singletonTypes.length,
      total_allocations: allocations.length
    });

    const singletonAllocations = {};
    let fixed = 0;
    const fixes = [];

    for (const allocation of allocations) {
      if (singletonTypes.includes(allocation.serviceType)) {
        if (!singletonAllocations[allocation.serviceType]) {
          // First allocation for this singleton type
          singletonAllocations[allocation.serviceType] = allocation;
        } else {
          // Duplicate singleton allocation - keep the newer one
          const existing = singletonAllocations[allocation.serviceType];
          const existingTime = new Date(existing.allocated_at).getTime();
          const currentTime = new Date(allocation.allocated_at).getTime();

          const toRemove = currentTime > existingTime ? existing : allocation;
          const toKeep = currentTime > existingTime ? allocation : existing;

          this.logger.warn('Removing duplicate singleton allocation', {
            serviceType: allocation.serviceType,
            removed_port: toRemove.port,
            kept_port: toKeep.port
          });

          try {
            await this.daemon.releasePort(toRemove.port, toRemove.lockId);
            fixed++;
            fixes.push({
              serviceType: allocation.serviceType,
              removed_port: toRemove.port,
              kept_port: toKeep.port
            });

            // Update tracking to keep the newer one
            singletonAllocations[allocation.serviceType] = toKeep;
          } catch (error) {
            this.logger.error('Failed to remove duplicate singleton', {
              port: toRemove.port,
              error: error.message
            });
          }
        }
      }
    }

    this.logger.info('Singleton integrity verification complete', {
      singleton_types: singletonTypes.length,
      duplicates_fixed: fixed
    });

    return { fixed, details: fixes };
  }

  /**
   * Get list of singleton service types
   * @returns {Array<string>} Service types configured as singleton
   */
  getSingletonServiceTypes() {
    const singletonTypes = [];

    for (const [serviceType, config] of Object.entries(this.daemon.serviceTypes)) {
      if (config.instance_behavior === 'single') {
        singletonTypes.push(serviceType);
      }
    }

    return singletonTypes;
  }

  /**
   * Rebuild in-memory indices from state
   * @returns {Promise<Object>} Rebuild result
   */
  async rebuildIndices() {
    // Currently the daemon loads state directly into Maps
    // This is a placeholder for future index structures

    this.logger.info('Rebuilding indices');

    // Verify allocation index integrity
    const allocationCount = this.daemon.allocations.size;
    const instanceCount = this.daemon.instances.size;
    const singletonCount = this.daemon.singletonServices.size;

    this.logger.info('Index rebuild complete', {
      allocations: allocationCount,
      instances: instanceCount,
      singletons: singletonCount
    });

    return {
      rebuilt: true,
      allocations: allocationCount,
      instances: instanceCount,
      singletons: singletonCount
    };
  }

  /**
   * Attempt to repair a failed recovery step
   * @param {string} stepName - Name of the failed step
   * @param {Error} error - Error that occurred
   * @returns {Promise<boolean>} True if repaired
   */
  async attemptRepair(stepName, error) {
    switch (stepName) {
      case 'Validate state file':
        return await this.repairStateFile(error);

      case 'Validate config file':
        this.logger.error('Config file invalid - manual intervention required', {
          error: error.message
        });
        return false; // Can't auto-repair config

      case 'Clean orphaned allocations':
        this.logger.warn('Orphan cleanup failed, continuing anyway');
        return true; // Non-critical failure

      case 'Verify singleton integrity':
        this.logger.warn('Singleton verification failed, continuing anyway');
        return true; // Non-critical failure

      case 'Rebuild indices':
        this.logger.warn('Index rebuild failed, continuing anyway');
        return true; // Non-critical failure

      default:
        this.logger.warn(`No auto-repair available for: ${stepName}`);
        return false;
    }
  }

  /**
   * Repair corrupted state file
   * @param {Error} error - Error that occurred during validation
   * @returns {Promise<boolean>} True if repaired
   */
  async repairStateFile(error) {
    const statePath = this.daemon.stateFile;

    // Create backup if file exists and backup is enabled
    if (fs.existsSync(statePath) && this.config.backup_corrupted_state) {
      const backup = `${statePath}.corrupt.${Date.now()}`;
      try {
        fs.copyFileSync(statePath, backup);
        this.logger.warn('Backed up corrupted state', { backup_path: backup });
      } catch (backupError) {
        this.logger.error('Failed to backup corrupted state', {
          error: backupError.message
        });
      }
    }

    // Initialize new state
    try {
      const emptyState = {
        allocations: [],
        instances: [],
        singletonServices: {},
        version: '1.0'
      };

      fs.writeFileSync(statePath, JSON.stringify(emptyState, null, 2));
      this.logger.info('Initialized new state file after corruption');

      // Reload the new state
      await this.daemon.loadState();

      return true;
    } catch (repairError) {
      this.logger.error('Failed to repair state file', {
        error: repairError.message
      });
      return false;
    }
  }

  /**
   * Get recovery statistics
   * @returns {Object} Statistics
   */
  getStatistics() {
    return {
      enabled: this.config.enabled,
      run_on_startup: this.config.run_on_startup,
      backup_corrupted_state: this.config.backup_corrupted_state,
      max_recovery_attempts: this.config.max_recovery_attempts
    };
  }
}

module.exports = SystemRecovery;
