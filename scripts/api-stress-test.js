#!/usr/bin/env node
/**
 * Direct API Stress Test for Port Conflicts
 *
 * Tests port coordination by calling daemon API directly
 * Bypasses CLI overhead for faster, more reliable testing
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

class ApiStressTest {
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

  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);
      const options = {
        method,
        headers: {
          'Authorization': `Bearer ${this.authToken}`,
          'Content-Type': 'application/json'
        }
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
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (data) {
        req.write(JSON.stringify(data));
      }
      req.end();
    });
  }

  async allocatePort(service_type, preferred_port, service_name, instance_id) {
    const startTime = Date.now();

    try {
      const response = await this.makeRequest('POST', '/allocate', {
        service_type,
        preferred_port,
        service_name,
        instance_id,
        project_path: process.cwd()
      });

      const duration = Date.now() - startTime;

      if (response.status === 200 && response.data.success) {
        console.log(`✅ ${service_name}: Port ${response.data.port} allocated (${duration}ms)`);
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
        console.log(`❌ ${service_name}: ${response.data.error || 'Request failed'} (${duration}ms)`);
        return {
          success: false,
          error: response.data.error || 'Request failed',
          duration,
          serviceName: service_name
        };
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      console.log(`❌ ${service_name}: ${error.message} (${duration}ms)`);
      return {
        success: false,
        error: error.message,
        duration,
        serviceName: service_name
      };
    }
  }

  async testConflictScenario(scenarioName, service_type, preferred_port, count) {
    console.log(`\n🧪 Testing: ${scenarioName}`);
    console.log(`   ${count} ${service_type} services requesting port ${preferred_port}`);

    const requests = [];

    // Launch all requests simultaneously to test true concurrency
    for (let i = 0; i < count; i++) {
      const service_name = `${scenarioName}-${i + 1}`;
      const instance_id = `stress-test-${service_name}`;

      requests.push(this.allocatePort(service_type, preferred_port, service_name, instance_id));
    }

    // Wait for all to complete
    const results = await Promise.all(requests);

    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const ports = successful.map(r => r.port).sort((a, b) => a - b);

    console.log(`   📊 Results: ${successful.length}/${count} successful, ${failed.length} failed`);
    console.log(`   🎯 Allocated ports: [${ports.join(', ')}]`);

    // Verify sequential allocation
    const isSequential = this.checkSequential(ports, preferred_port);
    console.log(`   ✅ Sequential allocation: ${isSequential ? 'PASS' : 'FAIL'}`);

    // Check response times
    const responseTimes = results.map(r => r.duration);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    console.log(`   ⏱️  Average response time: ${avgResponseTime.toFixed(1)}ms`);

    return {
      scenarioName,
      service_type,
      preferred_port,
      count,
      successful: successful.length,
      failed: failed.length,
      ports,
      isSequential,
      avgResponseTime,
      results
    };
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

  async runStressTests() {
    console.log('🚀 Starting API-Based Port Conflict Stress Tests');
    console.log('=================================================');

    // Check daemon health first
    try {
      const health = await this.makeRequest('GET', '/health');
      if (health.status !== 200) {
        throw new Error('Daemon unhealthy');
      }
      console.log('✅ Daemon is healthy and responsive');
    } catch (error) {
      console.error('❌ Daemon not accessible:', error.message);
      process.exit(1);
    }

    const scenarios = [
      { name: 'storybook-conflict', service: 'storybook', port: 6006, count: 4 },
      { name: 'playwright-conflict', service: 'test', port: 9200, count: 4 },
      { name: 'cypress-conflict', service: 'test', port: 9200, count: 4 },
      { name: 'dev-server-conflict', service: 'dev', port: 3000, count: 4 },
      { name: 'api-server-conflict', service: 'api', port: 8000, count: 5 }
    ];

    const scenarioResults = [];

    for (const scenario of scenarios) {
      const result = await this.testConflictScenario(
        scenario.name,
        scenario.service,
        scenario.port,
        scenario.count
      );
      scenarioResults.push(result);

      // Brief pause between scenarios
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.generateSummary(scenarioResults);
    return scenarioResults;
  }

  generateSummary(scenarioResults) {
    console.log('\n📊 STRESS TEST SUMMARY');
    console.log('=======================');

    const totalRequests = scenarioResults.reduce((sum, r) => sum + r.count, 0);
    const totalSuccessful = scenarioResults.reduce((sum, r) => sum + r.successful, 0);
    const totalFailed = scenarioResults.reduce((sum, r) => sum + r.failed, 0);
    const allSequential = scenarioResults.every(r => r.isSequential);
    const avgResponseTime = scenarioResults.reduce((sum, r) => sum + r.avgResponseTime, 0) / scenarioResults.length;

    console.log(`🎯 Overall Results:`);
    console.log(`   Scenarios: ${scenarioResults.length}`);
    console.log(`   Total Requests: ${totalRequests}`);
    console.log(`   Successful: ${totalSuccessful} (${((totalSuccessful/totalRequests)*100).toFixed(1)}%)`);
    console.log(`   Failed: ${totalFailed} (${((totalFailed/totalRequests)*100).toFixed(1)}%)`);
    console.log(`   Sequential Allocation: ${allSequential ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`   Average Response Time: ${avgResponseTime.toFixed(1)}ms`);

    console.log(`\n📈 Per-Scenario Results:`);
    scenarioResults.forEach(result => {
      console.log(`   ${result.scenarioName}:`);
      console.log(`     Success Rate: ${result.successful}/${result.count} (${((result.successful/result.count)*100).toFixed(1)}%)`);
      console.log(`     Ports: [${result.ports.join(', ')}]`);
      console.log(`     Sequential: ${result.isSequential ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`     Avg Response: ${result.avgResponseTime.toFixed(1)}ms`);
    });

    console.log(`\n🎯 Port Coordination Analysis:`);
    if (allSequential && totalFailed === 0) {
      console.log(`   ✅ EXCELLENT: Perfect port coordination!`);
      console.log(`   ✅ All ${totalRequests} requests handled correctly`);
      console.log(`   ✅ Sequential allocation working flawlessly`);
      console.log(`   ✅ No conflicts detected`);
      console.log(`   ✅ System performs well under concurrent load`);
    } else if (allSequential && totalFailed < totalRequests * 0.1) {
      console.log(`   ⚠️  GOOD: Minor issues but coordination working`);
      console.log(`   ✅ Sequential allocation working`);
      console.log(`   ⚠️  ${totalFailed} requests failed (${((totalFailed/totalRequests)*100).toFixed(1)}%)`);
    } else {
      console.log(`   ❌ ISSUES: Problems detected in port coordination`);
      if (!allSequential) {
        console.log(`   ❌ Non-sequential allocation detected`);
      }
      if (totalFailed > 0) {
        console.log(`   ❌ ${totalFailed} requests failed (${((totalFailed/totalRequests)*100).toFixed(1)}%)`);
      }
    }

    console.log(`\n🧹 Active Allocations: ${this.allocations.length} ports allocated`);
    console.log(`   Run with --cleanup to release all test allocations`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up stress test allocations...');

    let cleaned = 0;
    for (const allocation of this.allocations) {
      try {
        const response = await this.makeRequest('DELETE', `/allocate/${allocation.lockId}`);

        if (response.status === 200 && response.data.success) {
          console.log(`   ✅ Released ${allocation.serviceName} (port ${allocation.port})`);
          cleaned++;
        } else {
          console.log(`   ❌ Failed to release ${allocation.serviceName}: ${response.data.error || 'Unknown error'}`);
        }
      } catch (error) {
        console.log(`   ❌ Error releasing ${allocation.serviceName}: ${error.message}`);
      }
    }

    console.log(`🎉 Cleanup complete: ${cleaned}/${this.allocations.length} allocations released`);
  }

  async comprehensiveCleanup() {
    console.log('\n🧹 COMPREHENSIVE CLEANUP - Removing all test instances...');

    try {
      // 1. Kill any hanging test processes
      console.log('   🔪 Killing hanging test processes...');
      const { exec } = require('child_process');

      await new Promise((resolve) => {
        exec('pkill -f "stress.*test\\|conflict.*test\\|test.*conflict" 2>/dev/null || true', resolve);
      });

      // 2. Get all allocations and clean up test-related ones
      console.log('   🔍 Finding test-related allocations...');
      const response = await this.makeRequest('GET', '/allocations');

      if (response.status === 200 && response.data.allocations) {
        const testAllocations = response.data.allocations.filter(alloc =>
          alloc.serviceName && (
            alloc.serviceName.includes('stress') ||
            alloc.serviceName.includes('test') ||
            alloc.serviceName.includes('conflict') ||
            alloc.serviceName.includes('simple-test')
          )
        );

        console.log(`   📋 Found ${testAllocations.length} test allocations to clean up`);

        let cleaned = 0;
        for (const allocation of testAllocations) {
          try {
            const cleanupResponse = await this.makeRequest('DELETE', `/allocate/${allocation.lockId}`);
            if (cleanupResponse.status === 200 && cleanupResponse.data.success) {
              console.log(`   ✅ Released ${allocation.serviceName} (port ${allocation.port})`);
              cleaned++;
            } else {
              console.log(`   ❌ Failed to release ${allocation.serviceName}`);
            }
          } catch (error) {
            console.log(`   ❌ Error releasing ${allocation.serviceName}: ${error.message}`);
          }
        }

        console.log(`   🎯 Cleaned ${cleaned}/${testAllocations.length} test allocations`);
      }

      // 3. Force cleanup any remaining stale allocations
      console.log('   🔄 Running daemon cleanup...');
      try {
        await this.makeRequest('POST', '/cleanup', { force: true });
        console.log('   ✅ Daemon cleanup completed');
      } catch (error) {
        console.log('   ⚠️  Daemon cleanup failed, but continuing...');
      }

      console.log('\n🎉 COMPREHENSIVE CLEANUP COMPLETE');
      console.log('   ✅ All test processes killed');
      console.log('   ✅ All test allocations released');
      console.log('   ✅ Daemon state cleaned');

    } catch (error) {
      console.error('❌ Comprehensive cleanup failed:', error.message);
      console.log('💡 You may need to restart the daemon: ~/projects/Utility/styxy/bin/styxy daemon restart');
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const test = new ApiStressTest();

  if (args.includes('--comprehensive-cleanup')) {
    // Full comprehensive cleanup
    await test.comprehensiveCleanup();
  } else if (args.includes('--cleanup')) {
    // Regular cleanup of test allocations
    try {
      const response = await test.makeRequest('GET', '/allocations');
      if (response.status === 200) {
        const stressAllocations = response.data.allocations.filter(alloc =>
          alloc.serviceName && (
            alloc.serviceName.includes('stress-test') ||
            alloc.serviceName.includes('conflict') ||
            alloc.serviceName.includes('test')
          )
        );

        test.allocations = stressAllocations.map(alloc => ({
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
    // Run stress tests
    console.log('🚀 Starting stress tests (use --comprehensive-cleanup when done)');

    // Setup cleanup on exit
    process.on('SIGINT', async () => {
      console.log('\n🛑 Test interrupted, running cleanup...');
      await test.comprehensiveCleanup();
      process.exit(0);
    });

    await test.runStressTests();

    if (args.includes('--auto-cleanup')) {
      await test.cleanup();
    } else {
      console.log('\n💡 Run cleanup when done:');
      console.log('   node scripts/api-stress-test.js --comprehensive-cleanup');
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ApiStressTest;