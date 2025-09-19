/**
 * Enhanced Daemon Client with Retry Logic and Circuit Breaker
 */

const Logger = require('./logger');
const CircuitBreaker = require('./circuit-breaker');

class DaemonClient {
  constructor(options = {}) {
    this.logger = new Logger({ component: 'daemon-client' });
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000; // 1 second
    this.maxDelay = options.maxDelay || 10000; // 10 seconds
    this.timeout = options.timeout || 5000; // 5 seconds
    this.circuitBreaker = new CircuitBreaker({
      name: 'daemon-client',
      failureThreshold: 5,
      recoveryTimeout: 30000,
      expectedErrors: ['ECONNREFUSED', 'TIMEOUT']
    });
  }

  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateDelay(attempt) {
    const delay = this.baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
    return Math.min(delay + jitter, this.maxDelay);
  }

  /**
   * Discover the daemon URL with fallback strategy
   */
  async getDaemonUrl() {
    // 1. Check environment variable override
    const portOverride = process.env.STYXY_DAEMON_PORT;
    if (portOverride) {
      return `http://127.0.0.1:${portOverride}`;
    }

    // 2. Try auto-discovery on common ports
    const commonPorts = [9876, 9877, 9878, 9879, 9880];

    for (const port of commonPorts) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(`http://127.0.0.1:${port}/status`, {
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          if (data.status === 'running') {
            this.logger.debug('Discovered daemon URL', { port });
            return `http://127.0.0.1:${port}`;
          }
        }
      } catch (error) {
        this.logger.trace('Port discovery failed', { port, error: error.message });
        continue;
      }
    }

    // 3. Fallback to default
    this.logger.warn('Using default daemon port, auto-discovery failed');
    return 'http://127.0.0.1:9876';
  }

  /**
   * Make a request with retry logic and circuit breaker
   */
  async makeRequest(endpoint, options = {}) {
    return this.circuitBreaker.execute(async () => {
      let lastError;

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const baseUrl = await this.getDaemonUrl();
          const url = `${baseUrl}${endpoint}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => {
            controller.abort();
          }, this.timeout);

          const response = await fetch(url, {
            ...options,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          // Log successful request
          this.logger.debug('Daemon request successful', {
            endpoint,
            method: options.method || 'GET',
            attempt,
            status: response.status
          });

          return response;

        } catch (error) {
          lastError = error;
          const isLastAttempt = attempt === this.maxRetries;

          this.logger.warn('Daemon request failed', {
            endpoint,
            attempt,
            maxRetries: this.maxRetries,
            error: error.message,
            willRetry: !isLastAttempt
          });

          if (isLastAttempt) {
            break;
          }

          // Wait before retrying
          const delay = this.calculateDelay(attempt);
          await this.sleep(delay);
        }
      }

      // All retries failed
      const friendlyError = this.createFriendlyError(lastError);
      this.logger.error('All daemon request retries failed', {
        endpoint,
        maxRetries: this.maxRetries,
        finalError: lastError.message
      });

      throw friendlyError;
    });
  }

  /**
   * Create user-friendly error messages
   */
  createFriendlyError(error) {
    if (error.name === 'AbortError') {
      return new Error(`Request timeout: Styxy daemon took longer than ${this.timeout}ms to respond`);
    }

    if (error.code === 'ECONNREFUSED' || error.name === 'TypeError') {
      return new Error('Styxy daemon is not running. Start it with: styxy daemon start');
    }

    if (error.circuitBreakerOpen) {
      return new Error('Styxy daemon is temporarily unavailable due to repeated failures. Please wait and try again.');
    }

    return error;
  }

  /**
   * Health check with fast timeout
   */
  async healthCheck() {
    try {
      const response = await this.makeRequest('/status', {
        method: 'GET'
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get circuit breaker statistics
   */
  getStats() {
    return {
      circuitBreaker: this.circuitBreaker.getStats(),
      config: {
        maxRetries: this.maxRetries,
        timeout: this.timeout,
        baseDelay: this.baseDelay,
        maxDelay: this.maxDelay
      }
    };
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.circuitBreaker) {
      this.circuitBreaker.destroy();
    }
  }
}

// Create singleton instance
const defaultClient = new DaemonClient();

/**
 * Legacy function for backward compatibility
 */
async function getDaemonUrl() {
  return defaultClient.getDaemonUrl();
}

/**
 * Legacy function for backward compatibility
 */
async function daemonRequest(endpoint, options = {}) {
  return defaultClient.makeRequest(endpoint, options);
}

module.exports = {
  DaemonClient,
  getDaemonUrl,
  daemonRequest,
  default: defaultClient
};