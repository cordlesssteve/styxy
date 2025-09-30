/**
 * Config Writer for Safe Auto-Allocation Updates (Feature #2)
 *
 * Provides atomic, safe writing to configuration files with:
 * - File locking (prevents concurrent modifications)
 * - Automatic backups
 * - Atomic writes (temp file + rename)
 * - Validation before committing
 */

const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

class ConfigWriter {
  constructor(configDir) {
    this.configDir = configDir || path.join(process.env.HOME, '.styxy');
    this.configFile = path.join(__dirname, '../../config/core-ports.json');
    this.userConfigFile = path.join(this.configDir, 'config.json');
    this.backupDir = path.join(this.configDir, 'config-backups');
    this.lockOptions = {
      stale: 10000, // 10 seconds
      retries: {
        retries: 5,
        minTimeout: 100,
        maxTimeout: 1000
      }
    };
  }

  /**
   * Add a new service type to the user configuration
   *
   * @param {string} serviceTypeName - Name of the service type
   * @param {array} portRange - [startPort, endPort]
   * @param {object} metadata - Additional service type metadata
   * @param {object} options - Write options
   * @returns {object} Updated configuration
   */
  async addServiceType(serviceTypeName, portRange, metadata = {}, options = {}) {
    // Validate inputs
    if (!serviceTypeName || typeof serviceTypeName !== 'string') {
      throw new Error('Service type name is required');
    }

    if (!Array.isArray(portRange) || portRange.length !== 2) {
      throw new Error('Port range must be an array of [start, end]');
    }

    const [start, end] = portRange;
    if (start >= end) {
      throw new Error(`Invalid port range: start (${start}) must be less than end (${end})`);
    }

    // Ensure directories exist
    this.ensureDirectories();

    // Create backup before modification
    await this.createBackup();

    // Lock the config file
    const release = await this.lockConfigFile();

    try {
      // Load current user config (or create new)
      let config = this.loadUserConfig();

      // Add new service type
      if (!config.service_types) {
        config.service_types = {};
      }

      // Check if service type already exists
      if (config.service_types[serviceTypeName] && !options.overwrite) {
        throw new Error(`Service type '${serviceTypeName}' already exists (use overwrite option to replace)`);
      }

      config.service_types[serviceTypeName] = {
        description: metadata.description || `Auto-allocated service type for ${serviceTypeName}`,
        preferred_ports: [start, start + 1, start + 2, start + 3],
        port_range: portRange,
        multi_instance_pattern: metadata.multi_instance_pattern || 'sequential',
        instance_behavior: metadata.instance_behavior || 'multi',
        examples: metadata.examples || [],
        auto_allocated: true,
        auto_allocated_at: new Date().toISOString()
      };

      // Write atomically
      await this.writeAtomically(config, this.userConfigFile);

      return config;
    } finally {
      // Always release the lock
      await release();
    }
  }

  /**
   * Load user configuration file
   */
  loadUserConfig() {
    if (!fs.existsSync(this.userConfigFile)) {
      return {
        service_types: {}
      };
    }

    try {
      const content = fs.readFileSync(this.userConfigFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      throw new Error(`Failed to load user config: ${error.message}`);
    }
  }

  /**
   * Lock the configuration file for exclusive access
   */
  async lockConfigFile() {
    // Ensure config directory exists
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }

    // Create a lock file
    const lockFilePath = path.join(this.configDir, 'config.lock');

    // Ensure lock file exists
    if (!fs.existsSync(lockFilePath)) {
      fs.writeFileSync(lockFilePath, '', { mode: 0o600 });
    }

    try {
      const release = await lockfile.lock(lockFilePath, this.lockOptions);
      return release;
    } catch (error) {
      throw new Error(`Failed to acquire config lock: ${error.message}`);
    }
  }

  /**
   * Create a timestamped backup of the user config file
   */
  async createBackup() {
    if (!fs.existsSync(this.userConfigFile)) {
      return null; // No config to backup
    }

    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    }

    // Create timestamped backup filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(this.backupDir, `config-${timestamp}.json`);

