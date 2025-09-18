/**
 * Port availability check command
 */

async function check(port) {
  try {
    const response = await fetch(`http://127.0.0.1:9876/check/${port}`);
    const result = await response.json();
    
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
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Styxy daemon is not running. Start it with: styxy daemon start');
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = check;
