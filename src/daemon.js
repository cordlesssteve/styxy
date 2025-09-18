/**
 * Styxy Daemon - Core Coordination Service
 * 
 * Background daemon that provides port coordination services
 * via HTTP API. Maintains in-memory state with filesystem
 * persistence for recovery.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const PortScanner = require('./utils/port-scanner');

class StyxyDaemon {
  constructor(options = {}) {
    this.port = options.port || 9876;
    this.configDir = options.configDir || path.join(process.env.HOME, '.styxy');
    this.stateFile = path.join(this.configDir, 'daemon.state');
    this.pidFile = path.join(this.configDir, 'daemon.pid');
    
    // In-memory state
    this.allocations = new Map();
    this.instances = new Map();
    this.serviceTypes = this.loadServiceTypes();
    this.portScanner = new PortScanner();
    
    // Express app setup
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
    
    // Process monitoring
    this.cleanupInterval = null;
    this.isShuttingDown = false;
  }
  
  /**
   * Load service type configurations
   */
  loadServiceTypes() {
    // Try to load CORE port configuration first
    const coreConfigFile = path.join(__dirname, '../config/core-ports.json');
    const userConfigFile = path.join(this.configDir, 'config.json');

    try {
      // Load CORE configuration as base
      let config = {};
      if (fs.existsSync(coreConfigFile)) {
        const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));
        config = this.transformCoreConfig(coreConfig.service_types);
        console.log('✅ Loaded CORE port configuration from ~/docs/CORE/PORT_REFERENCE_GUIDE.md');
      }

      // Override with user configuration if exists
      if (fs.existsSync(userConfigFile)) {
        const userConfig = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
        config = { ...config, ...(userConfig.service_types || {}) };
        console.log('✅ Applied user configuration overrides');
      }

      if (Object.keys(config).length > 0) {
        return config;
      }
    } catch (error) {
      console.warn('Failed to load configuration:', error.message);
    }

    // Fallback to minimal default
    return {
      dev: { preferred_ports: [3000], range: [3000, 3099] },
      api: { preferred_ports: [8000], range: [8000, 8099] }
    };
  }

  /**
   * Transform CORE config format to daemon format
   */
  transformCoreConfig(coreServiceTypes) {
    const transformed = {};

    for (const [serviceType, config] of Object.entries(coreServiceTypes)) {
      transformed[serviceType] = {
        preferred_ports: config.preferred_ports,
        range: config.port_range,
        description: config.description,
        examples: config.examples
      };
    }

    return transformed;
  }
  
  /**
   * Setup Express routes for HTTP API
   */
  setupRoutes() {
    // Port allocation endpoint
    this.app.post('/allocate', async (req, res) => {
      try {
        const result = await this.allocatePort(req.body);
        res.json(result);
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
    
    // Port release endpoint
    this.app.delete('/allocate/:lockId', (req, res) => {
      try {
        const result = this.releasePort(req.params.lockId);
        res.json(result);
      } catch (error) {
        res.status(400).json({ success: false, error: error.message });
      }
    });
    
    // Port availability check
    this.app.get('/check/:port', async (req, res) => {
      try {
        const port = parseInt(req.params.port);
        const available = await this.isPortAvailable(port);
        const portInfo = await this.portScanner.getPortInfo(port);

        const allocation = this.allocations.get(port);
        const isActuallyAvailable = available && !allocation;

        res.json({
          port,
          available: isActuallyAvailable,
          allocated_to: allocation || null,
          system_usage: available ? null : portInfo
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
    
    // Status endpoint
    this.app.get('/status', (req, res) => {
      res.json({
        status: 'running',
        uptime: process.uptime(),
        allocations: this.allocations.size,
        instances: this.instances.size,
        memory: process.memoryUsage()
      });
    });
    
    // List all allocations
    this.app.get('/allocations', (req, res) => {
      const allocations = Array.from(this.allocations.entries()).map(([port, data]) => ({
        port,
        ...data
      }));
      res.json({ allocations });
    });

    // Configuration endpoint
    this.app.get('/config', (req, res) => {
      res.json({
        service_types: this.serviceTypes,
        compliance: {
          source: 'CORE Documentation Standard',
          version: '2.0'
        }
      });
    });

    // Instance management endpoints
    this.app.get('/instance/list', (req, res) => {
      const instances = Array.from(this.instances.entries()).map(([id, data]) => ({
        instance_id: id,
        ...data
      }));
      res.json({ instances });
    });

    this.app.post('/instance/register', (req, res) => {
      const { instance_id, working_directory, metadata = {} } = req.body;

      if (!instance_id) {
        return res.status(400).json({ success: false, error: 'instance_id is required' });
      }

      const instanceData = {
        working_directory,
        registered_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        active_allocations: [],
        metadata
      };

      this.instances.set(instance_id, instanceData);
      this.saveState();

      res.json({
        success: true,
        instance_id,
        message: `Instance ${instance_id} registered`
      });
    });

    this.app.put('/instance/:instanceId/heartbeat', (req, res) => {
      const instanceId = req.params.instanceId;
      const instance = this.instances.get(instanceId);

      if (!instance) {
        return res.status(404).json({ success: false, error: 'Instance not found' });
      }

      instance.last_heartbeat = new Date().toISOString();
      this.instances.set(instanceId, instance);
      this.saveState();

      res.json({
        success: true,
        instance_id: instanceId,
        last_heartbeat: instance.last_heartbeat
      });
    });

    // Cleanup endpoint
    this.app.post('/cleanup', (req, res) => {
      try {
        const result = this.performCleanup(req.body.force || false);
        res.json(result);
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });

    // System port scan endpoint
    this.app.get('/scan', async (req, res) => {
      try {
        const startPort = parseInt(req.query.start) || 3000;
        const endPort = parseInt(req.query.end) || 9999;
        const maxPorts = Math.min(endPort - startPort + 1, 100); // Limit scan size

        const results = [];
        for (let port = startPort; port < startPort + maxPorts; port++) {
          const available = await this.isPortAvailable(port);
          if (!available) {
            const allocation = this.allocations.get(port);
            const systemUsage = allocation ? null : await this.portScanner.getPortInfo(port);

            results.push({
              port,
              allocated_to: allocation || null,
              system_usage: systemUsage
            });
          }
        }

        res.json({
          scan_range: `${startPort}-${Math.min(endPort, startPort + maxPorts - 1)}`,
          ports_in_use: results
        });
      } catch (error) {
        res.status(500).json({ success: false, error: error.message });
      }
    });
  }
  
  /**
   * Allocate a port for a service
   */
  async allocatePort({ service_type, service_name, preferred_port, instance_id, project_path }) {
    // Validate input
    if (!service_type) {
      throw new Error('service_type is required');
    }
    
    const serviceConfig = this.serviceTypes[service_type];
    if (!serviceConfig) {
      throw new Error(`Unknown service type: ${service_type}`);
    }
    
    // Try preferred port first
    if (preferred_port && await this.isPortAvailable(preferred_port)) {
      return this.createAllocation(preferred_port, {
        service_type,
        service_name,
        instance_id,
        project_path
      });
    }
    
    // Try service preferred ports
    for (const port of serviceConfig.preferred_ports) {
      if (await this.isPortAvailable(port)) {
        return this.createAllocation(port, {
          service_type,
          service_name,
          instance_id,
          project_path
        });
      }
    }
    
    // Try service range
    const [start, end] = serviceConfig.range;
    for (let port = start; port <= end; port++) {
      if (await this.isPortAvailable(port)) {
        return this.createAllocation(port, {
          service_type,
          service_name,
          instance_id,
          project_path
        });
      }
    }
    
    throw new Error(`No available ports in range ${start}-${end} for service type ${service_type}`);
  }
  
  /**
   * Create a port allocation
   */
  createAllocation(port, metadata) {
    const lockId = uuidv4();
    const allocation = {
      ...metadata,
      port,
      lock_id: lockId,
      process_id: process.pid,
      allocated_at: new Date().toISOString()
    };
    
    this.allocations.set(port, allocation);
    this.saveState();
    
    return {
      success: true,
      port,
      lock_id: lockId,
      message: `Port ${port} allocated for ${metadata.service_type} service`
    };
  }
  
  /**
   * Release a port allocation
   */
  releasePort(lockId) {
    for (const [port, allocation] of this.allocations) {
      if (allocation.lock_id === lockId) {
        this.allocations.delete(port);
        this.saveState();
        return {
          success: true,
          port,
          message: `Port ${port} released`
        };
      }
    }
    
    throw new Error(`Lock ID ${lockId} not found`);
  }
  
  /**
   * Check if a port is available
   */
  async isPortAvailable(port) {
    // Check our allocations first
    if (this.allocations.has(port)) {
      return false;
    }

    // Check OS-level port usage
    try {
      const available = await this.portScanner.isPortAvailable(port);
      return available;
    } catch (error) {
      console.warn(`Port availability check failed for ${port}:`, error.message);
      // Fallback to assuming available if check fails
      return true;
    }
  }
  
  /**
   * Save current state to disk
   */
  saveState() {
    try {
      const state = {
        saved_at: new Date().toISOString(),
        allocations: Object.fromEntries(this.allocations),
        instances: Object.fromEntries(this.instances)
      };
      
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      
      fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save state:', error.message);
    }
  }
  
  /**
   * Load state from disk
   */
  loadState() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));

        // Convert port strings back to numbers for allocations
        this.allocations = new Map();
        if (state.allocations) {
          for (const [portStr, allocation] of Object.entries(state.allocations)) {
            this.allocations.set(parseInt(portStr), allocation);
          }
        }

        this.instances = new Map(Object.entries(state.instances || {}));
        console.log(`Restored ${this.allocations.size} allocations from previous session`);
      }
    } catch (error) {
      console.error('Failed to load state:', error.message);
    }
  }
  
  /**
   * Start the daemon
   */
  async start() {
    // Load previous state
    this.loadState();
    
    // Start HTTP server
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '127.0.0.1', (error) => {
        if (error) {
          reject(error);
          return;
        }
        
        console.log(`Styxy daemon started on http://127.0.0.1:${this.port}`);
        
        // Write PID file
        this.writePidFile();
        
        // Start cleanup interval
        this.startCleanupTimer();
        
        // Setup graceful shutdown
        this.setupShutdownHandlers();
        
        resolve();
      });
    });
  }
  
  /**
   * Write PID file for daemon management
   */
  writePidFile() {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      fs.writeFileSync(this.pidFile, process.pid.toString());
    } catch (error) {
      console.error('Failed to write PID file:', error.message);
    }
  }
  
  /**
   * Start periodic cleanup timer
   */
  startCleanupTimer() {
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleAllocations();
    }, 30000); // 30 seconds
  }
  
  /**
   * Cleanup stale allocations
   */
  cleanupStaleAllocations() {
    // TODO: Implement process liveness checking
    // For now, just log that cleanup is running
    if (this.allocations.size > 0) {
      console.log(`Cleanup: ${this.allocations.size} allocations active`);
    }
  }

  /**
   * Perform cleanup of stale allocations (for API endpoint)
   */
  performCleanup(force = false) {
    let cleaned = 0;
    const staleAllocations = [];

    // Find allocations from dead processes
    for (const [port, allocation] of this.allocations) {
      let isStale = false;

      if (force) {
        isStale = true;
      } else {
        // Check if process is still alive (basic check for now)
        try {
          // In a real implementation, we'd check if the process is actually using the port
          // For now, we'll just clean up allocations older than 1 hour with no heartbeat
          const allocatedAt = new Date(allocation.allocated_at);
          const now = new Date();
          const hoursSinceAllocation = (now - allocatedAt) / (1000 * 60 * 60);

          if (hoursSinceAllocation > 1) {
            isStale = true;
          }
        } catch (error) {
          // If we can't check, consider it stale
          isStale = true;
        }
      }

      if (isStale) {
        staleAllocations.push({ port, allocation });
      }
    }

    // Remove stale allocations
    for (const { port } of staleAllocations) {
      this.allocations.delete(port);
      cleaned++;
    }

    if (cleaned > 0) {
      this.saveState();
    }

    return {
      success: true,
      cleaned,
      message: force ?
        `Force cleanup completed` :
        `Cleaned up ${cleaned} stale allocations`
    };
  }
  
  /**
   * Setup graceful shutdown handlers
   */
  setupShutdownHandlers() {
    const shutdown = async (signal) => {
      if (this.isShuttingDown) return;
      this.isShuttingDown = true;
      
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      
      // Clear cleanup timer
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
      }
      
      // Save final state
      this.saveState();
      
      // Close HTTP server
      if (this.server) {
        this.server.close(() => {
          console.log('HTTP server closed');
        });
      }
      
      // Remove PID file
      try {
        if (fs.existsSync(this.pidFile)) {
          fs.unlinkSync(this.pidFile);
        }
      } catch (error) {
        console.error('Failed to remove PID file:', error.message);
      }
      
      process.exit(0);
    };
    
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
}

module.exports = StyxyDaemon;

// If called directly, start daemon
if (require.main === module) {
  const daemon = new StyxyDaemon();
  daemon.start().catch(error => {
    console.error('Failed to start daemon:', error.message);
    process.exit(1);
  });
}
