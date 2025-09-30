/**
 * Port allocation command
 */

const { daemonRequest } = require('../utils/daemon-client');
const { ErrorFactory } = require('../utils/enhanced-errors');

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
      if (!result.success) {
        process.exit(1);
      }
      return;
    }

    if (result.success) {
      // Feature #1: Handle singleton service reuse
      if (result.existing) {
        console.log(`ℹ️  Service '${options.service}' uses single-instance mode`);
        console.log(`↪  Connected to existing instance on port ${result.port}`);
        if (result.existingInstanceId) {
          console.log(`   Instance: ${result.existingInstanceId}`);
        }
        if (result.existingPid) {
          console.log(`   PID: ${result.existingPid}`);
        }
        console.log(`\n💡 Only one instance of this service is allowed across all sessions`);
      } else {
        console.log(`✅ ${result.message}`);
        console.log(`Lock ID: ${result.lock_id}`);
        console.log(`\nUse this port for your ${options.service} service: ${result.port}`);
      }
    } else {
      // Check if enhanced error format is available
      if (result.context && result.context.suggestions) {
        console.error(`❌ ${result.error}\n`);

        if (result.context.suggestions.length > 0) {
          console.error('💡 Suggestions:');
          result.context.suggestions.forEach(suggestion => {
            console.error(`   • ${suggestion}`);
          });
        }

        if (result.context.help_url) {
          console.error(`\n📖 More help: ${result.context.help_url}`);
        }
      } else {
        console.error(`❌ Allocation failed: ${result.error}`);
      }
      process.exit(1);
    }
  } catch (error) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: error.message }));
    } else {
      // Handle connection errors with enhanced messages
      if (error.code === 'ECONNREFUSED' || error.message.includes('ECONNREFUSED')) {
        const enhancedError = ErrorFactory.daemonUnavailable();
        console.error(enhancedError.toCLIMessage());
      } else {
        console.error(`❌ Error: ${error.message}`);
      }
    }
    process.exit(1);
  }
}

module.exports = allocate;
