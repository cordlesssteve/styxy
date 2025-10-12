/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides fault tolerance for external system calls by preventing
 * cascading failures and allowing systems to recover gracefully.
 */

const Logger = require('./logger');

class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.recoveryTimeout = options.recoveryTimeout || 30000; // 30 seconds
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    this.expectedErrors = options.expectedErrors || [];

    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.totalAttempts = 0;

    this.logger = new Logger({ component: `circuit-breaker-${this.name}` });

    // Reset failure count periodically
    // Use unref() to allow process to exit even if timer is active (important for CLI commands)
    this.monitoringInterval = setInterval(() => {
      this.resetMetrics();
    }, this.monitoringPeriod).unref();
  }

  async execute(fn) {
    this.totalAttempts++;

    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        this.logger.info('Circuit breaker transitioning to HALF_OPEN', {
          name: this.name,
          failureCount: this.failureCount
        });
      } else {
        const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
        error.circuitBreakerOpen = true;
        throw error;
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  onSuccess() {
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.logger.info('Circuit breaker reset to CLOSED', {
        name: this.name,
        successCount: this.successCount
      });
    }
  }

  onFailure(error) {
    // Don't count expected errors as failures
    if (this.isExpectedError(error)) {
      this.logger.debug('Expected error, not counting as failure', {
        name: this.name,
        error: error.message
      });
      return;
    }

    this.failureCount++;
    this.lastFailureTime = Date.now();

    this.logger.warn('Circuit breaker recorded failure', {
      name: this.name,
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message
    });

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      this.logger.error('Circuit breaker opened due to failures', {
        name: this.name,
        failureCount: this.failureCount,
        threshold: this.failureThreshold
      });
    }
  }

  shouldAttemptReset() {
    return Date.now() - this.lastFailureTime >= this.recoveryTimeout;
  }

  isExpectedError(error) {
    return this.expectedErrors.some(expectedError => {
      if (typeof expectedError === 'string') {
        return error.message.includes(expectedError);
      }
      if (expectedError instanceof RegExp) {
        return expectedError.test(error.message);
      }
      if (typeof expectedError === 'function') {
        return expectedError(error);
      }
      return false;
    });
  }

  resetMetrics() {
    if (this.state === 'CLOSED') {
      this.failureCount = 0;
      this.successCount = 0;
    }
  }

  getStats() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalAttempts: this.totalAttempts,
      failureRate: this.totalAttempts > 0 ? (this.failureCount / this.totalAttempts) : 0,
      lastFailureTime: this.lastFailureTime
    };
  }

  destroy() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
}

module.exports = CircuitBreaker;