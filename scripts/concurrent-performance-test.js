#!/usr/bin/env node
/**
 * Concurrent Performance Test
 *
 * Tests the specific issue: 2 simultaneous requests for the same port
 * Measures if our optimization fixes the 2.5+ second timeout issue
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

class ConcurrentPerformanceTest {
  constructor() {
    this.baseUrl = 'http://localhost:9876';
    this.authToken = this.loadAuthToken();
    this.allocations = [];
  }

  loadAuthToken() {
    try {
      const tokenPath = path.join(process.env.HOME, '.styxy', 'auth.token');
      return fs.readFileSync(tokenPath, 'utf8').trim();
    } catch (error) {
      return 'test-token'; // Fallback for testing
    }
  }

  async makeRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(endpoint, this.baseUrl);

      const headers = {
        'Content-Type': 'application/json'
      };

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
      req.setTimeout(5000, () => {
        req.destroy();
        reject(new Error('Request timeout (5s)'));
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
        instance_id: `perf-test-${service_name}`,
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

  async testConcurrentAllocation() {
    console.log('🧪 CONCURRENT PERFORMANCE TEST');
    console.log('==============================');
    console.log('Testing: 2 simultaneous requests for port 9200');
    console.log('Expected: Both succeed, second gets 9201, both < 1000ms\n');

    // Test the exact scenario that failed before
    const startTime = Date.now();

    const promises = [
      this.allocatePort('test', 9200, 'concurrent-test-1'),
      this.allocatePort('test', 9200, 'concurrent-test-2')
    ];

    const results = await Promise.all(promises);
    const totalTime = Date.now() - startTime;

    console.log('📊 RESULTS:');
    console.log(`⏱️  Total concurrent time: ${totalTime}ms`);

    results.forEach((result, i) => {
      const status = result.success ? '✅' : '❌';
      const error = result.success ? '' : ` (${result.error})`;
      console.log(`${status} Request ${i+1}: Port ${result.port || 'N/A'} in ${result.duration}ms${error}`);
    });

    // Analysis
    const successful = results.filter(r => r.success);
    const maxDuration = Math.max(...results.map(r => r.duration));
    const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;

    console.log('\n🎯 ANALYSIS:');
    console.log(`✅ Success rate: ${successful.length}/2 (${(successful.length/2*100).toFixed(0)}%)`);
    console.log(`⏱️  Max response time: ${maxDuration}ms`);
    console.log(`📈 Avg response time: ${avgDuration.toFixed(1)}ms`);

    if (successful.length === 2) {
      const ports = successful.map(r => r.port).sort((a, b) => a - b);
      const isSequential = ports[1] === ports[0] + 1;
      console.log(`🎯 Sequential allocation: ${isSequential ? '✅ PASS' : '❌ FAIL'} (${ports.join(' → ')})`);
    }

    // Performance assessment
    if (successful.length === 2 && maxDuration < 1000) {
      console.log('\n🎉 SUCCESS: Performance issue FIXED!');
      console.log('   ✅ Both requests succeeded');
      console.log('   ✅ Response times under 1 second');
      console.log('   ✅ No timeouts');
    } else if (successful.length === 2 && maxDuration < 3000) {
      console.log('\n⚠️  IMPROVED: Better but not optimal');
      console.log('   ✅ Both requests succeeded');
      console.log('   ⚠️  Response times still over 1 second');
    } else {
      console.log('\n❌ FAILED: Performance issue remains');
      console.log('   ❌ Timeouts or very slow responses');
    }

    return { successful: successful.length, maxDuration, avgDuration };
  }

  async testMultipleServiceTypes() {
    console.log('\n🧪 MULTI-SERVICE TYPE TEST');
    console.log('==========================');
    console.log('Testing: Different service types for baseline performance\n');

    const tests = [
      { service: 'dev', port: 3000, name: 'dev-baseline' },
      { service: 'storybook', port: 6006, name: 'storybook-baseline' },
      { service: 'api', port: 8000, name: 'api-baseline' }
    ];

    for (const test of tests) {
      console.log(`🔄 Testing ${test.service} service on port ${test.port}...`);

      const result = await this.allocatePort(test.service, test.port, test.name);

      if (result.success) {
        console.log(`   ✅ Port ${result.port} allocated in ${result.duration}ms`);
      } else {
        console.log(`   ❌ Failed: ${result.error} (${result.duration}ms)`);
      }
    }
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test allocations...');

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
    try {
      // Quick daemon check
      const status = await this.makeRequest('GET', '/status');
      if (status.status !== 200) {
        throw new Error('Daemon not accessible');
      }
      console.log('✅ Daemon is responsive\n');

      // Run tests
      const concurrentResult = await this.testConcurrentAllocation();
      await this.testMultipleServiceTypes();

      // Cleanup
      await this.cleanup();

      return concurrentResult;

    } catch (error) {
      console.error('❌ Test failed:', error.message);
      process.exit(1);
    }
  }
}

async function main() {
  const test = new ConcurrentPerformanceTest();
  await test.run();
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = ConcurrentPerformanceTest;