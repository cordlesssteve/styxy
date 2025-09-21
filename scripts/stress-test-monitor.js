#!/usr/bin/env node
/**
 * Styxy Stress Test Monitor
 *
 * Monitors daemon performance during stress tests
 * - Memory usage
 * - Response times
 * - Active allocations
 * - Process health
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class StressTestMonitor {
  constructor() {
    this.authToken = this.loadAuthToken();
    this.baseUrl = 'http://localhost:9876';
    this.monitoring = false;
    this.samples = [];
    this.startTime = null;
  }

  loadAuthToken() {
    try {
      const tokenPath = path.join(process.env.HOME, '.styxy', 'auth.token');
      return fs.readFileSync(tokenPath, 'utf8').trim();
    } catch (error) {
      console.error('❌ Failed to load auth token');
      process.exit(1);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async checkDaemonHealth() {
    return new Promise((resolve) => {
      const startTime = Date.now();

      exec(`curl -s -H "Authorization: Bearer ${this.authToken}" ${this.baseUrl}/health`, (error, stdout) => {
        const responseTime = Date.now() - startTime;

        if (error) {
          resolve({
            healthy: false,
            responseTime,
            error: error.message
          });
          return;
        }

        try {
          const health = JSON.parse(stdout);
          resolve({
            healthy: health.status === 'healthy',
            responseTime,
            uptime: health.uptime,
            memory: health.system?.memory,
            allocations: health.services?.daemon?.allocations || 0,
            instances: health.services?.daemon?.instances || 0
          });
        } catch (parseError) {
          resolve({
            healthy: false,
            responseTime,
            error: 'Parse error'
          });
        }
      });
    });
  }

  async getSystemMetrics() {
    return new Promise((resolve) => {
      exec('ps aux | grep "styxy.*daemon" | grep -v grep', (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve({ cpu: 0, memory: 0, pid: null });
          return;
        }

        const lines = stdout.trim().split('\n');
        const line = lines[0]; // First styxy daemon process
        const parts = line.split(/\s+/);

        resolve({
          pid: parseInt(parts[1]),
          cpu: parseFloat(parts[2]),
          memory: parseFloat(parts[3]),
          memoryKB: parseInt(parts[5])
        });
      });
    });
  }

  async takeSample() {
    const timestamp = Date.now();
    const relativeTime = this.startTime ? timestamp - this.startTime : 0;

    const [health, system] = await Promise.all([
      this.checkDaemonHealth(),
      this.getSystemMetrics()
    ]);

    const sample = {
      timestamp,
      relativeTime,
      health,
      system
    };

    this.samples.push(sample);
    return sample;
  }

  async startMonitoring(intervalMs = 1000) {
    if (this.monitoring) return;

    this.monitoring = true;
    this.startTime = Date.now();
    this.samples = [];

    console.log('📊 Starting stress test monitoring...');
    console.log('   Interval: 1 second');
    console.log('   Monitoring: health, memory, allocations, response times');

    while (this.monitoring) {
      const sample = await this.takeSample();

      if (sample.health.healthy) {
        console.log(`[${new Date().toLocaleTimeString()}] ` +
          `Allocations: ${sample.health.allocations || 0} | ` +
          `Memory: ${(sample.system.memoryKB / 1024).toFixed(1)}MB | ` +
          `Response: ${sample.health.responseTime}ms | ` +
          `CPU: ${sample.system.cpu}%`);
      } else {
        console.log(`[${new Date().toLocaleTimeString()}] ❌ Daemon unhealthy: ${sample.health.error}`);
      }

      await this.delay(intervalMs);
    }
  }

  stopMonitoring() {
    this.monitoring = false;
  }

  generateReport() {
    if (this.samples.length === 0) {
      console.log('📊 No monitoring data available');
      return;
    }

    console.log('\n📊 STRESS TEST MONITORING REPORT');
    console.log('================================================');

    const healthySamples = this.samples.filter(s => s.health.healthy);
    const unhealthySamples = this.samples.filter(s => !s.health.healthy);

    console.log(`🎯 Monitoring Overview:`);
    console.log(`   Duration: ${((this.samples[this.samples.length - 1]?.relativeTime || 0) / 1000).toFixed(1)}s`);
    console.log(`   Samples: ${this.samples.length}`);
    console.log(`   Healthy: ${healthySamples.length} (${((healthySamples.length/this.samples.length)*100).toFixed(1)}%)`);
    console.log(`   Unhealthy: ${unhealthySamples.length}`);

    if (healthySamples.length > 0) {
      const responseTimes = healthySamples.map(s => s.health.responseTime);
      const memoryUsage = healthySamples.map(s => s.system.memoryKB / 1024);
      const cpuUsage = healthySamples.map(s => s.system.cpu);
      const allocations = healthySamples.map(s => s.health.allocations || 0);

      console.log(`\n⚡ Performance Metrics:`);
      console.log(`   Response Time: ${Math.min(...responseTimes)}ms - ${Math.max(...responseTimes)}ms (avg: ${(responseTimes.reduce((a,b) => a+b, 0)/responseTimes.length).toFixed(1)}ms)`);
      console.log(`   Memory Usage: ${Math.min(...memoryUsage).toFixed(1)}MB - ${Math.max(...memoryUsage).toFixed(1)}MB (avg: ${(memoryUsage.reduce((a,b) => a+b, 0)/memoryUsage.length).toFixed(1)}MB)`);
      console.log(`   CPU Usage: ${Math.min(...cpuUsage).toFixed(1)}% - ${Math.max(...cpuUsage).toFixed(1)}% (avg: ${(cpuUsage.reduce((a,b) => a+b, 0)/cpuUsage.length).toFixed(1)}%)`);
      console.log(`   Allocations: ${Math.min(...allocations)} - ${Math.max(...allocations)} (peak: ${Math.max(...allocations)})`);

      // Performance thresholds
      const avgResponseTime = responseTimes.reduce((a,b) => a+b, 0)/responseTimes.length;
      const maxMemory = Math.max(...memoryUsage);
      const maxCpu = Math.max(...cpuUsage);

      console.log(`\n🎯 Performance Assessment:`);
      console.log(`   Response Time: ${avgResponseTime < 100 ? '✅ Excellent' : avgResponseTime < 500 ? '⚠️ Good' : '❌ Slow'} (${avgResponseTime.toFixed(1)}ms avg)`);
      console.log(`   Memory Usage: ${maxMemory < 100 ? '✅ Low' : maxMemory < 200 ? '⚠️ Moderate' : '❌ High'} (${maxMemory.toFixed(1)}MB peak)`);
      console.log(`   CPU Usage: ${maxCpu < 25 ? '✅ Low' : maxCpu < 50 ? '⚠️ Moderate' : '❌ High'} (${maxCpu.toFixed(1)}% peak)`);
      console.log(`   Stability: ${unhealthySamples.length === 0 ? '✅ Stable' : '❌ Unstable'} (${unhealthySamples.length} unhealthy samples)`);
    }

    if (unhealthySamples.length > 0) {
      console.log(`\n❌ Health Issues:`);
      unhealthySamples.forEach((sample, i) => {
        console.log(`   ${i + 1}. ${new Date(sample.timestamp).toLocaleTimeString()}: ${sample.health.error}`);
      });
    }
  }

  async saveReport(filename) {
    const report = {
      testDate: new Date().toISOString(),
      duration: this.samples.length > 0 ? (this.samples[this.samples.length - 1]?.relativeTime || 0) / 1000 : 0,
      samples: this.samples,
      summary: {
        totalSamples: this.samples.length,
        healthySamples: this.samples.filter(s => s.health.healthy).length,
        unhealthySamples: this.samples.filter(s => !s.health.healthy).length
      }
    };

    const reportPath = path.join(__dirname, filename || 'stress-test-monitoring-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`💾 Detailed report saved to: ${reportPath}`);
  }
}

// Main execution for standalone use
async function main() {
  const args = process.argv.slice(2);
  const monitor = new StressTestMonitor();

  if (args.includes('--report-only')) {
    // Generate report from existing data
    console.log('📊 No active monitoring to report');
  } else {
    // Start monitoring (will run until interrupted)
    console.log('📊 Starting continuous monitoring...');
    console.log('   Press Ctrl+C to stop and generate report');

    process.on('SIGINT', () => {
      console.log('\n🛑 Stopping monitoring...');
      monitor.stopMonitoring();
      monitor.generateReport();
      process.exit(0);
    });

    await monitor.startMonitoring(1000);
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = StressTestMonitor;