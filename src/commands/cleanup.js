/**
 * Cleanup stale allocations command
 */

async function cleanup(options) {
  try {
    const response = await fetch('http://127.0.0.1:9876/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        force: options.force || false
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ ${result.message}`);
      if (result.cleaned > 0) {
        console.log(`Cleaned up ${result.cleaned} stale allocations`);
      } else {
        console.log('No stale allocations found');
      }
    } else {
      console.error(`❌ Cleanup failed: ${result.error}`);
      process.exit(1);
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

module.exports = cleanup;