#!/usr/bin/env node
/**
 * Manageable Stress Test for Styxy Port Coordination
 *
 * Realistic test scenarios that don't overwhelm the system
 * Focuses on coordination logic validation rather than load testing
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class ManageableStressTest {
  constructor() {
    this.baseUrl = 'http://localhost:9876';
    this.authToken = this.loadAuthToken();
    this.allocations = [];
    this.results = [];
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

  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const http = require('http');
      const url = new URL(endpoint, this.baseUrl);

      const headers = {
        'Content-Type': 'application/json'
      };

      // Only add auth for endpoints that require it (not /status)
      if (endpoint !== '/status') {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const options = {
        method,
        headers
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            resolve({ status: res.statusCode, data: response });
          } catch (error) {
            resolve({ status: res.statusCode, data: body });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(3000, () => {
        req.destroy();
        reject(new Error('Request timeout (3s)'));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  async allocatePort(service_type, preferred_port, service_name) {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest('POST', '/allocate', {
        service_type,
        preferred_port,
        service_name,
        instance_id: `manageable-test-${service_name}`,
        project_path: process.cwd()
      });

      const duration = Date.now() - startTime;

      if (response.status === 200 && response.data.success) {
        this.allocations.push({
          lockId: response.data.lock_id,
          port: response.data.port,
          serviceName: service_name
        });

        return {
          success: true,
          port: response.data.port,
          lockId: response.data.lock_id,
          duration,
          serviceName: service_name
        };
      } else {
        return {
          success: false,
          error: response.data.error || 'Request failed',
          duration,
          serviceName: service_name
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: error.message,
        duration,
        serviceName: service_name
      };
    }
  }

  async testSequentialConflicts() {
    console.log('\n🧪 Test 1: Sequential Port Conflicts (Real Development Workflow)');
    console.log('================================================================');

    const scenarios = [
      { service: 'storybook', port: 6006, name: 'storybook-seq' },
      { service: 'dev', port: 3000, name: 'dev-seq' },
      { service: 'api', port: 8000, name: 'api-seq' }
    ];

    for (const scenario of scenarios) {
      console.log(`\n📋 Testing ${scenario.service} service on port ${scenario.port}`);
      const results = [];

      for (let i = 1; i <= 3; i++) {
        const serviceName = `${scenario.name}-${i}`;
        console.log(`   🔄 Request ${i}/3: ${serviceName}`);

        const result = await this.allocatePort(scenario.service, scenario.port, serviceName);
        results.push(result);

        if (result.success) {
          console.log(`   ✅ Port ${result.port} allocated (${result.duration}ms)`);
        } else {
          console.log(`   ❌ Failed: ${result.error} (${result.duration}ms)`);
        }

        // Wait 1 second between requests (realistic development timing)
        if (i < 3) await this.delay(1000);
      }

      this.analyzeSequentialResults(scenario, results);
      await this.delay(2000); // Pause between scenarios
    }
  }

  analyzeSequentialResults(scenario, results) {
    const successful = results.filter(r => r.success);
    const ports = successful.map(r => r.port).sort((a, b) => a - b);
    const avgResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log(`   📊 Results: ${successful.length}/3 successful`);
    console.log(`   🎯 Ports: [${ports.join(', ')}]`);
    console.log(`   ⏱️  Avg response: ${avgResponseTime.toFixed(1)}ms`);

    const isSequential = this.checkSequential(ports, scenario.port);
    console.log(`   ✅ Sequential allocation: ${isSequential ? 'PASS' : 'FAIL'}`);

    this.results.push({
      test: 'sequential',
      scenario: scenario.name,
      successful: successful.length,
      total: 3,
      ports,
      isSequential,
      avgResponseTime
    });
  }

  async testSmallConcurrency() {
    console.log('\n🧪 Test 2: Small Concurrent Batches (Team Coordination)');
    console.log('========================================================');

    const scenarios = [
      { service: 'test', port: 9200, name: 'playwright' },
      { service: 'docs', port: 4100, name: 'docusaurus' }
    ];

    for (const scenario of scenarios) {
      console.log(`\n📋 Testing 2 concurrent ${scenario.service} requests on port ${scenario.port}`);

      const promises = [];
      const startTime = Date.now();

      // Launch 2 requests simultaneously
      for (let i = 1; i <= 2; i++) {
        const serviceName = `${scenario.name}-concurrent-${i}`;
        promises.push(this.allocatePort(scenario.service, scenario.port, serviceName));
      }

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startTime;

      console.log(`   ⏱️  Concurrent completion: ${totalTime}ms`);

      results.forEach((result, i) => {
        if (result.success) {
          console.log(`   ✅ Request ${i+1}: Port ${result.port} (${result.duration}ms)`);
        } else {
          console.log(`   ❌ Request ${i+1}: ${result.error} (${result.duration}ms)`);
        }
      });

      this.analyzeSequentialResults(scenario, results);
      await this.delay(2000);
    }
  }

  async testResponseTimes() {
    console.log('\n🧪 Test 3: Response Time Analysis (Performance Check)');
    console.log('=====================================================');

    const services = ['monitoring', 'build', 'proxy'];
    const results = [];

    for (const service of services) {
      console.log(`\n📋 Testing ${service} service response time`);

      const result = await this.allocatePort(service, null, `${service}-perf-test`);
      results.push(result);

      if (result.success) {
        console.log(`   ✅ Port ${result.port} allocated in ${result.duration}ms`);
      } else {
        console.log(`   ❌ Failed: ${result.error} (${result.duration}ms)`);
      }

      await this.delay(500);
    }

    const avgResponseTime = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    const maxResponseTime = Math.max(...results.map(r => r.duration));
    const successRate = results.filter(r => r.success).length / results.length;

    console.log(`\n   📊 Performance Summary:`);
    console.log(`   ⏱️  Average response: ${avgResponseTime.toFixed(1)}ms`);
    console.log(`   🔥 Max response: ${maxResponseTime}ms`);
    console.log(`   ✅ Success rate: ${(successRate * 100).toFixed(1)}%`);
    console.log(`   🎯 Performance: ${avgResponseTime < 200 ? 'EXCELLENT' : avgResponseTime < 1000 ? 'GOOD' : 'SLOW'}`);
  }

  checkSequential(ports, startPort) {
    if (ports.length === 0) return true;

    for (let i = 0; i < ports.length; i++) {
      if (ports[i] !== startPort + i) {
        return false;
      }
    }
    return true;
  }

  async generateSummary() {
    console.log('\n📊 MANAGEABLE STRESS TEST SUMMARY');
    console.log('==================================');

    const sequentialResults = this.results.filter(r => r.test === 'sequential');
    const allSequential = sequentialResults.every(r => r.isSequential);
    const avgResponseTime = sequentialResults.reduce((sum, r) => sum + r.avgResponseTime, 0) / sequentialResults.length;

    console.log(`🎯 Test Results:`);
    console.log(`   Sequential Tests: ${sequentialResults.length}`);
    console.log(`   Sequential Allocation: ${allSequential ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Average Response: ${avgResponseTime.toFixed(1)}ms`);
    console.log(`   Total Allocations: ${this.allocations.length}`);

    if (allSequential && avgResponseTime < 1000) {
      console.log(`\n🎉 SUCCESS: Port coordination working well!`);
      console.log(`   ✅ Sequential allocation working`);
      console.log(`   ✅ Reasonable response times`);
      console.log(`   ✅ System stable under realistic load`);
    } else {
      console.log(`\n⚠️  Issues detected:`);
      if (!allSequential) console.log(`   ❌ Non-sequential allocation`);
      if (avgResponseTime >= 1000) console.log(`   ❌ Slow response times`);
    }

    console.log(`\n🧹 Allocated ports: ${this.allocations.length}`);
    console.log(`   Run with --cleanup to release them`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up manageable test allocations...');

    let cleaned = 0;
    for (const allocation of this.allocations) {
      try {
        const response = await this.makeRequest('DELETE', `/allocate/${allocation.lockId}`);
        if (response.status === 200 && response.data.success) {
          console.log(`   ✅ Released ${allocation.serviceName} (port ${allocation.port})`);
          cleaned++;
        }
      } catch (error) {
        console.log(`   ❌ Error releasing ${allocation.serviceName}: ${error.message}`);
      }
    }

    console.log(`🎉 Cleanup complete: ${cleaned}/${this.allocations.length} allocations released`);
  }

  async run() {
    console.log('🚀 Starting Manageable Stress Tests');
    console.log('===================================');

    // Check daemon status first (no auth required)
    try {
      const status = await this.makeRequest('GET', '/status');
      if (status.status !== 200) {
        throw new Error('Daemon not accessible');
      }
      console.log('✅ Daemon is running and responsive');
      console.log(`   Uptime: ${Math.round(status.data.uptime)}s, Instances: ${status.data.instances}, Allocations: ${status.data.allocations}`);
    } catch (error) {
      console.error('❌ Daemon not accessible:', error.message);
      console.log('💡 Try: ~/projects/Utility/styxy/bin/styxy daemon start');
      process.exit(1);
    }

    // Run manageable tests
    await this.testSequentialConflicts();
    await this.testSmallConcurrency();
    await this.testResponseTimes();
    await this.generateSummary();

    // Setup cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n🛑 Test interrupted, cleaning up...');
      await this.cleanup();
      process.exit(0);
    });

    console.log('\n💡 Run cleanup: node scripts/manageable-stress-test.js --cleanup');
  }
}

async function main() {
  const args = process.argv.slice(2);
  const test = new ManageableStressTest();

  if (args.includes('--cleanup')) {
    // Get existing allocations and clean up test ones
    try {
      const response = await test.makeRequest('GET', '/allocations');
      if (response.status === 200) {
        const testAllocations = response.data.allocations.filter(alloc =>
          alloc.serviceName && alloc.serviceName.includes('manageable-test')
        );

        test.allocations = testAllocations.map(alloc => ({
          lockId: alloc.lockId,
          port: alloc.port,
          serviceName: alloc.serviceName
        }));

        await test.cleanup();
      }
    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
    }
  } else {
    await test.run();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ManageableStressTest;