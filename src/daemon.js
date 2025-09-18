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
    const defaultConfig = {
      dev: { preferred_ports: [3000, 8000], range: [8000, 8099] },
      api: { preferred_ports: [8000, 4000], range: [8000, 8099] },
      test: { preferred_ports: [9000], range: [9000, 9099] },
      storybook: { preferred_ports: [6006], range: [6006, 6010] },
      docs: { preferred_ports: [4000], range: [4000, 4099] }
    };
    
    try {
      const configFile = path.join(this.configDir, 'config.json');
      if (fs.existsSync(configFile)) {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        return config.service_types || defaultConfig;
      }
    } catch (error) {
      console.warn('Failed to load config, using defaults:', error.message);
    }
    
    return defaultConfig;
  }
  
  /**
   * Setup Express routes for HTTP API
   */
  setupRoutes() {
    // Port allocation endpoint
    this.app.post('/allocate', (req, res) => {
      try {
        const result = this.allocatePort(req.body);
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
    this.app.get('/check/:port', (req, res) => {
      const port = parseInt(req.params.port);
      const available = this.isPortAvailable(port);
      res.json({ port, available, allocated_to: this.allocations.get(port) });
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
  }
  
  /**
   * Allocate a port for a service
   */
  allocatePort({ service_type, service_name, preferred_port, instance_id, project_path }) {
    // Validate input
    if (!service_type) {
      throw new Error('service_type is required');
    }
    
    const serviceConfig = this.serviceTypes[service_type];
    if (!serviceConfig) {
      throw new Error(`Unknown service type: ${service_type}`);
    }
    
    // Try preferred port first
    if (preferred_port && this.isPortAvailable(preferred_port)) {
      return this.createAllocation(preferred_port, {
        service_type,
        service_name,
        instance_id,
        project_path
      });
    }
    
    // Try service preferred ports
    for (const port of serviceConfig.preferred_ports) {
      if (this.isPortAvailable(port)) {
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
      if (this.isPortAvailable(port)) {
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
  isPortAvailable(port) {
    // Check our allocations first
    if (this.allocations.has(port)) {
      return false;
    }
    
    // TODO: Add OS-level port checking (lsof, netstat)
    return true;
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
        this.allocations = new Map(Object.entries(state.allocations || {}));
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
