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
const { ErrorFactory } = require('./utils/enhanced-errors');

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
    this.singletonServices = new Map(); // Track single-instance services (Feature #1)
    this.serviceTypes = this.loadServiceTypes();
    this.autoAllocationConfig = this.loadAutoAllocationConfig(); // Feature #2
    this.autoAllocationRules = this.loadAutoAllocationRules(); // Feature #2
    this.portScanner = new PortScanner();

    // CONCURRENT ALLOCATION SAFETY
    // Track ports being allocated (prevents race conditions)
    this.allocationInProgress = new Set();
    this.allocationMutex = new Map(); // Port -> Promise (for waiting)

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
        // Transform user config to daemon format (same as CORE config)
        const transformedUserConfig = this.transformCoreConfig(userConfig.service_types || {});
        config = { ...config, ...transformedUserConfig };
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
        examples: config.examples,
        instance_behavior: Validator.validateInstanceBehavior(config.instance_behavior) // Feature #1: defaults to 'multi'
      };
    }

    return transformed;
  }

  /**
   * Load auto-allocation configuration (Feature #2)
   */
  loadAutoAllocationConfig() {
    const coreConfigFile = path.join(__dirname, '../config/core-ports.json');
    const userConfigFile = path.join(this.configDir, 'config.json');

    try {
      // Default configuration
      let config = {
        enabled: false,
        default_chunk_size: 10,
        placement: 'after',
        min_port: 10000,
        max_port: 65000,
        preserve_gaps: true,
        gap_size: 10
      };

      // Load from CORE config
      if (fs.existsSync(coreConfigFile)) {
        const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));
        if (coreConfig.auto_allocation) {
          config = { ...config, ...coreConfig.auto_allocation };
        }
      }

      // Override with user config
      if (fs.existsSync(userConfigFile)) {
        const userConfig = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
        if (userConfig.auto_allocation) {
          config = { ...config, ...userConfig.auto_allocation };
        }
      }

      // Validate configuration
      Validator.validateAutoAllocationConfig(config);

      this.logger.info('Loaded auto-allocation configuration', {
        enabled: config.enabled,
        placement: config.placement,
        chunk_size: config.default_chunk_size
      });

      return config;
    } catch (error) {
      this.logger.warn('Failed to load auto-allocation config, using defaults', {
        error: error.message
      });

      return {
        enabled: false,
        default_chunk_size: 10,
        placement: 'after',
        min_port: 10000,
        max_port: 65000,
        preserve_gaps: true,
        gap_size: 10
      };
    }
  }

  /**
   * Load auto-allocation rules (Feature #2)
   */
  loadAutoAllocationRules() {
    const coreConfigFile = path.join(__dirname, '../config/core-ports.json');
    const userConfigFile = path.join(this.configDir, 'config.json');

    try {
      let rules = {};

      // Load from CORE config
      if (fs.existsSync(coreConfigFile)) {
        const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));
        if (coreConfig.auto_allocation_rules) {
          rules = { ...rules, ...coreConfig.auto_allocation_rules };
        }
      }

      // Override with user config
      if (fs.existsSync(userConfigFile)) {
        const userConfig = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
        if (userConfig.auto_allocation_rules) {
          rules = { ...rules, ...userConfig.auto_allocation_rules };
        }
      }

      // Validate rules
      if (Object.keys(rules).length > 0) {
        Validator.validateAutoAllocationRules(rules);
        this.logger.info('Loaded auto-allocation rules', {
          ruleCount: Object.keys(rules).length,
          patterns: Object.keys(rules)
        });
      }

      return rules;
    } catch (error) {
      this.logger.warn('Failed to load auto-allocation rules, using empty rules', {
        error: error.message
      });

      return {};
    }
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

        // Enhanced error response
        if (error.toJSON) {
          res.status(400).json(error.toJSON());
        } else {
          res.status(400).json({
            success: false,
            error: Validator.sanitizeForLogging(error.message)
          });
        }
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
   * Allocate a port for a service (CONCURRENT-SAFE VERSION)
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

    // Feature #1: Check for singleton service behavior
    if (serviceConfig.instance_behavior === 'single') {
      const existingSingleton = this.getSingleton(validServiceType);
      if (existingSingleton) {
        // Singleton already exists, return existing allocation
        this.logger.info('Singleton service reused', {
          serviceType: validServiceType,
          existingPort: existingSingleton.port,
          existingInstanceId: existingSingleton.instanceId,
          requestedInstanceId: validInstanceId
        });

        return {
          port: existingSingleton.port,
          lockId: existingSingleton.lockId,
          message: `Service '${validServiceType}' only allows single instance`,
          existing: true,
          existingInstanceId: existingSingleton.instanceId,
          existingPid: existingSingleton.pid,
          allocatedAt: existingSingleton.allocatedAt
        };
      }
      // If no singleton exists, proceed with normal allocation and register as singleton
    }

    // Build candidate ports list (preferred + service preferred + range)
    const candidatePorts = [];

    // Add preferred port first
    if (validPreferredPort) {
      candidatePorts.push(validPreferredPort);
    }

    // Add service preferred ports
    for (const port of serviceConfig.preferred_ports) {
      if (!candidatePorts.includes(port)) {
        candidatePorts.push(port);
      }
    }

    // Add service range ports
    const [start, end] = serviceConfig.range;
    for (let port = start; port <= end; port++) {
      if (!candidatePorts.includes(port)) {
        candidatePorts.push(port);
      }
    }

    // Try to allocate from candidate ports using atomic reservation
    const allocatedPorts = [];
    for (const port of candidatePorts) {
      const result = await this.tryAtomicAllocation(port, {
        service_type: validServiceType,
        service_name: validServiceName,
        instance_id: validInstanceId,
        project_path: validProjectPath
      }, requestContext);

      if (result.success) {
        return result;
      } else if (result.reason === 'allocated') {
        allocatedPorts.push(port);
      }
      // If reason === 'in_progress', continue to next port immediately
    }

    // Use enhanced error with actionable suggestions
    throw ErrorFactory.portRangeExhausted(validServiceType, start, end, allocatedPorts);
  }

  /**
   * Atomically try to allocate a specific port (prevents race conditions)
   */
  async tryAtomicAllocation(port, metadata, requestContext) {
    // Quick check: already allocated
    if (this.allocations.has(port)) {
      return { success: false, reason: 'allocated' };
    }

    // Quick check: allocation in progress
    if (this.allocationInProgress.has(port)) {
      return { success: false, reason: 'in_progress' };
    }

    // Atomic reservation: try to claim the port
    if (!this.allocationInProgress.has(port)) {
      this.allocationInProgress.add(port);

      try {
        // Double-check after claiming (another request might have allocated between checks)
        if (this.allocations.has(port)) {
          return { success: false, reason: 'allocated' };
        }

        // Check port availability (fast for managed ranges)
        const available = await this.isPortAvailable(port);
        if (!available) {
          return { success: false, reason: 'unavailable' };
        }

        // SUCCESS: Create the allocation
        const result = await this.createAllocation(port, metadata, requestContext);
        return { success: true, ...result };

      } finally {
        // Always release the reservation
        this.allocationInProgress.delete(port);
      }
    } else {
      // Port reservation failed (another request got it)
      return { success: false, reason: 'in_progress' };
    }
  }
  
  /**
   * Create a port allocation
   */
  async createAllocation(port, metadata, requestContext = {}) {
    const lockId = uuidv4();
    const allocation = {
      ...metadata,
      port,
      lockId: lockId,
      serviceType: metadata.service_type,
      serviceName: metadata.service_name,
      instanceId: metadata.instance_id,
      projectPath: metadata.project_path,
      process_id: process.pid,
      allocated_at: new Date().toISOString(),
      userAgent: requestContext.userAgent || 'unknown',
      remoteIP: requestContext.remoteIP || 'unknown'
    };

    this.allocations.set(port, allocation);

    // Save state asynchronously (don't block the atomic operation)
    this.saveState().catch(error => {
      this.logger.error('Background state save failed', { error: error.message });
    });

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

    // Feature #1: Register as singleton if service type requires it
    const serviceConfig = this.serviceTypes[metadata.service_type];
    if (serviceConfig && serviceConfig.instance_behavior === 'single') {
      this.registerSingleton(metadata.service_type, {
        port,
        lockId,
        instanceId: metadata.instance_id,
        pid: allocation.process_id
      });
    }

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
      if (allocation.lockId === lockId) {
        this.allocations.delete(port);

        // Feature #1: Release singleton if this was a singleton service
        const serviceConfig = this.serviceTypes[allocation.serviceType];
        if (serviceConfig && serviceConfig.instance_behavior === 'single') {
          this.releaseSingleton(allocation.serviceType);
        }

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

    // PERFORMANCE OPTIMIZATION: Skip OS checks for ports in our managed ranges
    // This eliminates 3+ second delays for ports we're coordinating
    if (this.isPortInManagedRange(port)) {
      return true; // Trust our allocation tracking for managed ports
    }

    // Only do expensive OS-level checks for ports outside our managed ranges
    try {
      const endTimer = this.metrics.startTimer('port_availability_check_duration');

      const available = await this.portScannerBreaker.execute(async () => {
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Port check timeout')), 2000); // Reduced from 5s to 2s
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
   * Check if a port is within our managed service ranges
   */
  isPortInManagedRange(port) {
    for (const serviceType of Object.values(this.serviceTypes)) {
      if (serviceType.range) {
        const [start, end] = serviceType.range;
        if (port >= start && port <= end) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Register a service as a singleton (Feature #1: Single-Instance Services)
   */
  registerSingleton(serviceType, allocationInfo) {
    if (!serviceType || typeof serviceType !== 'string') {
      throw new Error('Service type required for singleton registration');
    }

    this.singletonServices.set(serviceType, {
      serviceType,
      port: allocationInfo.port,
      lockId: allocationInfo.lockId,
      instanceId: allocationInfo.instanceId,
      pid: allocationInfo.pid,
      allocatedAt: Date.now()
    });

    this.logger.info('Registered singleton service', {
      serviceType,
      port: allocationInfo.port,
      instanceId: allocationInfo.instanceId
    });
  }

  /**
   * Get singleton service info if exists (Feature #1: Single-Instance Services)
   */
  getSingleton(serviceType) {
    return this.singletonServices.get(serviceType);
  }

  /**
   * Release singleton service, allowing new allocation (Feature #1: Single-Instance Services)
   */
  releaseSingleton(serviceType) {
    const singleton = this.singletonServices.get(serviceType);
    if (singleton) {
      this.singletonServices.delete(serviceType);
      this.logger.info('Released singleton service', {
        serviceType,
        port: singleton.port
      });
      return true;
    }
    return false;
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
        })),
        singletonServices: Array.from(this.singletonServices.entries()).map(([serviceType, singleton]) => ({
          ...singleton,
          serviceType
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
      this.singletonServices = new Map();

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

      // Load singleton services (Feature #1)
      if (state.singletonServices) {
        for (const singleton of state.singletonServices) {
          try {
            const serviceType = Validator.validateServiceType(singleton.serviceType, this.serviceTypes);
            const validSingleton = {
              ...singleton,
              serviceType,
              port: Validator.validatePort(singleton.port),
              lockId: Validator.validateLockId(singleton.lockId),
              instanceId: Validator.validateInstanceId(singleton.instanceId)
            };
            this.singletonServices.set(serviceType, validSingleton);
          } catch (error) {
            this.logger.warn('Skipping invalid singleton service during load', {
              singleton: Validator.sanitizeObject(singleton),
              error: error.message
            });
          }
        }
      }

      this.logger.info('State loaded successfully', {
        allocations: this.allocations.size,
        instances: this.instances.size,
        singletonServices: this.singletonServices.size
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
   * Perform cleanup at startup to clear stale allocations from previous runs
   */
  async performStartupCleanup() {
    try {
      this.logger.info('Performing startup cleanup');
      const result = await this.performCleanup(false);

      if (result.cleaned > 0) {
        this.logger.info('Startup cleanup completed', {
          cleaned: result.cleaned,
          message: result.message
        });
      }
    } catch (error) {
      this.logger.warn('Startup cleanup failed', { error: error.message });
      // Don't fail startup if cleanup fails
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

      // NEW: Perform startup cleanup to clear stale allocations
      await this.performStartupCleanup();

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
    }, 10000); // Reduced from 30000ms to 10000ms (10 seconds)
  }
  
  /**
   * Check if an allocation is stale
   */
  async isAllocationStale(allocation, now = new Date()) {
    // 1. Check allocation age (reduce from 1 hour to 30 minutes)
    const allocatedAt = new Date(allocation.allocated_at);
    const minutesSinceAllocation = (now - allocatedAt) / (1000 * 60);

    if (minutesSinceAllocation > 30) {
      return true;
    }

    // 2. Check if process is still alive
    if (allocation.process_id) {
      try {
        // Use kill(pid, 0) to check if process exists without killing it
        process.kill(allocation.process_id, 0);
      } catch (error) {
        if (error.code === 'ESRCH') {
          // Process doesn't exist
          return true;
        }
        // Other errors (EPERM, etc.) mean process exists but we can't signal it
      }
    }

    // 3. Check if port is actually in use by the process
    try {
      const portInfo = await this.portScanner.getPortInfo(allocation.port);
      if (portInfo && portInfo.pid && portInfo.pid !== allocation.process_id) {
        // Port is being used by a different process
        return true;
      }
    } catch (error) {
      // If we can't check port usage, don't consider it stale based on this alone
    }

    return false;
  }

  /**
   * Cleanup stale allocations - IMPROVED VERSION
   */
  async cleanupStaleAllocations() {
    try {
      let cleaned = 0;
      const staleAllocations = [];
      const now = new Date();

      for (const [port, allocation] of this.allocations) {
        const isStale = await this.isAllocationStale(allocation, now);
        if (isStale) {
          staleAllocations.push(port);
        }
      }

      // Remove stale allocations
      for (const port of staleAllocations) {
        const allocation = this.allocations.get(port);
        this.allocations.delete(port);
        cleaned++;

        // Feature #1: Release singleton if this was a singleton service
        const serviceConfig = this.serviceTypes[allocation.serviceType];
        if (serviceConfig && serviceConfig.instance_behavior === 'single') {
          this.releaseSingleton(allocation.serviceType);
        }

        this.logger.info('Cleaned stale allocation', {
          port,
          serviceType: allocation.serviceType,
          allocatedAt: allocation.allocated_at,
          reason: 'process_dead_or_expired'
        });
      }

      if (cleaned > 0) {
        await this.saveState();
        this.lastCleanup = new Date().toISOString();
        this.metrics.incrementCounter('stale_allocations_cleaned_total', cleaned);
      }

      // Log cleanup summary periodically
      if (this.allocations.size > 0 && this.allocations.size % 10 === 0) {
        this.logger.debug('Cleanup summary', {
          totalAllocations: this.allocations.size,
          cleanedThisRun: cleaned
        });
      }

    } catch (error) {
      this.logger.error('Cleanup failed', { error: error.message });
      this.metrics.incrementCounter('cleanup_errors_total');
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

      // Clean up metrics timer
      if (this.metrics) {
        this.metrics.destroy();
      }

      // Clean up circuit breaker timers
      if (this.portScannerBreaker) {
        this.portScannerBreaker.destroy();
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
