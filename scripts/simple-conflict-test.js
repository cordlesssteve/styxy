#!/usr/bin/env node
/**
 * Simple Port Conflict Test
 *
 * Tests sequential port conflicts with manageable load
 */

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

class SimpleConflictTest {
  constructor() {
    this.results = [];
    this.allocations = [];
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async allocatePort(service, preferredPort, name) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const cmd = `~/projects/Utility/styxy/bin/styxy allocate --service ${service} --port ${preferredPort} --name ${name} --json`;

      console.log(`🔄 Requesting ${service} service on port ${preferredPort} (${name})`);

      exec(cmd, { timeout: 30000 }, (error, stdout, stderr) => {
        const duration = Date.now() - startTime;

        if (error) {
          console.log(`❌ ${name}: Failed (${duration}ms) - ${error.message.split('\n')[0]}`);
          resolve({ success: false, error: error.message, duration, name });
        } else {
          try {
            const response = JSON.parse(stdout);
            if (response.success) {
              console.log(`✅ ${name}: Port ${response.port} allocated (${duration}ms)`);
              this.allocations.push({ lockId: response.lock_id, port: response.port, name });
              resolve({
                success: true,
                port: response.port,
                lockId: response.lock_id,
                duration,
                name
              });
            } else {
              console.log(`❌ ${name}: ${response.error} (${duration}ms)`);
              resolve({ success: false, error: response.error, duration, name });
            }
          } catch (parseError) {
            console.log(`❌ ${name}: Parse error (${duration}ms)`);
            resolve({ success: false, error: 'Parse error', duration, name });
          }
        }
      });
    });
  }

  async testScenario(scenarioName, service, preferredPort, count) {
    console.log(`\n🧪 Testing: ${scenarioName}`);
    console.log(`   ${count} ${service} services requesting port ${preferredPort}`);

    const results = [];

    for (let i = 0; i < count; i++) {
      const name = `${scenarioName}-${i + 1}`;
      const result = await this.allocatePort(service, preferredPort, name);
      results.push(result);

      // Small delay between requests
      if (i < count - 1) {
        await this.delay(500);
      }
    }

    const successful = results.filter(r => r.success);
    const ports = successful.map(r => r.port).sort((a, b) => a - b);

    console.log(`   📊 Results: ${successful.length}/${count} successful`);
    console.log(`   🎯 Allocated ports: [${ports.join(', ')}]`);

    // Check if ports are sequential starting from preferred port
    const isSequential = this.checkSequential(ports, preferredPort);
    console.log(`   ✅ Sequential allocation: ${isSequential ? 'PASS' : 'FAIL'}`);

    return { scenarioName, successful: successful.length, total: count, ports, isSequential, results };
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

  async runTests() {
    console.log('🚀 Starting Simple Port Conflict Tests');
    console.log('======================================');

    const scenarios = [
      { name: 'storybook-conflict', service: 'storybook', port: 6006, count: 3 },
      { name: 'dev-server-conflict', service: 'dev', port: 3000, count: 3 },
      { name: 'api-server-conflict', service: 'api', port: 8000, count: 3 }
    ];

    const scenarioResults = [];

    for (const scenario of scenarios) {
      const result = await this.testScenario(
        scenario.name,
        scenario.service,
        scenario.port,
        scenario.count
      );
      scenarioResults.push(result);

      await this.delay(1000); // Pause between scenarios
    }

    // Summary
    console.log('\n📊 TEST SUMMARY');
    console.log('================');

    const totalRequests = scenarioResults.reduce((sum, r) => sum + r.total, 0);
    const totalSuccessful = scenarioResults.reduce((sum, r) => sum + r.successful, 0);
    const allSequential = scenarioResults.every(r => r.isSequential);

    console.log(`🎯 Overall Results:`);
    console.log(`   Scenarios: ${scenarioResults.length}`);
    console.log(`   Total Requests: ${totalRequests}`);
    console.log(`   Successful: ${totalSuccessful}/${totalRequests} (${((totalSuccessful/totalRequests)*100).toFixed(1)}%)`);
    console.log(`   Sequential Allocation: ${allSequential ? '✅ PASS' : '❌ FAIL'}`);

    scenarioResults.forEach(result => {
      console.log(`\n   ${result.scenarioName}:`);
      console.log(`     Success Rate: ${result.successful}/${result.total}`);
      console.log(`     Ports: [${result.ports.join(', ')}]`);
      console.log(`     Sequential: ${result.isSequential ? '✅' : '❌'}`);
    });

    if (allSequential && totalSuccessful === totalRequests) {
      console.log(`\n🎉 SUCCESS: Port coordination working perfectly!`);
      console.log(`   ✅ All requests handled correctly`);
      console.log(`   ✅ Sequential allocation working`);
      console.log(`   ✅ No conflicts detected`);
    } else {
      console.log(`\n⚠️  Issues detected in port coordination`);
    }

    console.log(`\n🧹 Allocated ${this.allocations.length} ports for testing`);
    console.log(`   Run with --cleanup to release them`);
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test allocations...');

    for (const allocation of this.allocations) {
      try {
        await new Promise((resolve) => {
          exec(`~/projects/Utility/styxy/bin/styxy release ${allocation.lockId}`, { timeout: 15000 }, (error) => {
            if (!error) {
              console.log(`   ✅ Released ${allocation.name} (port ${allocation.port})`);
            } else {
              console.log(`   ❌ Failed to release ${allocation.name}`);
            }
            resolve();
          });
        });
        await this.delay(200);
      } catch (error) {
        console.log(`   ❌ Error releasing ${allocation.name}`);
      }
    }

    console.log(`🎉 Cleanup complete!`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const test = new SimpleConflictTest();

  if (args.includes('--cleanup')) {
    // Just run cleanup
    await test.cleanup();
  } else {
    await test.runTests();

    if (args.includes('--auto-cleanup')) {
      await test.cleanup();
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = SimpleConflictTest;