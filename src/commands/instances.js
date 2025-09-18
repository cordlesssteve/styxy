/**
 * List instances command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function instances(options = {}) {
  try {
    const response = await daemonRequest('/instance/list');
    const result = await response.json();

    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (result.instances && result.instances.length === 0) {
      console.log('No active instances registered');
      return;
    }

    console.log('\nActive Styxy Instances:');
    console.log('='.repeat(50));

    result.instances.forEach(instance => {
      console.log(`Instance: ${instance.instance_id}`);
      console.log(`  Directory: ${instance.working_directory || 'unknown'}`);
      console.log(`  Allocations: ${instance.active_allocations ? instance.active_allocations.length : 0}`);
      console.log(`  Last seen: ${instance.last_heartbeat || 'never'}`);
      console.log('');
    });

    console.log(`Total: ${result.instances.length} active instances`);
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = instances;