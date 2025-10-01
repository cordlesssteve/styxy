/**
 * Health Monitor - Service Health Monitoring Layer (Feature #3, Phase 2)
 *
 * Provides periodic health checks for allocated ports and automatic
 * cleanup of stale allocations.
 */

const Logger = require('./logger');

class HealthMonitor {
  constructor(daemon) {
    if (!daemon) {
      throw new Error('Daemon instance required for HealthMonitor');
    }

    this.daemon = daemon;
    this.logger = new Logger({ component: 'health-monitor' });

    // Health check state tracking
    this.healthChecks = new Map(); // port -> { lastCheck, failures, pid }

    // Configuration (from daemon's recovery config)
    this.config = daemon.recoveryConfig?.health_monitoring || {
      enabled: false,
      check_interval_ms: 30000,
      max_failures: 3,
      cleanup_stale_allocations: true
    };

    // Monitoring state
    this.monitoringActive = false;
    this.monitoringTimer = null;
  }

  /**
   * Start health monitoring
   */
  async startMonitoring() {
    if (!this.config.enabled) {
      this.logger.info('Health monitoring is disabled');
      return;
    }

    if (this.monitoringActive) {
      this.logger.warn('Health monitoring already active');
      return;
    }

    this.monitoringActive = true;
    this.logger.info('Starting health monitoring', {
      check_interval_ms: this.config.check_interval_ms,
      max_failures: this.config.max_failures,
      cleanup_stale: this.config.cleanup_stale_allocations
    });

    // Start periodic health checks
    this.monitoringTimer = setInterval(
      () => this.performHealthChecks(),
      this.config.check_interval_ms
    );

    // Run initial health check immediately
    await this.performHealthChecks();
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }

    this.monitoringActive = false;
    this.healthChecks.clear();