    try {
      // Copy config to backup
      fs.copyFileSync(this.userConfigFile, backupFile);

      // Cleanup old backups (keep last 10)
      await this.rotateBackups(10);

      return backupFile;
    } catch (error) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Rotate backups, keeping only the most recent N backups
   */
  async rotateBackups(keepCount = 10) {
    if (!fs.existsSync(this.backupDir)) {
      return;
    }

    try {
      // Get all backup files
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('config-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          mtime: fs.statSync(path.join(this.backupDir, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

      // Delete old backups
      if (files.length > keepCount) {
        const filesToDelete = files.slice(keepCount);
        for (const file of filesToDelete) {
          fs.unlinkSync(file.path);
        }
      }
    } catch (error) {
      // Log but don't throw - backup rotation failure shouldn't block the operation
      console.warn('Failed to rotate backups:', error.message);
    }
  }

  /**
   * Write configuration atomically using temp file + rename
   */
  async writeAtomically(config, targetFile) {
    const tempFile = `${targetFile}.tmp`;

    try {
      // Validate JSON before writing
      const json = JSON.stringify(config, null, 2);
      JSON.parse(json); // Verify it's valid JSON

      // Write to temp file
      fs.writeFileSync(tempFile, json, { mode: 0o600 });

      // Verify temp file is valid
      const tempContent = fs.readFileSync(tempFile, 'utf8');
      JSON.parse(tempContent); // Verify written content is valid

      // Atomic rename
      fs.renameSync(tempFile, targetFile);

      return true;
    } catch (error) {
      // Cleanup temp file on error
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      throw new Error(`Failed to write config atomically: ${error.message}`);
    }
  }

  /**
   * Ensure required directories exist
   */
  ensureDirectories() {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
    }

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Remove an auto-allocated service type (for rollback)
   */
  async removeServiceType(serviceTypeName) {
    const release = await this.lockConfigFile();

    try {
      let config = this.loadUserConfig();

      if (!config.service_types || !config.service_types[serviceTypeName]) {
        throw new Error(`Service type '${serviceTypeName}' not found`);
      }

      // Verify it was auto-allocated (don't remove manual configs)
      if (!config.service_types[serviceTypeName].auto_allocated) {
        throw new Error(`Service type '${serviceTypeName}' was not auto-allocated, cannot remove`);
      }

      // Create backup before removal
      await this.createBackup();

      // Remove service type
      delete config.service_types[serviceTypeName];

      // Write atomically
      await this.writeAtomically(config, this.userConfigFile);

      return config;
    } finally {
      await release();
    }
  }

  /**
   * Get list of auto-allocated service types
   */
  getAutoAllocatedServiceTypes() {
    const config = this.loadUserConfig();

    if (!config.service_types) {
      return [];
    }

    const autoAllocated = [];
    for (const [name, definition] of Object.entries(config.service_types)) {
      if (definition.auto_allocated) {
        autoAllocated.push({
          name,
          range: definition.port_range,
          allocatedAt: definition.auto_allocated_at
        });
      }
    }

    return autoAllocated;
  }

  /**
   * Get list of available backups
   */
  getBackups() {
    if (!fs.existsSync(this.backupDir)) {
      return [];
    }

    try {
      const files = fs.readdirSync(this.backupDir)
        .filter(f => f.startsWith('config-') && f.endsWith('.json'))
        .map(f => ({
          name: f,
          path: path.join(this.backupDir, f),
          mtime: fs.statSync(path.join(this.backupDir, f)).mtime
        }))
        .sort((a, b) => b.mtime - a.mtime);

      return files;
    } catch (error) {
      return [];
    }
  }

  /**
   * Restore from a backup
   */
  async restoreFromBackup(backupFile) {
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file not found: ${backupFile}`);
    }

    const release = await this.lockConfigFile();

    try {
      // Verify backup is valid JSON
      const content = fs.readFileSync(backupFile, 'utf8');
      const config = JSON.parse(content);

      // Create backup of current config before restoring
      await this.createBackup();

      // Write atomically
      await this.writeAtomically(config, this.userConfigFile);

      return config;
    } finally {
      await release();
    }
  }
}

module.exports = ConfigWriter;
