/**
 * Port allocation command
 */

const { daemonRequest } = require('../utils/daemon-client');

async function allocate(options) {
  try {
    const response = await daemonRequest('/allocate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        service_type: options.service,
        service_name: options.name,
        preferred_port: options.port ? parseInt(options.port) : undefined,
        instance_id: process.env.CLAUDE_INSTANCE_ID || 'cli',
        project_path: options.project || process.cwd()
      })
    });

    const result = await response.json();

    if (options.json) {
      console.log(JSON.stringify(result));
      return;
    }

    if (result.success) {
      console.log(`✅ ${result.message}`);
      console.log(`Lock ID: ${result.lock_id}`);
      console.log(`\nUse this port for your ${options.service} service: ${result.port}`);
    } else {
      console.error(`❌ Allocation failed: ${result.error}`);
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

module.exports = allocate;
