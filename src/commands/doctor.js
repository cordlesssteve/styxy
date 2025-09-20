/**
 * Health check and diagnostic command
 *
 * Performs comprehensive system health check and provides
 * diagnostic information and troubleshooting guidance.
 */

const { daemonRequest } = require('../utils/daemon-client');
const { ErrorFactory } = require('../utils/enhanced-errors');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

async function doctor(options = {}) {
  console.log('🩺 Styxy Health Check\n');

  const checks = {
    daemon: await checkDaemon(),
    configuration: await checkConfiguration(),
    ports: await checkPorts(),
    system: await checkSystem(),
    resources: await checkResources()
  };

  // Print results
  Object.entries(checks).forEach(([checkName, result]) => {
    printCheckResult(checkName, result);
  });

  // Overall status
  const overallStatus = determineOverallStatus(checks);
  printOverallStatus(overallStatus);

  // Recommendations
  printRecommendations(checks);

  if (options.json) {
    console.log('\n' + JSON.stringify({
      status: overallStatus,
      checks,
      timestamp: new Date().toISOString()
    }, null, 2));
  }

  // Exit with appropriate code
  process.exit(overallStatus === 'healthy' ? 0 : 1);
}

async function checkDaemon() {
  try {
    const response = await daemonRequest('/health');
    const health = await response.json();

    return {
      status: 'healthy',
      message: 'Daemon is running and responsive',
      details: {
        uptime: health.uptime,
        allocations: health.components?.daemon?.allocations || 0,
        instances: health.components?.daemon?.instances || 0,
        memory_mb: Math.round(health.components?.daemon?.memory?.heapUsed / 1024 / 1024) || 0
      }
    };
  } catch (error) {
    return {
      status: 'error',
      message: 'Daemon is not responding',
      details: {
        error: error.message,
        suggestions: [
          'Start daemon with: styxy daemon start',
          'Check if port 9876 is available',
          'Review daemon logs for errors'
        ]
      }
    };
  }
}

