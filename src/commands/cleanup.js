/**
 * Cleanup stale allocations command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function cleanup(options = {}) {
  try {
    const response = await daemonRequest('/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        force: options.force || false
      })
    });

    const result = await response.json();

    if (options.json) {
      console.log(JSON.stringify(result));
      if (!result.success) {
        process.exit(1);
      }
      return;
    }

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
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

module.exports = cleanup;