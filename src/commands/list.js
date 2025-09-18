/**
 * List allocations command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function list(options = {}) {
  try {
    const response = await daemonRequest('/allocations');
    const result = await response.json();

    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (result.allocations.length === 0) {
      console.log('No active port allocations');
      return;
    }

    console.log('\nActive Port Allocations:');
    console.log('=' .repeat(50));

    result.allocations.forEach(allocation => {
      console.log(`Port ${allocation.port}: ${allocation.service_type}`);

      if (options.verbose) {
        console.log(`  Service Name: ${allocation.service_name || 'unnamed'}`);
        console.log(`  Lock ID: ${allocation.lock_id}`);
        console.log(`  Instance: ${allocation.instance_id || 'unknown'}`);
        console.log(`  Allocated: ${allocation.allocated_at}`);
        if (allocation.project_path) {
          console.log(`  Project: ${allocation.project_path}`);
        }
        console.log('');
      }
    });

    if (!options.verbose) {
      console.log(`\nTotal: ${result.allocations.length} allocations (use -v for details)`);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = list;
