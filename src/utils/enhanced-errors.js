/**
 * Enhanced Error Handling Utility
 *
 * Provides actionable error messages with context and suggestions
 * as recommended in the error handling assessment.
 */

class EnhancedError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'EnhancedError';
    this.context = context;
    this.suggestions = context.suggestions || [];
    this.help_url = context.help_url || null;
    this.category = context.category || 'GENERAL';
    this.severity = context.severity || 'ERROR';
  }

  toJSON() {
    return {
      success: false,
      error: this.message,
      context: {
        suggestions: this.suggestions,
        help_url: this.help_url,
        category: this.category,
        severity: this.severity,
        ...this.context
      }
    };
  }

  toCLIMessage() {
    let output = `❌ ${this.message}\n`;

    if (this.suggestions.length > 0) {
      output += '\n💡 Suggestions:\n';
      this.suggestions.forEach(suggestion => {
        output += `   • ${suggestion}\n`;
      });
    }

    if (this.help_url) {
      output += `\n📖 More help: ${this.help_url}\n`;
    }

    return output;
  }
}

class ErrorFactory {
  /**
   * Create enhanced error for port range exhaustion
   */
  static portRangeExhausted(serviceType, start, end, allocatedPorts = []) {
    const portList = allocatedPorts.length > 0 ? allocatedPorts.join(', ') : 'none available';

    return new EnhancedError(
      `No available ports in range ${start}-${end} for service type ${serviceType}`,
      {
        category: 'RESOURCE',
        severity: 'ERROR',
        allocated_ports: allocatedPorts,
        port_range: `${start}-${end}`,
        service_type: serviceType,
        suggestions: [
          'Run "styxy cleanup" to release stale allocations',
          `Check "styxy list --service ${serviceType}" for active allocations`,
          'Release unused ports with "styxy release <lock-id>"',
          'Consider using a different service type with available ports'
        ],
        help_url: 'https://docs.styxy.io/troubleshooting#port-exhaustion'
      }
    );
  }

  /**
   * Create enhanced error for daemon unavailable
   */
  static daemonUnavailable(port = 9876) {
    return new EnhancedError(
      'Styxy daemon is not running or not responding',
      {
        category: 'CONNECTION',
        severity: 'ERROR',
        daemon_port: port,
        suggestions: [
          'Start the daemon with "styxy daemon start"',
          'Check daemon status with "styxy status"',
          'Verify daemon port is not blocked by firewall',
          'Run "styxy doctor" for comprehensive health check'
        ],
        help_url: 'https://docs.styxy.io/troubleshooting#daemon-connection'
      }
    );
  }

  /**
   * Create enhanced error for invalid service type
   */
  static invalidServiceType(serviceType, validTypes = []) {
    return new EnhancedError(
      `Invalid service type: ${serviceType}`,
      {
        category: 'CONFIGURATION',
        severity: 'ERROR',
        provided_service_type: serviceType,
        valid_service_types: validTypes,
        suggestions: [
          `Valid service types: ${validTypes.join(', ')}`,
          'Run "styxy config" to see all available service types',
          'Check your spelling and try again',
          'Use "styxy help" for usage examples'
        ],
        help_url: 'https://docs.styxy.io/configuration#service-types'
      }
    );
  }

  /**
   * Create enhanced error for invalid lock ID
   */
  static invalidLockId(lockId) {
    return new EnhancedError(
      `Invalid lock ID format: ${lockId}`,
      {
        category: 'VALIDATION',
        severity: 'ERROR',
        provided_lock_id: lockId,
        suggestions: [
          'Lock ID must be a valid UUID v4 format',
          'Get valid lock IDs with "styxy list"',
          'Example format: 550e8400-e29b-41d4-a716-446655440000',
          'Use "styxy cleanup" to remove invalid allocations'
        ],
        help_url: 'https://docs.styxy.io/api#lock-ids'
      }
    );
  }

  /**
   * Create enhanced error for port already allocated
   */
  static portAlreadyAllocated(port, allocation) {
    return new EnhancedError(
      `Port ${port} is already allocated`,
      {
        category: 'CONFLICT',
        severity: 'WARNING',
        port: port,
        current_allocation: allocation,
        suggestions: [
          `Release this port with "styxy release ${allocation.lockId}"`,
          'Use "styxy list" to see all allocations',
          'Try a different port with "styxy allocate --port <other-port>"',
          'Let Styxy auto-assign with "styxy allocate <service-type>"'
        ],
        help_url: 'https://docs.styxy.io/troubleshooting#port-conflicts'
      }
    );
  }

  /**
   * Create enhanced error for authentication failure
   */
  static authenticationFailed() {
    return new EnhancedError(
      'Invalid API key or authentication failed',
      {
        category: 'AUTHENTICATION',
        severity: 'ERROR',
        suggestions: [
          'Check your API key in ~/.styxy/config.json',
          'Run "styxy auth setup" to configure authentication',
          'Verify the daemon was started with authentication enabled',
          'Contact administrator for valid API key'
        ],
        help_url: 'https://docs.styxy.io/authentication'
      }
    );
  }

  /**
   * Create enhanced error for port validation
   */
  static invalidPort(port) {
    return new EnhancedError(
      `Invalid port number: ${port}`,
      {
        category: 'VALIDATION',
        severity: 'ERROR',
        provided_port: port,
        suggestions: [
          'Port must be a number between 1 and 65535',
          'Avoid well-known ports (1-1023) for development services',
          'Use ports 3000-9999 for most development services',
          'Check "styxy scan <range>" to find available ports'
        ],
        help_url: 'https://docs.styxy.io/configuration#port-ranges'
      }
    );
  }

  /**
   * Create enhanced error for cleanup operation
   */
  static cleanupError(details) {
    return new EnhancedError(
      'Failed to cleanup stale allocations',
      {
        category: 'MAINTENANCE',
        severity: 'WARNING',
        cleanup_details: details,
        suggestions: [
          'Try running cleanup again in a few seconds',
          'Check if daemon has sufficient permissions',
          'Manually release specific allocations with "styxy release <lock-id>"',
          'Restart daemon if cleanup continues to fail'
        ],
        help_url: 'https://docs.styxy.io/troubleshooting#cleanup-failures'
      }
    );
  }

  /**
   * Create a simple enhanced error wrapper
   */
  static wrap(originalError, context = {}) {
    return new EnhancedError(originalError.message, context);
  }
}

module.exports = { EnhancedError, ErrorFactory };