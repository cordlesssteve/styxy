/**
 * Port scan command
 */

async function scan(options) {
  try {
    const startPort = options.start || 3000;
    const endPort = options.end || 9999;

    console.log(`🔍 Scanning ports ${startPort}-${endPort} for usage...`);

    const response = await fetch(`http://127.0.0.1:9876/scan?start=${startPort}&end=${endPort}`);
    const result = await response.json();

    if (result.ports_in_use.length === 0) {
      console.log(`✅ No ports in use in range ${result.scan_range}`);
      return;
    }

    console.log(`\n📊 Ports in Use (${result.scan_range}):`);
    console.log('=' .repeat(60));

    result.ports_in_use.forEach(portInfo => {
      console.log(`\n🔌 Port ${portInfo.port}:`);

      if (portInfo.allocated_to) {
        // Styxy allocation
        const allocation = portInfo.allocated_to;
        console.log(`   📋 Styxy: ${allocation.service_type} - ${allocation.service_name || 'unnamed'}`);
        console.log(`      Allocated: ${new Date(allocation.allocated_at).toLocaleString()}`);
        console.log(`      Lock ID: ${allocation.lock_id}`);
      } else if (portInfo.system_usage) {
        // System process
        const usage = portInfo.system_usage;
        console.log(`   🖥️  System: ${usage.process?.name || 'Unknown process'}`);
        if (usage.process?.pid) {
          console.log(`      PID: ${usage.process.pid}`);
        }
        console.log(`      Protocol: ${usage.protocol || 'unknown'}`);
        console.log(`      Address: ${usage.local_address || 'unknown'}`);
        console.log(`      Detected by: ${usage.tool}`);
      } else {
        console.log(`   ❓ Status: In use (details unavailable)`);
      }
    });

    console.log(`\n📈 Summary: ${result.ports_in_use.length} ports in use in range ${result.scan_range}`);

    // Show breakdown
    const styxyPorts = result.ports_in_use.filter(p => p.allocated_to).length;
    const systemPorts = result.ports_in_use.filter(p => p.system_usage).length;

    if (styxyPorts > 0) {
      console.log(`   📋 Styxy managed: ${styxyPorts}`);
    }
    if (systemPorts > 0) {
      console.log(`   🖥️  System processes: ${systemPorts}`);
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

module.exports = scan;