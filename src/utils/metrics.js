/**
 * Metrics Collection System
 *
 * Provides centralized metrics collection for monitoring
 * system performance and health.
 */

const Logger = require('./logger');

class Metrics {
  constructor(options = {}) {
    this.logger = new Logger({ component: 'metrics' });
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();
    this.startTime = Date.now();

    // Auto-reset counters periodically
    this.resetInterval = options.resetInterval || 300000; // 5 minutes
    this.resetTimer = setInterval(() => {
      this.resetCounters();
    }, this.resetInterval);
  }

  // Counter metrics (increment only)
  incrementCounter(name, value = 1, labels = {}) {
    const key = this.createKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);

    this.logger.trace('Counter incremented', {
      metric: name,
      value,
      total: current + value,
      labels
    });
  }

  // Histogram metrics (for measuring durations/sizes)
  recordHistogram(name, value, labels = {}) {
    const key = this.createKey(name, labels);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, {
        count: 0,
        sum: 0,
        min: Infinity,
        max: -Infinity,
        buckets: new Map()
      });
    }

    const histogram = this.histograms.get(key);
    histogram.count++;
    histogram.sum += value;
    histogram.min = Math.min(histogram.min, value);
    histogram.max = Math.max(histogram.max, value);

    // Add to buckets (for percentiles)
    const bucket = this.getBucket(value);
    histogram.buckets.set(bucket, (histogram.buckets.get(bucket) || 0) + 1);

    this.logger.trace('Histogram recorded', {
      metric: name,
      value,
      count: histogram.count,
      labels
    });
  }

  // Gauge metrics (current value)
  setGauge(name, value, labels = {}) {
    const key = this.createKey(name, labels);
    this.gauges.set(key, {
      value,
      timestamp: Date.now()
    });

    this.logger.trace('Gauge set', {
      metric: name,
      value,
      labels
    });
  }

  // Timing helper
  startTimer(name, labels = {}) {
    const start = Date.now();
    return () => {
      const duration = Date.now() - start;
      this.recordHistogram(name, duration, labels);
      return duration;
    };
  }

  // Performance measurement decorator
  measurePerformance(name, labels = {}) {
    return (target, propertyKey, descriptor) => {
      const originalMethod = descriptor.value;
      descriptor.value = async function(...args) {
        const endTimer = this.startTimer(name, labels);
        try {
          const result = await originalMethod.apply(this, args);
          const duration = endTimer();
          this.logger.performance(`${name} completed`, duration, labels);
          return result;
        } catch (error) {
          endTimer();
          this.incrementCounter(`${name}_errors`, 1, labels);
          throw error;
        }
      };
      return descriptor;
    };
  }

  createKey(name, labels) {
    if (Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  getBucket(value) {
    // Simple bucket strategy
    if (value < 10) return '0-10';
    if (value < 50) return '10-50';
    if (value < 100) return '50-100';
    if (value < 500) return '100-500';
    if (value < 1000) return '500-1000';
    if (value < 5000) return '1000-5000';
    return '5000+';
  }

  resetCounters() {
    const resetTime = Date.now();
    this.logger.debug('Resetting counters', {
      counters: this.counters.size,
      resetTime
    });
    this.counters.clear();
  }

  // Get all metrics in Prometheus format
  getMetrics() {
    const metrics = {
      counters: Object.fromEntries(this.counters),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([key, hist]) => [
          key,
          {
            count: hist.count,
            sum: hist.sum,
            min: hist.min === Infinity ? 0 : hist.min,
            max: hist.max === -Infinity ? 0 : hist.max,
            avg: hist.count > 0 ? hist.sum / hist.count : 0,
            buckets: Object.fromEntries(hist.buckets)
          }
        ])
      ),
      gauges: Object.fromEntries(this.gauges),
      system: {
        uptime: Date.now() - this.startTime,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        pid: process.pid
      }
    };

    return metrics;
  }

  // Export metrics in Prometheus text format
  exportPrometheus() {
    const lines = [];

    // Counters
    for (const [key, value] of this.counters) {
      lines.push(`styxy_${key} ${value}`);
    }

    // Histograms
    for (const [key, hist] of this.histograms) {
      lines.push(`styxy_${key}_count ${hist.count}`);
      lines.push(`styxy_${key}_sum ${hist.sum}`);
      if (hist.count > 0) {
        lines.push(`styxy_${key}_avg ${hist.sum / hist.count}`);
      }
    }

    // Gauges
    for (const [key, gauge] of this.gauges) {
      lines.push(`styxy_${key} ${gauge.value}`);
    }

    // System metrics
    const memory = process.memoryUsage();
    lines.push(`styxy_memory_rss ${memory.rss}`);
    lines.push(`styxy_memory_heap_used ${memory.heapUsed}`);
    lines.push(`styxy_uptime_seconds ${(Date.now() - this.startTime) / 1000}`);

    return lines.join('\n') + '\n';
  }

  destroy() {
    if (this.resetTimer) {
      clearInterval(this.resetTimer);
    }
  }
}

// Create singleton instance
const defaultMetrics = new Metrics();

module.exports = Metrics;
module.exports.default = defaultMetrics;