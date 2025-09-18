/**
 * Release port allocation command
 */

async function release(lockId) {
  try {
    const response = await fetch(`http://127.0.0.1:9876/allocate/${lockId}`, {
      method: 'DELETE'
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ ${result.message}`);
    } else {
      console.error(`❌ Release failed: ${result.error}`);
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

module.exports = release;