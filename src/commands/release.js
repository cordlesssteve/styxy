/**
 * Release port allocation command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function release(lockId, options = {}) {
  try {
    const response = await daemonRequest(`/allocate/${lockId}`, {
      method: 'DELETE'
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
    } else {
      console.error(`❌ Release failed: ${result.error}`);
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

module.exports = release;