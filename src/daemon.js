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
const lockfile = require('proper-lockfile');
const PortScanner = require('./utils/port-scanner');
const Validator = require('./utils/validator');
const AuthMiddleware = require('./middleware/auth');
const RateLimiter = require('./middleware/rate-limiter');
const Logger = require('./utils/logger');
const StateManager = require('./utils/state-manager');
const CircuitBreaker = require('./utils/circuit-breaker');
const Metrics = require('./utils/metrics');

class StyxyDaemon {
  constructor(options = {}) {
    this.port = options.port || 9876;
    this.configDir = options.configDir || path.join(process.env.HOME, '.styxy');
    this.stateFile = path.join(this.configDir, 'daemon.state');
    this.pidFile = path.join(this.configDir, 'daemon.pid');

    // Enhanced components
    this.logger = new Logger({ component: 'daemon', logDir: path.join(this.configDir, 'logs') });
    this.stateManager = new StateManager({
      stateFile: this.stateFile,
      backupDir: path.join(this.configDir, 'backups')
    });
    this.metrics = new Metrics();

    // Circuit breakers for external operations
    this.portScannerBreaker = new CircuitBreaker({
      name: 'port-scanner',
      failureThreshold: 3,
      recoveryTimeout: 15000
    });

    // In-memory state
    this.allocations = new Map();
    this.instances = new Map();
    this.serviceTypes = this.loadServiceTypes();
    this.portScanner = new PortScanner();

    // Express app setup
    this.app = express();
    this.app.use(express.json({ limit: '10kb' })); // Limit JSON payload size

    // Security middleware
    this.auth = new AuthMiddleware(this.configDir);
    this.rateLimiter = new RateLimiter({
      windowMs: 60000, // 1 minute
      maxRequests: 100, // 100 requests per minute
      skipPaths: ['/status', '/health', '/metrics'] // Don't rate limit monitoring endpoints
    });

    this.app.use(this.rateLimiter.limit());
    this.app.use(this.auth.authenticate());

    this.setupRoutes();

    // Process monitoring and shutdown handling
    this.cleanupInterval = null;
    this.isShuttingDown = false;
    this.server = null;
    this.setupGracefulShutdown();
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
        this.logger.info('Loaded CORE port configuration from ~/docs/CORE/PORT_REFERENCE_GUIDE.md');
      }

      // Override with user configuration if exists
      if (fs.existsSync(userConfigFile)) {
        const userConfig = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
        config = { ...config, ...(userConfig.service_types || {}) };
        this.logger.info('Applied user configuration overrides');
      }

