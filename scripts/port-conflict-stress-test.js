#!/usr/bin/env node
/**
 * Styxy Port Conflict Stress Test
 *
 * Tests concurrent port requests where multiple tools request the same preferred ports
 * Scenarios:
 * - 4 Storybook instances all requesting port 6006
 * - 4 Playwright instances all requesting port 9200
 * - 4 Cypress instances all requesting port 9200
 * - 4 Dev servers all requesting port 3000
 * - 5 API servers all requesting port 8000
 */

const { spawn, exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class PortConflictStressTest {
  constructor() {
    this.results = [];
    this.allocations = [];
    this.testStartTime = new Date();
    this.authToken = this.loadAuthToken();
    this.baseUrl = 'http://localhost:9876';
  }

  loadAuthToken() {
    try {
      const tokenPath = path.join(process.env.HOME, '.styxy', 'auth.token');
      return fs.readFileSync(tokenPath, 'utf8').trim();
    } catch (error) {
      console.error('❌ Failed to load auth token:', error.message);
      console.log('💡 Ensure styxy daemon is running and auth token exists');
      process.exit(1);
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async makeAllocationRequest(service, preferredPort, name, instanceId) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const cmd = `~/projects/Utility/styxy/bin/styxy allocate --service ${service} --port ${preferredPort} --name ${name} --json`;

      exec(cmd, {
        timeout: 60000, // Increase timeout to 60 seconds
        env: {
          ...process.env,
          STYXY_INSTANCE_ID: instanceId
        }
      }, (error, stdout, stderr) => {
        const endTime = Date.now();
        const duration = endTime - startTime;

        let result = {
          service,
          preferredPort,
          name,
          instanceId,
          requestTime: startTime,
          duration,
          success: false,
          allocatedPort: null,
          lockId: null,
          error: null
        };

        if (error) {
          result.error = error.message;
          console.log(`❌ ${name}: Failed (${duration}ms) - ${error.message.substring(0, 100)}`);
        } else {
          try {
            const response = JSON.parse(stdout);
            if (response.success) {
              result.success = true;
              result.allocatedPort = response.port;
              result.lockId = response.lock_id;
              console.log(`✅ ${name}: Port ${response.port} allocated (${duration}ms)`);
            } else {
              result.error = response.error;
              console.log(`❌ ${name}: Failed (${duration}ms) - ${response.error}`);
            }
          } catch (parseError) {
            result.error = `Parse error: ${parseError.message}`;
            console.log(`❌ ${name}: Parse error (${duration}ms)`);
          }
        }

        resolve(result);
      });
    });
  }

  async runConflictScenario(scenarioName, service, preferredPort, instanceCount) {
    console.log(`\n🧪 Starting scenario: ${scenarioName}`);
    console.log(`   Service: ${service}, Preferred Port: ${preferredPort}, Instances: ${instanceCount}`);
    console.log(`   Expected: First gets ${preferredPort}, others get sequential ports`);

    const requests = [];
    const startTime = Date.now();

    // Launch all requests simultaneously
    for (let i = 0; i < instanceCount; i++) {
      const name = `${scenarioName}-${i + 1}`;
      const instanceId = `stress-test-${scenarioName}-${i + 1}`;

      requests.push(this.makeAllocationRequest(service, preferredPort, name, instanceId));

      // Small delay to create realistic timing but still test concurrency
      if (i < instanceCount - 1) {
        await this.delay(200); // 200ms between launches to reduce system load
      }
    }

    // Wait for all requests to complete
    const results = await Promise.all(requests);
    const endTime = Date.now();

    console.log(`   ⏱️  Scenario completed in ${endTime - startTime}ms`);

    // Analyze results
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    const allocatedPorts = successful.map(r => r.allocatedPort).sort((a, b) => a - b);

    console.log(`   📊 Results: ${successful.length} successful, ${failed.length} failed`);
    console.log(`   🎯 Allocated ports: [${allocatedPorts.join(', ')}]`);

    // Verify sequential allocation
    const isSequential = this.verifySequentialAllocation(allocatedPorts, preferredPort);
    console.log(`   ✅ Sequential allocation: ${isSequential ? 'PASS' : 'FAIL'}`);

    // Store results
    this.results.push({
      scenario: scenarioName,
      service,
      preferredPort,
      instanceCount,
      successful: successful.length,
      failed: failed.length,
      allocatedPorts,
      isSequential,
      totalTime: endTime - startTime,
      results
    });

    // Store allocations for cleanup
    this.allocations.push(...successful.map(r => ({ lockId: r.lockId, port: r.allocatedPort, name: r.name })));

    return results;
  }

  verifySequentialAllocation(ports, startPort) {
    if (ports.length === 0) return true;

    for (let i = 0; i < ports.length; i++) {
      if (ports[i] !== startPort + i) {
        return false;
      }
    }
    return true;
  }

  async runAllScenarios() {
    console.log('🚀 Starting Styxy Port Conflict Stress Tests');
    console.log('================================================');

    const scenarios = [
      {
        name: 'storybook-conflict',
        service: 'storybook',
        preferredPort: 6006,
        instances: 4,
        description: '4 Storybook instances all requesting port 6006'
      },
      {
        name: 'playwright-conflict',
        service: 'test',
        preferredPort: 9200,
        instances: 4,
        description: '4 Playwright instances all requesting port 9200'
      },
      {
        name: 'cypress-conflict',
        service: 'test',
        preferredPort: 9200,
        instances: 4,
        description: '4 Cypress instances all requesting port 9200'
      },
      {
        name: 'dev-server-conflict',
        service: 'dev',
        preferredPort: 3000,
        instances: 4,
        description: '4 Dev servers all requesting port 3000'
      },
      {
        name: 'api-server-conflict',
        service: 'api',
        preferredPort: 8000,
        instances: 5,
        description: '5 API servers all requesting port 8000'
      }
    ];

    for (const scenario of scenarios) {
      console.log(`\n📋 ${scenario.description}`);
      await this.runConflictScenario(
        scenario.name,
        scenario.service,
        scenario.preferredPort,
        scenario.instances
      );

      // Brief pause between scenarios
      await this.delay(1000);
    }
  }

  async generateReport() {
    console.log('\n📊 STRESS TEST SUMMARY REPORT');
    console.log('================================================');

    const totalScenarios = this.results.length;
    const totalRequests = this.results.reduce((sum, r) => sum + r.instanceCount, 0);
    const totalSuccessful = this.results.reduce((sum, r) => sum + r.successful, 0);
    const totalFailed = this.results.reduce((sum, r) => sum + r.failed, 0);
    const allSequential = this.results.every(r => r.isSequential);

    console.log(`🎯 Test Overview:`);
    console.log(`   Scenarios: ${totalScenarios}`);
    console.log(`   Total Requests: ${totalRequests}`);
    console.log(`   Successful: ${totalSuccessful} (${((totalSuccessful/totalRequests)*100).toFixed(1)}%)`);
    console.log(`   Failed: ${totalFailed} (${((totalFailed/totalRequests)*100).toFixed(1)}%)`);
    console.log(`   Sequential Allocation: ${allSequential ? '✅ PASS' : '❌ FAIL'}`);

    console.log(`\n📈 Per-Scenario Results:`);
    this.results.forEach(result => {
      console.log(`   ${result.scenario}:`);
      console.log(`     ✓ ${result.successful}/${result.instanceCount} successful`);
      console.log(`     ⏱️  ${result.totalTime}ms total time`);
      console.log(`     🎯 Ports: [${result.allocatedPorts.join(', ')}]`);
      console.log(`     ✅ Sequential: ${result.isSequential ? 'PASS' : 'FAIL'}`);
    });

    console.log(`\n💡 Port Coordination Analysis:`);
    if (allSequential && totalFailed === 0) {
      console.log(`   ✅ Perfect coordination: All requests handled correctly`);
      console.log(`   ✅ No conflicts: Sequential allocation working properly`);
      console.log(`   ✅ System stability: All concurrent requests succeeded`);
    } else {
      console.log(`   ⚠️  Issues detected in port coordination`);
      if (!allSequential) {
        console.log(`   ❌ Non-sequential allocation in some scenarios`);
      }
      if (totalFailed > 0) {
        console.log(`   ❌ ${totalFailed} requests failed`);
      }
    }

    console.log(`\n🧹 Active Allocations: ${this.allocations.length} ports allocated`);
    console.log(`   Use cleanup option to release all test allocations`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up stress test allocations...');

    let cleaned = 0;
    for (const allocation of this.allocations) {
      try {
        await new Promise((resolve) => {
          exec(`~/projects/Utility/styxy/bin/styxy release ${allocation.lockId}`, (error, stdout, stderr) => {
            if (!error) {
              console.log(`   ✅ Released ${allocation.name} (port ${allocation.port})`);
              cleaned++;
            } else {
              console.log(`   ❌ Failed to release ${allocation.name}: ${error.message}`);
            }
            resolve();
          });
        });

        await this.delay(100); // Small delay between releases
      } catch (error) {
        console.log(`   ❌ Error releasing ${allocation.name}: ${error.message}`);
      }
    }

    console.log(`🎉 Cleanup complete: ${cleaned}/${this.allocations.length} allocations released`);
  }

  async run() {
    try {
      await this.runAllScenarios();
      await this.generateReport();

      // Ask if user wants to cleanup
      console.log('\n❓ Run cleanup? (releases all test allocations)');
      console.log('   To cleanup: node port-conflict-stress-test.js --cleanup');

    } catch (error) {
      console.error('💥 Stress test failed:', error);
      process.exit(1);
    }
  }

  async runCleanupOnly() {
    // Read existing allocations from daemon
    try {
      const allocations = await new Promise((resolve, reject) => {
        exec(`curl -s -H "Authorization: Bearer ${this.authToken}" ${this.baseUrl}/allocations`, (error, stdout) => {
          if (error) {
            reject(error);
          } else {
            try {
              const response = JSON.parse(stdout);
              resolve(response.allocations || []);
            } catch (parseError) {
              reject(parseError);
            }
          }
        });
      });

      const stressTestAllocations = allocations.filter(alloc =>
        alloc.serviceName && alloc.serviceName.includes('stress-test') ||
        alloc.serviceName && alloc.serviceName.includes('storybook-conflict') ||
        alloc.serviceName && alloc.serviceName.includes('playwright-conflict') ||
        alloc.serviceName && alloc.serviceName.includes('cypress-conflict') ||
        alloc.serviceName && alloc.serviceName.includes('dev-server-conflict') ||
        alloc.serviceName && alloc.serviceName.includes('api-server-conflict')
      );

      console.log(`\n🧹 Found ${stressTestAllocations.length} stress test allocations to clean up`);

      for (const allocation of stressTestAllocations) {
        try {
          await new Promise((resolve) => {
            exec(`~/projects/Utility/styxy/bin/styxy release ${allocation.lockId}`, (error) => {
              if (!error) {
                console.log(`   ✅ Released ${allocation.serviceName} (port ${allocation.port})`);
              } else {
                console.log(`   ❌ Failed to release ${allocation.serviceName}: ${error.message}`);
              }
              resolve();
            });
          });
          await this.delay(100);
        } catch (error) {
          console.log(`   ❌ Error releasing allocation: ${error.message}`);
        }
      }

      console.log(`🎉 Cleanup complete!`);

    } catch (error) {
      console.error('❌ Cleanup failed:', error.message);
    }
  }
}

// Main execution
async function main() {
  const args = process.argv.slice(2);
  const test = new PortConflictStressTest();

  if (args.includes('--cleanup')) {
    await test.runCleanupOnly();
  } else {
    await test.run();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = PortConflictStressTest;