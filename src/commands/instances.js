/**
 * List instances command
 */

async function instances() {
  try {
    const response = await fetch('http://127.0.0.1:9876/instance/list');
    const result = await response.json();

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
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Styxy daemon is not running. Start it with: styxy daemon start');
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = instances;