    this.logger.info('Health monitoring stopped');
  }

  /**
   * Perform health checks on all allocations
   */
  async performHealthChecks() {
    if (!this.monitoringActive) {
      return;
    }

    const allocations = Array.from(this.daemon.allocations.values());

    this.logger.debug('Performing health checks', {
      allocation_count: allocations.length
    });

    let healthyCount = 0;
    let unhealthyCount = 0;
    let cleanedCount = 0;

    for (const allocation of allocations) {
      try {
        const healthy = await this.checkAllocation(allocation);

        if (healthy) {
          healthyCount++;
          // Reset failure count on success
          this.healthChecks.set(allocation.port, {
            lastCheck: Date.now(),
            failures: 0,
            pid: allocation.process_id
          });
        } else {
          unhealthyCount++;
          const cleaned = await this.handleUnhealthyAllocation(allocation);
          if (cleaned) {
            cleanedCount++;
          }
        }
      } catch (error) {
        this.logger.error('Health check failed for allocation', {
          port: allocation.port,
          error: error.message
        });
      }
    }

    // Update metrics
    if (this.daemon.metrics) {
      this.daemon.metrics.setGauge('health_checks_healthy', healthyCount);
      this.daemon.metrics.setGauge('health_checks_unhealthy', unhealthyCount);
      this.daemon.metrics.incrementCounter('health_checks_total', allocations.length);

      if (cleanedCount > 0) {
        this.daemon.metrics.incrementCounter('stale_allocations_cleaned_total', cleanedCount);
      }
    }

    this.logger.debug('Health check cycle complete', {
      total: allocations.length,
      healthy: healthyCount,
      unhealthy: unhealthyCount,
      cleaned: cleanedCount
    });
  }

  /**
   * Check if an allocation is healthy
   * @param {Object} allocation - Allocation object
   * @returns {Promise<boolean>} - True if healthy, false otherwise
   */
  async checkAllocation(allocation) {
    // Check 1: Process still running
    if (allocation.process_id) {
      try {
        // Signal 0 just checks if process exists without killing it
        process.kill(allocation.process_id, 0);
      } catch (err) {
        if (err.code === 'ESRCH') {
          this.logger.warn('Process not found for allocation', {
            port: allocation.port,
            pid: allocation.process_id,
            serviceType: allocation.serviceType
          });
          return false;
        }
        // Other errors (EPERM, etc.) mean process exists but we can't signal it
        // Consider this healthy since process is running
      }
    }

    // Check 2: Port still in use
    const portInUse = !(await this.daemon.checkPortActuallyAvailable(allocation.port));
    if (!portInUse) {
      this.logger.warn('Port no longer in use', {
        port: allocation.port,
        serviceType: allocation.serviceType,
        serviceName: allocation.serviceName
      });
      return false;
    }

    // Check 3: Service-specific health check (if configured)
    // TODO: Add HTTP health check support in future enhancement
    // if (allocation.healthCheckUrl) {
    //   const healthy = await this.performHttpHealthCheck(allocation.healthCheckUrl);
    //   if (!healthy) {
    //     this.logger.warn('HTTP health check failed', {
    //       port: allocation.port,
    //       url: allocation.healthCheckUrl
    //     });
    //     return false;
    //   }
    // }

    return true;
  }

  /**
   * Handle unhealthy allocation
   * @param {Object} allocation - Allocation object
   * @returns {Promise<boolean>} - True if allocation was cleaned up
   */
  async handleUnhealthyAllocation(allocation) {
    const check = this.healthChecks.get(allocation.port) || { failures: 0 };
    check.failures++;
    check.lastCheck = Date.now();
    this.healthChecks.set(allocation.port, check);

    this.logger.info('Allocation health check failed', {
      port: allocation.port,
      serviceType: allocation.serviceType,
      failures: check.failures,
      max_failures: this.config.max_failures
    });

    // Check if we've exceeded max failures
    if (check.failures >= this.config.max_failures) {
      if (this.config.cleanup_stale_allocations) {
        this.logger.warn('Cleaning up stale allocation after multiple failures', {
          port: allocation.port,
          serviceType: allocation.serviceType,
          serviceName: allocation.serviceName,
          failures: check.failures
        });

        // Release the stale allocation
        try {
          await this.daemon.releasePort(allocation.port, allocation.lockId);

          // Emit event for external monitoring
          if (this.daemon.emit) {
            this.daemon.emit('allocation:stale:released', allocation);
          }

          // Clean up health check tracking
          this.healthChecks.delete(allocation.port);

          // Audit log
          this.logger.audit('STALE_ALLOCATION_CLEANED', {
            port: allocation.port,
            lockId: allocation.lockId,
            serviceType: allocation.serviceType,
            serviceName: allocation.serviceName,
            failures: check.failures
          });

          return true; // Cleaned up
        } catch (error) {
          this.logger.error('Failed to release stale allocation', {
            port: allocation.port,
            error: error.message
          });
          return false;
        }
      } else {
        this.logger.warn('Stale allocation detected but cleanup is disabled', {
          port: allocation.port,
          serviceType: allocation.serviceType
        });
        return false;
      }
    }

    return false; // Not cleaned up yet
  }

  /**
   * Get health monitoring statistics
   * @returns {Object} - Statistics object
   */
  getStatistics() {
    const allocations = Array.from(this.daemon.allocations.values());
    const failingAllocations = Array.from(this.healthChecks.entries())
      .filter(([_, check]) => check.failures > 0)
      .map(([port, check]) => ({ port, failures: check.failures }));

    return {
      enabled: this.config.enabled,
      active: this.monitoringActive,
      check_interval_ms: this.config.check_interval_ms,
      max_failures: this.config.max_failures,
      total_allocations: allocations.length,
      tracked_allocations: this.healthChecks.size,
      failing_allocations: failingAllocations.length,
      failing_details: failingAllocations
    };
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stopMonitoring();
  }
}

module.exports = HealthMonitor;
