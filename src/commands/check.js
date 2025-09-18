/**
 * Port availability check command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function check(port, options = {}) {
  try {
    const response = await daemonRequest(`/check/${port}`);
    const result = await response.json();

    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (result.available) {
      console.log(`✅ Port ${port} is available`);
    } else {
      console.log(`❌ Port ${port} is in use`);

      // Show Styxy allocation if exists
      if (result.allocated_to) {
        const allocation = result.allocated_to;
        console.log(`\n   📋 Styxy Allocation:`);
        console.log(`      Service: ${allocation.service_type}`);
        console.log(`      Name: ${allocation.service_name || 'unnamed'}`);
        console.log(`      Allocated: ${allocation.allocated_at}`);
        console.log(`      Lock ID: ${allocation.lock_id}`);
      }

      // Show system usage if detected
      if (result.system_usage) {
        const usage = result.system_usage;
        console.log(`\n   🖥️  System Usage:`);
        console.log(`      Protocol: ${usage.protocol || 'unknown'}`);
        if (usage.process && usage.process.name) {
          console.log(`      Process: ${usage.process.name}`);
        }
        if (usage.process && usage.process.pid) {
          console.log(`      PID: ${usage.process.pid}`);
        }
        console.log(`      Detected by: ${usage.tool}`);
        if (usage.local_address) {
          console.log(`      Address: ${usage.local_address}`);
        }
      }
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

module.exports = check;
