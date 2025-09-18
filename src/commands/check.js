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
      console.log(`❌ Port ${port} is allocated`);
      if (result.allocated_to) {
        const allocation = result.allocated_to;
        console.log(`   Service: ${allocation.service_type}`);
        console.log(`   Name: ${allocation.service_name || 'unnamed'}`);
        console.log(`   Allocated: ${allocation.allocated_at}`);
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