async function checkConfiguration() {
  try {
    const configDir = path.join(process.env.HOME, '.styxy');
    const configFile = path.join(configDir, 'config.json');

    if (!fs.existsSync(configDir)) {
      return {
        status: 'warning',
        message: 'Configuration directory does not exist',
        details: {
          path: configDir,
          suggestions: ['Run styxy daemon start to initialize configuration']
        }
      };
    }

    let config = {};
    if (fs.existsSync(configFile)) {
      config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    }

    // Try to get service types from daemon
    try {
      const response = await daemonRequest('/config');
      const daemonConfig = await response.json();

      return {
        status: 'healthy',
        message: 'Configuration loaded successfully',
        details: {
          service_types: Object.keys(daemonConfig.service_types || {}).length,
          config_source: daemonConfig.compliance?.source || 'Unknown',
          auth_enabled: !!config.api_key
        }
      };
    } catch (error) {
      return {
        status: 'warning',
        message: 'Configuration exists but daemon not accessible',
        details: {
          config_file_exists: fs.existsSync(configFile),
          suggestions: ['Start daemon to verify configuration']
        }
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: 'Configuration check failed',
      details: {
        error: error.message,
        suggestions: ['Check file permissions', 'Reinitialize with styxy daemon start']
      }
    };
  }
}

async function checkPorts() {
  try {
    // Check if daemon port is available
    const daemonPort = 9876;
    let daemonPortCheck = {};

    try {
      const response = await daemonRequest('/status');
      const status = await response.json();
      daemonPortCheck = {
        port: daemonPort,
        status: 'in_use_by_styxy',
        uptime: status.uptime
      };
    } catch (error) {
      // Check if port is in use by something else
      try {
        const { stdout } = await execAsync(`lsof -i :${daemonPort} -t`);
        daemonPortCheck = {
          port: daemonPort,
          status: 'in_use_by_other',
          pid: stdout.trim()
        };
      } catch (lsofError) {
        daemonPortCheck = {
          port: daemonPort,
          status: 'available',
          message: 'Port available for daemon'
        };
      }
    }

    // Check current allocations if daemon is running
    let allocations = [];
    try {
      const response = await daemonRequest('/allocations');
      const result = await response.json();
      allocations = result.allocations || [];
    } catch (error) {
      // Daemon not running
    }

    return {
      status: 'healthy',
      message: `Port health check complete`,
      details: {
        daemon_port: daemonPortCheck,
        active_allocations: allocations.length,
        allocations: allocations.slice(0, 5) // Show first 5
      }
    };
  } catch (error) {
    return {
      status: 'warning',
      message: 'Port check partially failed',
      details: {
        error: error.message,
        suggestions: ['Install lsof for better port diagnostics']
      }
    };
  }
}

async function checkSystem() {
  try {
    const checks = {};

    // Check Node.js version
    checks.node_version = process.version;

    // Check if required tools are available
    const tools = ['lsof', 'netstat', 'ss'];
    checks.port_tools = {};

    for (const tool of tools) {
      try {
        await execAsync(`which ${tool}`);
        checks.port_tools[tool] = 'available';
      } catch (error) {
        checks.port_tools[tool] = 'missing';
      }
    }

    // Check filesystem permissions
    const configDir = path.join(process.env.HOME, '.styxy');
    try {
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      const testFile = path.join(configDir, '.test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      checks.filesystem_permissions = 'ok';
    } catch (error) {
      checks.filesystem_permissions = 'error';
    }

    const missingTools = Object.entries(checks.port_tools)
      .filter(([tool, status]) => status === 'missing')
      .map(([tool]) => tool);

    return {
      status: missingTools.length > 0 ? 'warning' : 'healthy',
      message: missingTools.length > 0
        ? `System tools partially available (missing: ${missingTools.join(', ')})`
        : 'System tools and permissions OK',
      details: checks
    };
  } catch (error) {
    return {
      status: 'error',
      message: 'System check failed',
      details: {
        error: error.message
      }
    };
  }
}

async function checkResources() {
  try {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      status: 'healthy',
      message: 'Resource usage normal',
      details: {
        memory: {
          heap_used_mb: Math.round(memUsage.heapUsed / 1024 / 1024),
          heap_total_mb: Math.round(memUsage.heapTotal / 1024 / 1024),
          external_mb: Math.round(memUsage.external / 1024 / 1024)
        },
        uptime_seconds: Math.round(process.uptime())
      }
    };
  } catch (error) {
    return {
      status: 'warning',
      message: 'Could not check resource usage',
      details: { error: error.message }
    };
  }
}

function printCheckResult(name, result) {
  const icon = {
    'healthy': '✅',
    'warning': '⚠️',
    'error': '❌'
  }[result.status] || '❓';

  console.log(`${icon} ${name.toUpperCase()}: ${result.message}`);

  if (result.details && result.details.suggestions) {
    console.log('   💡 Suggestions:');
    result.details.suggestions.forEach(suggestion => {
      console.log(`      • ${suggestion}`);
    });
  }

  console.log('');
}

function determineOverallStatus(checks) {
  const statuses = Object.values(checks).map(check => check.status);

  if (statuses.includes('error')) return 'error';
  if (statuses.includes('warning')) return 'warning';
  return 'healthy';
}

function printOverallStatus(status) {
  const statusMessages = {
    'healthy': '🎉 Overall Status: HEALTHY - Styxy is ready for development',
    'warning': '⚠️  Overall Status: WARNING - Some issues detected but Styxy should work',
    'error': '🚨 Overall Status: ERROR - Critical issues detected, may not function properly'
  };

  console.log('═'.repeat(60));
  console.log(statusMessages[status] || '❓ Overall Status: UNKNOWN');
  console.log('═'.repeat(60));
}

function printRecommendations(checks) {
  console.log('\n🔧 Recommendations:\n');

  const allSuggestions = [];

  Object.entries(checks).forEach(([checkName, result]) => {
    if (result.details && result.details.suggestions) {
      result.details.suggestions.forEach(suggestion => {
        allSuggestions.push(`${checkName}: ${suggestion}`);
      });
    }
  });

  if (allSuggestions.length === 0) {
    console.log('   No issues detected! Styxy is ready for development.');
  } else {
    allSuggestions.forEach((suggestion, index) => {
      console.log(`   ${index + 1}. ${suggestion}`);
    });
  }

  console.log('\n📖 For more help: https://docs.styxy.io/troubleshooting');
}

module.exports = doctor;