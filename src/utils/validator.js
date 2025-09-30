/**
 * Enhanced Input Validation and Sanitization Utilities
 *
 * Provides comprehensive validation functions to prevent injection attacks,
 * ensure data integrity, and protect against various security vulnerabilities.
 */

const path = require('path');
const fs = require('fs');
const { ErrorFactory } = require('./enhanced-errors');

class Validator {
  /**
   * Validate port number
   */
  static validatePort(port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw ErrorFactory.invalidPort(port);
    }
    return portNum;
  }

  /**
   * Validate service type
   */
  static validateServiceType(serviceType, allowedTypes) {
    if (!serviceType || typeof serviceType !== 'string') {
      throw new Error('service_type is required and must be a string');
    }

    // Allow alphanumeric and hyphens only
    if (!/^[a-zA-Z0-9-]+$/.test(serviceType)) {
      throw new Error('service_type can only contain letters, numbers, and hyphens');
    }

    if (serviceType.length > 50) {
      throw new Error('service_type must be 50 characters or less');
    }

    if (allowedTypes && !allowedTypes.hasOwnProperty(serviceType)) {
      throw ErrorFactory.invalidServiceType(serviceType, Object.keys(allowedTypes));
    }

    return serviceType;
  }

  /**
   * Validate service name
   */
  static validateServiceName(serviceName) {
    if (!serviceName || typeof serviceName !== 'string') {
      throw new Error('service_name must be a non-empty string');
    }

    // Allow alphanumeric, hyphens, underscores, and dots
    if (!/^[a-zA-Z0-9-_.]+$/.test(serviceName)) {
      throw new Error('service_name can only contain letters, numbers, hyphens, underscores, and dots');
    }

    if (serviceName.length > 100) {
      throw new Error('service_name must be 100 characters or less');
    }

    return serviceName;
  }

  /**
   * Validate UUID/lock ID
   */
  static validateLockId(lockId) {
    if (!lockId || typeof lockId !== 'string') {
      throw new Error('lock_id is required and must be a string');
    }

    // UUID v4 format validation
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(lockId)) {
      throw new Error('lock_id must be a valid UUID v4');
    }

    return lockId;
  }

  /**
   * Validate instance ID
   */
  static validateInstanceId(instanceId) {
    if (!instanceId || typeof instanceId !== 'string') {
      throw new Error('instance_id is required and must be a string');
    }

    // Allow alphanumeric, hyphens, and underscores
    if (!/^[a-zA-Z0-9-_]+$/.test(instanceId)) {
      throw new Error('instance_id can only contain letters, numbers, hyphens, and underscores');
    }

    if (instanceId.length > 100) {
      throw new Error('instance_id must be 100 characters or less');
    }

    return instanceId;
  }

  /**
   * Validate working directory path
   */
  static validateWorkingDirectory(workingDir) {
    if (!workingDir || typeof workingDir !== 'string') {
      throw new Error('working_directory must be a non-empty string');
    }

    // Basic path validation - no null bytes, reasonable length
    if (workingDir.includes('\0')) {
      throw new Error('working_directory cannot contain null bytes');
    }

    if (workingDir.length > 1000) {
      throw new Error('working_directory must be 1000 characters or less');
    }

    return workingDir;
  }

  /**
   * Validate JSON object size to prevent DoS
   */
  static validateJsonSize(jsonString, maxSize = 10240) { // 10KB default
    if (typeof jsonString !== 'string') {
      throw new Error('Input must be a string');
    }

    if (jsonString.length > maxSize) {
      throw new Error(`JSON payload too large: ${jsonString.length} bytes (max: ${maxSize})`);
    }

    return jsonString;
  }

  /**
   * Sanitize string for logging (remove potentially dangerous characters)
   */
  static sanitizeForLogging(str) {
    if (typeof str !== 'string') {
      return String(str);
    }

    // Remove control characters and limit length
    return str
      .replace(/[\x00-\x1f\x7f-\x9f]/g, '') // Remove control chars
      .substring(0, 200) // Limit length
      .trim();
  }

  /**
   * Validate scan range parameters
   */
  static validateScanRange(start, end) {
    const startPort = this.validatePort(start);
    const endPort = this.validatePort(end);

    if (startPort > endPort) {
      throw new Error('Start port must be less than or equal to end port');
    }

    if (endPort - startPort > 10000) {
      throw new Error('Scan range too large (max 10000 ports)');
    }

    return { start: startPort, end: endPort };
  }

  /**
   * Validate and sanitize file paths to prevent directory traversal
   */
  static validateFilePath(filePath, allowedDirectories = []) {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('File path must be a non-empty string');
    }

    // Check for null bytes
    if (filePath.includes('\0')) {
      throw new Error('File path cannot contain null bytes');
    }

    // Normalize the path to resolve any . or .. components
    const normalizedPath = path.normalize(filePath);

    // Check for directory traversal attempts
    if (normalizedPath.includes('..')) {
      throw new Error('Directory traversal not allowed');
    }

    // Check against allowed directories if specified
    if (allowedDirectories.length > 0) {
      const isAllowed = allowedDirectories.some(allowedDir => {
        const normalizedAllowed = path.normalize(allowedDir);
        return normalizedPath.startsWith(normalizedAllowed);
      });

      if (!isAllowed) {
        throw new Error(`Path not allowed. Must be within: ${allowedDirectories.join(', ')}`);
      }
    }

    return normalizedPath;
  }

  /**
   * Validate API key format
   */
  static validateApiKey(apiKey) {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error('API key must be a non-empty string');
    }

    // Check for reasonable length (64 chars for SHA-256 hex)
    if (apiKey.length < 32 || apiKey.length > 128) {
      throw new Error('API key must be between 32 and 128 characters');
    }

    // Check for valid characters (hex or base64)
    if (!/^[a-fA-F0-9]+$/.test(apiKey) && !/^[A-Za-z0-9+/=]+$/.test(apiKey)) {
      throw new Error('API key contains invalid characters');
    }

    return apiKey;
  }

  /**
   * Validate HTTP headers to prevent header injection
   */
  static validateHttpHeader(name, value) {
    if (!name || typeof name !== 'string') {
      throw new Error('Header name must be a non-empty string');
    }

    if (!value || typeof value !== 'string') {
      throw new Error('Header value must be a non-empty string');
    }

    // Check for CRLF injection
    if (name.includes('\r') || name.includes('\n') || value.includes('\r') || value.includes('\n')) {
      throw new Error('Headers cannot contain CRLF characters');
    }

    // Validate header name format
    if (!/^[a-zA-Z0-9-_]+$/.test(name)) {
      throw new Error('Header name contains invalid characters');
    }

    return { name, value };
  }

  /**
   * Validate command-line arguments to prevent injection
   */
  static validateCommandArg(arg) {
    if (typeof arg !== 'string') {
      throw new Error('Command argument must be a string');
    }

    // Check for dangerous characters that could be used for injection
    const dangerousChars = /[;&|`$(){}[\]<>'"\\]/;
    if (dangerousChars.test(arg)) {
      throw new Error('Command argument contains potentially dangerous characters');
    }

    return arg;
  }

  /**
   * Validate timeout values
   */
  static validateTimeout(timeout, minMs = 100, maxMs = 300000) {
    const timeoutNum = parseInt(timeout, 10);
    if (isNaN(timeoutNum)) {
      throw new Error(`Timeout must be a number, got: ${timeout}`);
    }

    if (timeoutNum < minMs || timeoutNum > maxMs) {
      throw new Error(`Timeout must be between ${minMs}ms and ${maxMs}ms, got: ${timeoutNum}ms`);
    }

    return timeoutNum;
  }

  /**
   * Validate environment variable names
   */
  static validateEnvVarName(name) {
    if (!name || typeof name !== 'string') {
      throw new Error('Environment variable name must be a non-empty string');
    }

    // Standard env var naming convention
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error('Environment variable name must contain only uppercase letters, numbers, and underscores');
    }

    if (name.length > 100) {
      throw new Error('Environment variable name too long');
    }

    return name;
  }

  /**
   * Validate PID (Process ID)
   */
  static validatePid(pid) {
    const pidNum = parseInt(pid, 10);
    if (isNaN(pidNum)) {
      throw new Error(`PID must be a number, got: ${pid}`);
    }

    if (pidNum <= 0 || pidNum > 4194304) { // Linux max PID
      throw new Error(`PID must be between 1 and 4194304, got: ${pidNum}`);
    }

    return pidNum;
  }

  /**
   * Sanitize object for safe serialization
   */
  static sanitizeObject(obj, maxDepth = 5, currentDepth = 0) {
    if (currentDepth >= maxDepth) {
      return '[Max depth reached]';
    }

    if (obj === null || obj === undefined) {
      return obj;
    }

    if (typeof obj === 'string') {
      return this.sanitizeForLogging(obj);
    }

    if (typeof obj === 'number' || typeof obj === 'boolean') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.slice(0, 100).map(item =>
        this.sanitizeObject(item, maxDepth, currentDepth + 1)
      );
    }

    if (typeof obj === 'object') {
      const sanitized = {};
      const keys = Object.keys(obj).slice(0, 50); // Limit keys

      for (const key of keys) {
        const sanitizedKey = this.sanitizeForLogging(key);
        sanitized[sanitizedKey] = this.sanitizeObject(obj[key], maxDepth, currentDepth + 1);
      }

      return sanitized;
    }

    return String(obj);
  }

  /**
   * Validate request rate limiting parameters
   */
  static validateRateLimit(windowMs, maxRequests) {
    const window = this.validateTimeout(windowMs, 1000, 3600000); // 1s to 1h
    const max = parseInt(maxRequests, 10);

    if (isNaN(max) || max < 1 || max > 10000) {
      throw new Error('Max requests must be between 1 and 10000');
    }

    return { windowMs: window, maxRequests: max };
  }

  /**
   * Validate instance behavior setting
   */
  static validateInstanceBehavior(instanceBehavior) {
    // If not provided, default to "multi"
    if (!instanceBehavior) {
      return 'multi';
    }

    if (typeof instanceBehavior !== 'string') {
      throw new Error('instance_behavior must be a string');
    }

    const normalized = instanceBehavior.toLowerCase();
    if (normalized !== 'single' && normalized !== 'multi') {
      throw new Error('instance_behavior must be "single" or "multi"');
    }

    return normalized;
  }

  /**
   * Validate service type configuration
   */
  static validateServiceTypeConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Service type configuration must be an object');
    }

    // Required fields
    if (!config.description || typeof config.description !== 'string') {
      throw new Error('Service type must have a description string');
    }

    if (!Array.isArray(config.port_range) || config.port_range.length !== 2) {
      throw new Error('Service type must have a port_range array with [start, end]');
    }

    const [start, end] = config.port_range;
    this.validatePort(start);
    this.validatePort(end);

    if (start > end) {
      throw new Error('Port range start must be less than or equal to end');
    }

    // Optional fields
    if (config.instance_behavior) {
      config.instance_behavior = this.validateInstanceBehavior(config.instance_behavior);
    }

    return config;
  }

  /**
   * Validate auto-allocation configuration (Feature #2)
   */
  static validateAutoAllocationConfig(config) {
    if (!config || typeof config !== 'object') {
      throw new Error('Auto-allocation configuration must be an object');
    }

    // Validate enabled flag
    if (config.enabled !== undefined && typeof config.enabled !== 'boolean') {
      throw new Error('auto_allocation.enabled must be a boolean');
    }

    // Validate chunk_size
    if (config.default_chunk_size !== undefined) {
      const chunkSize = parseInt(config.default_chunk_size, 10);
      if (isNaN(chunkSize) || chunkSize < 1 || chunkSize > 1000) {
        throw new Error('auto_allocation.default_chunk_size must be between 1 and 1000');
      }
    }

    // Validate placement strategy
    if (config.placement !== undefined) {
      const validPlacements = ['after', 'before', 'smart'];
      if (!validPlacements.includes(config.placement)) {
        throw new Error(`auto_allocation.placement must be one of: ${validPlacements.join(', ')}`);
      }
    }

    // Validate port boundaries
    if (config.min_port !== undefined) {
      this.validatePort(config.min_port);
    }

    if (config.max_port !== undefined) {
      this.validatePort(config.max_port);
    }

    if (config.min_port && config.max_port && config.min_port >= config.max_port) {
      throw new Error('auto_allocation.min_port must be less than max_port');
    }

    // Validate preserve_gaps
    if (config.preserve_gaps !== undefined && typeof config.preserve_gaps !== 'boolean') {
      throw new Error('auto_allocation.preserve_gaps must be a boolean');
    }

    // Validate gap_size
    if (config.gap_size !== undefined) {
      const gapSize = parseInt(config.gap_size, 10);
      if (isNaN(gapSize) || gapSize < 0 || gapSize > 1000) {
        throw new Error('auto_allocation.gap_size must be between 0 and 1000');
      }
    }

    return config;
  }

  /**
   * Validate auto-allocation rule (Feature #2)
   */
  static validateAutoAllocationRule(pattern, rule) {
    if (!pattern || typeof pattern !== 'string') {
      throw new Error('Auto-allocation rule pattern must be a non-empty string');
    }

    if (!rule || typeof rule !== 'object') {
      throw new Error('Auto-allocation rule must be an object');
    }

    // Validate chunk_size
    if (rule.chunk_size !== undefined) {
      const chunkSize = parseInt(rule.chunk_size, 10);
      if (isNaN(chunkSize) || chunkSize < 1 || chunkSize > 1000) {
        throw new Error(`Rule ${pattern}: chunk_size must be between 1 and 1000`);
      }
    }

    // Validate placement
    if (rule.placement !== undefined) {
      const validPlacements = ['after', 'before', 'smart'];
      if (!validPlacements.includes(rule.placement)) {
        throw new Error(`Rule ${pattern}: placement must be one of: ${validPlacements.join(', ')}`);
      }
    }

    // Validate preferred_range_start
    if (rule.preferred_range_start !== undefined) {
      this.validatePort(rule.preferred_range_start);
    }

    return rule;
  }

  /**
   * Validate all auto-allocation rules (Feature #2)
   */
  static validateAutoAllocationRules(rules) {
    if (!rules || typeof rules !== 'object') {
      throw new Error('Auto-allocation rules must be an object');
    }

    for (const [pattern, rule] of Object.entries(rules)) {
      this.validateAutoAllocationRule(pattern, rule);
    }

    return rules;
  }
}

module.exports = Validator;