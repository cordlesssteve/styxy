/**
 * Input Validation Utilities
 *
 * Provides centralized validation functions to prevent injection attacks
 * and ensure data integrity across the Styxy daemon.
 */

class Validator {
  /**
   * Validate port number
   */
  static validatePort(port) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum)) {
      throw new Error(`Port must be a number, got: ${port}`);
    }
    if (portNum < 1 || portNum > 65535) {
      throw new Error(`Port must be between 1-65535, got: ${portNum}`);
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
      throw new Error(`Unknown service type: ${serviceType}. Allowed: ${Object.keys(allowedTypes).join(', ')}`);
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
}

module.exports = Validator;