      if (Object.keys(config).length > 0) {
        return config;
      }
    } catch (error) {
      this.logger.warn('Failed to load configuration', { error: error.message });
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
      const endTimer = this.metrics.startTimer('allocation_request_duration');

      try {
        // Validate JSON payload size
        const bodyStr = JSON.stringify(req.body);
        Validator.validateJsonSize(bodyStr);

        // Add request context for audit logging
        const requestContext = {
          userAgent: req.get('User-Agent'),
          remoteIP: req.ip || req.connection?.remoteAddress
        };

        const result = await this.allocatePort({ ...req.body, ...requestContext });
        endTimer();
        res.json(result);
      } catch (error) {
        endTimer();
        this.metrics.incrementCounter('allocation_errors_total');
        res.status(400).json({
          success: false,
          error: Validator.sanitizeForLogging(error.message)
        });
      }
    });
    
    // Port release endpoint
    this.app.delete('/allocate/:lockId', async (req, res) => {
      try {
        const lockId = Validator.validateLockId(req.params.lockId);
        const result = await this.releasePort(lockId);
        res.json(result);
      } catch (error) {
        res.status(400).json({
          success: false,
          error: Validator.sanitizeForLogging(error.message)
        });
      }
    });
    
    // Port availability check
    this.app.get('/check/:port', async (req, res) => {
      try {
        const port = Validator.validatePort(req.params.port);
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
        res.status(500).json({
          success: false,
          error: Validator.sanitizeForLogging(error.message)
        });
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

    this.app.post('/instance/register', async (req, res) => {
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
      await this.saveState();

      res.json({
        success: true,
        instance_id,
        message: `Instance ${instance_id} registered`
      });
    });

    this.app.put('/instance/:instanceId/heartbeat', async (req, res) => {
      const instanceId = req.params.instanceId;
      const instance = this.instances.get(instanceId);

      if (!instance) {
        return res.status(404).json({ success: false, error: 'Instance not found' });
      }

      instance.last_heartbeat = new Date().toISOString();
      this.instances.set(instanceId, instance);
      await this.saveState();

      res.json({
        success: true,
        instance_id: instanceId,
        last_heartbeat: instance.last_heartbeat
      });
    });

    // Cleanup endpoint
    this.app.post('/cleanup', async (req, res) => {
      try {
        const result = await this.performCleanup(req.body.force || false);
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

    // Comprehensive health check endpoint
    this.app.get('/health', async (req, res) => {
      try {
        const endTimer = this.metrics.startTimer('health_check_duration');

        const health = {
          status: 'healthy',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          version: require('../../package.json').version,

          // System metrics
          system: {
            memory: process.memoryUsage(),
            cpu: process.cpuUsage(),
            pid: process.pid,
            platform: process.platform,
            node_version: process.version
          },

          // Service health
          services: {
            daemon: {
              status: 'healthy',
              allocations: this.allocations.size,
              instances: this.instances.size,
              last_cleanup: this.lastCleanup || null
            },

            state_manager: {
              status: 'healthy',
              recovery_status: this.stateManager.getRecoveryStatus()
            },

            port_scanner: {
              status: 'healthy',
              circuit_breaker: this.portScannerBreaker.getStats()
            }
          },

          // Configuration status
          config: {
            service_types_loaded: Object.keys(this.serviceTypes).length,
            log_level: this.logger.level,
            auth_enabled: !!this.auth
          }
        };

        // Check for any warning conditions
        const warnings = [];

        if (this.allocations.size > 100) {
          warnings.push('High number of allocations detected');
        }

        if (process.memoryUsage().heapUsed > 100 * 1024 * 1024) { // 100MB
          warnings.push('High memory usage detected');
        }

        if (this.portScannerBreaker.getStats().state !== 'CLOSED') {
          warnings.push('Port scanner circuit breaker is open');
          health.status = 'degraded';
        }

        if (warnings.length > 0) {
          health.warnings = warnings;
          if (health.status === 'healthy') {
            health.status = 'warning';
          }
        }

        const duration = endTimer();
        health.response_time_ms = duration;

        this.metrics.incrementCounter('health_checks_total', 1, { status: health.status });

        const statusCode = health.status === 'healthy' ? 200 :
                          health.status === 'warning' ? 200 : 503;

        res.status(statusCode).json(health);

      } catch (error) {
        this.logger.error('Health check failed', { error: error.message });
        this.metrics.incrementCounter('health_check_errors_total');

        res.status(503).json({
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: 'Health check failed'
        });
      }
    });

    // Metrics endpoint
    this.app.get('/metrics', (req, res) => {
      try {
        const format = req.query.format || 'json';

        if (format === 'prometheus') {
          res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
          res.send(this.metrics.exportPrometheus());
        } else {
          res.json(this.metrics.getMetrics());
        }
      } catch (error) {
        this.logger.error('Metrics endpoint failed', { error: error.message });
        res.status(500).json({ error: 'Failed to retrieve metrics' });
      }
    });

    // Audit log endpoint
    this.app.get('/audit', (req, res) => {
      try {
        // This would typically read from audit log files
        // For now, return basic audit information
        const auditInfo = {
          enabled: true,
          log_location: path.join(this.logger.logDir, 'audit.log'),
          retention_days: 30,
          recent_events: [] // Would load recent events from log
        };

        res.json(auditInfo);
      } catch (error) {
        this.logger.error('Audit endpoint failed', { error: error.message });
        res.status(500).json({ error: 'Failed to retrieve audit information' });
      }
    });

    // Circuit breaker status endpoint
    this.app.get('/circuit-breakers', (req, res) => {
      try {
        const breakers = {
          port_scanner: this.portScannerBreaker.getStats()
        };

        res.json({ circuit_breakers: breakers });
      } catch (error) {
        this.logger.error('Circuit breakers endpoint failed', { error: error.message });
        res.status(500).json({ error: 'Failed to retrieve circuit breaker status' });
      }
    });
  }
  
  /**
   * Allocate a port for a service
   */
  async allocatePort({ service_type, service_name, preferred_port, instance_id, project_path, userAgent, remoteIP }) {
    // Validate all inputs
    const validServiceType = Validator.validateServiceType(service_type, this.serviceTypes);
    const validServiceName = service_name ? Validator.validateServiceName(service_name) : 'unnamed-service';
    const validInstanceId = instance_id ? Validator.validateInstanceId(instance_id) : 'default';
    const validProjectPath = project_path ? Validator.validateWorkingDirectory(project_path) : process.cwd();

    let validPreferredPort;
    if (preferred_port !== undefined) {
      validPreferredPort = Validator.validatePort(preferred_port);
    }

    const serviceConfig = this.serviceTypes[validServiceType];
    
    const requestContext = { userAgent, remoteIP };

    // Try preferred port first
    if (validPreferredPort && await this.isPortAvailable(validPreferredPort)) {
      return this.createAllocation(validPreferredPort, {
        service_type: validServiceType,
        service_name: validServiceName,
        instance_id: validInstanceId,
        project_path: validProjectPath
      }, requestContext);
    }

    // Try service preferred ports
    for (const port of serviceConfig.preferred_ports) {
      if (await this.isPortAvailable(port)) {
        return this.createAllocation(port, {
          service_type,
          service_name,
          instance_id,
          project_path
        }, requestContext);
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
        }, requestContext);
      }
    }
    
    throw new Error(`No available ports in range ${start}-${end} for service type ${service_type}`);
  }
  
  /**
   * Create a port allocation
   */
  async createAllocation(port, metadata, requestContext = {}) {
    const lockId = uuidv4();
    const allocation = {
      ...metadata,
      port,
      lock_id: lockId,
      process_id: process.pid,
      allocated_at: new Date().toISOString(),
      userAgent: requestContext.userAgent || 'unknown',
      remoteIP: requestContext.remoteIP || 'unknown'
    };

    this.allocations.set(port, allocation);
    await this.saveState();

    // Audit logging
    this.logger.audit('PORT_ALLOCATED', {
      port,
      lockId,
      serviceType: metadata.service_type,
      serviceName: metadata.service_name,
      instanceId: metadata.instance_id,
      projectPath: metadata.project_path,
      userAgent: allocation.userAgent || 'unknown',
      remoteIP: allocation.remoteIP || 'unknown'
    });

    this.metrics.incrementCounter('ports_allocated_total', 1, {
      service_type: metadata.service_type
    });

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
  async releasePort(lockId) {
    for (const [port, allocation] of this.allocations) {
      if (allocation.lock_id === lockId) {
        this.allocations.delete(port);
        await this.saveState();

        // Audit logging
        this.logger.audit('PORT_RELEASED', {
          port,
          lockId,
          serviceType: allocation.service_type,
          serviceName: allocation.service_name,
          releasedAfterMs: Date.now() - new Date(allocation.allocated_at).getTime()
        });

        this.metrics.incrementCounter('ports_released_total', 1, {
          service_type: allocation.service_type
        });

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

    // Check OS-level port usage with circuit breaker and timeout
    try {
      const endTimer = this.metrics.startTimer('port_availability_check_duration');

      const available = await this.portScannerBreaker.execute(async () => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Port check timeout')), 5000); // 5 second timeout
        });

        const checkPromise = this.portScanner.isPortAvailable(port);

        return Promise.race([checkPromise, timeoutPromise]);
      });

      endTimer();
      this.metrics.incrementCounter('port_checks_total', 1, { result: available ? 'available' : 'unavailable' });

      return available;

    } catch (error) {
      this.logger.warn('Port availability check failed', {
        port,
        error: error.message,
        circuitBreakerOpen: error.circuitBreakerOpen || false
      });

      this.metrics.incrementCounter('port_check_errors_total');

      // Fallback to assuming available if check fails
      return true;
    }
  }
  
  /**
   * Save current state with enhanced integrity protection
   */
  async saveState() {
    try {
      const state = {
        saved_at: new Date().toISOString(),
        allocations: Array.from(this.allocations.entries()).map(([port, allocation]) => ({
          ...allocation,
          port
        })),
        instances: Array.from(this.instances.entries()).map(([id, instance]) => ({
          ...instance,
          id
        }))
      };

      // Ensure directory exists with secure permissions
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }

      await this.stateManager.saveState(state);
      this.metrics.incrementCounter('state_saves_total');

    } catch (error) {
      this.logger.error('Failed to save state', { error: error.message });
      this.metrics.incrementCounter('state_save_errors_total');
      throw error;
    }
  }
  
  /**
   * Load state from disk
   */
  async loadState() {
    try {
      const state = await this.stateManager.loadState();

      this.allocations = new Map();
      this.instances = new Map();

      // Load allocations
      if (state.allocations) {
        for (const allocation of state.allocations) {
          try {
            const port = Validator.validatePort(allocation.port);
            const validAllocation = {
              ...allocation,
              port,
              lockId: Validator.validateLockId(allocation.lockId),
              serviceType: Validator.validateServiceType(allocation.serviceType, this.serviceTypes)
            };
            this.allocations.set(port, validAllocation);
          } catch (error) {
            this.logger.warn('Skipping invalid allocation during load', {
              allocation: Validator.sanitizeObject(allocation),
              error: error.message
            });
          }
        }
      }

      // Load instances
      if (state.instances) {
        for (const instance of state.instances) {
          try {
            const instanceId = Validator.validateInstanceId(instance.id);
            const validInstance = {
              ...instance,
              id: instanceId,
              lastHeartbeat: new Date(instance.lastHeartbeat)
            };
            this.instances.set(instanceId, validInstance);
          } catch (error) {
            this.logger.warn('Skipping invalid instance during load', {
              instance: Validator.sanitizeObject(instance),
              error: error.message
            });
          }
        }
      }

      this.logger.info('State loaded successfully', {
        allocations: this.allocations.size,
        instances: this.instances.size
      });

      this.metrics.incrementCounter('state_loads_total');

    } catch (error) {
      this.logger.error('Failed to load state', { error: error.message });
      this.metrics.incrementCounter('state_load_errors_total');

      // Initialize empty state on error
      this.allocations = new Map();
      this.instances = new Map();
    }
  }
  
  /**
   * Start the daemon
   */
  async start() {
    try {
      // Audit logging
      this.logger.audit('DAEMON_STARTING', {
        port: this.port,
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform
      });

      // Load previous state with recovery
      await this.loadState();

      // Start HTTP server with timeout
      const serverStartTimeout = 30000; // 30 seconds
      const serverPromise = new Promise((resolve, reject) => {
        this.server = this.app.listen(this.port, '127.0.0.1', (error) => {
          if (error) {
            this.logger.error('Failed to start HTTP server', { error: error.message });
            reject(error);
            return;
          }

          this.logger.info(`Styxy daemon started successfully`, {
            port: this.port,
            pid: process.pid,
            uptime: process.uptime()
          });

          resolve();
        });
      });

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Server startup timeout after ${serverStartTimeout}ms`));
        }, serverStartTimeout);
      });

      await Promise.race([serverPromise, timeoutPromise]);

      // Write PID file
      this.writePidFile();

      // Start cleanup interval
      this.startCleanupTimer();

      // Audit successful start
      this.logger.audit('DAEMON_STARTED', {
        port: this.port,
        allocationsRestored: this.allocations.size,
        instancesRestored: this.instances.size
      });

      this.metrics.incrementCounter('daemon_starts_total');

    } catch (error) {
      this.logger.error('Daemon startup failed', { error: error.message });
      this.logger.audit('DAEMON_START_FAILED', {
        error: error.message,
        port: this.port
      });

      this.metrics.incrementCounter('daemon_start_errors_total');
      throw error;
    }
  }
  
  /**
   * Write PID file for daemon management
   */
  writePidFile() {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true, mode: 0o700 });
      }
      fs.writeFileSync(this.pidFile, process.pid.toString(), { mode: 0o600 });
    } catch (error) {
      console.error('Failed to write PID file:', error.message);
    }
  }
  
  /**
   * Start periodic cleanup timer
   */
  startCleanupTimer() {
    this.cleanupInterval = setInterval(async () => {
      await this.cleanupStaleAllocations();
    }, 30000); // 30 seconds
  }
  
  /**
   * Cleanup stale allocations
   */
  async cleanupStaleAllocations() {
    // TODO: Implement process liveness checking
    // For now, just log that cleanup is running
    if (this.allocations.size > 0) {
      console.log(`Cleanup: ${this.allocations.size} allocations active`);
    }
  }

  /**
   * Perform cleanup of stale allocations (for API endpoint)
   */
  async performCleanup(force = false) {
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
      await this.saveState();
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
  /**
   * Stop the daemon gracefully
   */
  async stop() {
    if (this.isShuttingDown) {
      return; // Already shutting down
    }

    this.isShuttingDown = true;
    console.log('Shutting down Styxy daemon...');

    try {
      // Save current state before shutdown
      await this.saveState();

      // Stop cleanup interval
      if (this.cleanupInterval) {
        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
      }

      // Clean up rate limiter resources
      if (this.rateLimiter) {
        this.rateLimiter.destroy();
      }

      // Close HTTP server
      if (this.server) {
        await new Promise((resolve, reject) => {
          this.server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        });
      }

      // Remove PID file
      try {
        if (fs.existsSync(this.pidFile)) {
          fs.unlinkSync(this.pidFile);
        }
      } catch (error) {
        console.warn('Failed to remove PID file:', error.message);
      }

      console.log('✅ Styxy daemon stopped gracefully');
    } catch (error) {
      console.error('Error during shutdown:', error.message);
      throw error;
    }
  }

  /**
   * Setup graceful shutdown handlers
   */
  setupGracefulShutdown() {
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        this.logger.warn('Shutdown already in progress, forcing exit');
        process.exit(1);
      }

      this.isShuttingDown = true;
      this.logger.info(`Received ${signal}, initiating graceful shutdown`);

      // Set shutdown timeout
      const shutdownTimeout = setTimeout(() => {
        this.logger.error('Shutdown timeout exceeded, forcing exit');
        process.exit(1);
      }, 30000); // 30 seconds

      try {
        // 1. Stop accepting new connections
        if (this.server) {
          this.server.close(() => {
            this.logger.info('HTTP server closed');
          });
        }

        // 2. Clear intervals and cleanup resources
        if (this.cleanupInterval) {
          clearInterval(this.cleanupInterval);
          this.logger.debug('Cleanup interval cleared');
        }

        // 3. Save current state
        await this.saveState();
        this.logger.info('State saved before shutdown');

        // 4. Cleanup circuit breakers
        if (this.portScannerBreaker) {
          this.portScannerBreaker.destroy();
        }

        // 5. Cleanup metrics
        if (this.metrics) {
          this.metrics.destroy();
        }

        // 6. Cleanup auth middleware
        if (this.auth && this.auth.destroy) {
          this.auth.destroy();
        }

        // 7. Remove PID file
        try {
          if (fs.existsSync(this.pidFile)) {
            fs.unlinkSync(this.pidFile);
            this.logger.debug('PID file removed');
          }
        } catch (error) {
          this.logger.warn('Failed to remove PID file', { error: error.message });
        }

        clearTimeout(shutdownTimeout);
        this.logger.info('Graceful shutdown completed');
        process.exit(0);

      } catch (error) {
        clearTimeout(shutdownTimeout);
        this.logger.error('Shutdown failed', { error: error.message });
        process.exit(1);
      }
    };

    // Setup signal handlers - avoid duplicates in test environment
    if (!process.env.NODE_ENV || process.env.NODE_ENV !== 'test') {
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));

      // Handle uncaught exceptions and unhandled rejections
      process.on('uncaughtException', (error) => {
        this.logger.error('Uncaught exception', {
          error: error.message,
          stack: error.stack
        });
        gracefulShutdown('UNCAUGHT_EXCEPTION');
      });

      process.on('unhandledRejection', (reason, promise) => {
        this.logger.error('Unhandled rejection', {
          reason: String(reason),
          promise: String(promise)
        });
        gracefulShutdown('UNHANDLED_REJECTION');
      });
    }
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
