/**
 * Configuration management commands
 */

const fs = require('fs');
const path = require('path');

async function config(action, options) {
  switch (action) {
    case 'show':
      return showConfig(options);
    case 'validate':
      return validateConfig(options);
    case 'generate':
      return generateUserConfig(options);
    case 'instances':
      return showInstanceTemplates(options);
    case 'auto-allocation':
      return manageAutoAllocation(options);
    default:
      console.error(`Unknown config action: ${action}`);
      console.log('Available actions: show, validate, generate, instances, auto-allocation');
      process.exit(1);
  }
}

async function showConfig(options) {
  try {
    const response = await fetch('http://127.0.0.1:9876/config');
    const result = await response.json();

    console.log('\n🔧 Current Styxy Configuration:');
    console.log('=' .repeat(50));

    Object.entries(result.service_types).forEach(([serviceType, config]) => {
      console.log(`\n${serviceType.toUpperCase()}:`);
      console.log(`  Description: ${config.description || 'No description'}`);
      console.log(`  Preferred Ports: ${config.preferred_ports.join(', ')}`);
      console.log(`  Range: ${config.range[0]}-${config.range[1]}`);
      if (config.examples) {
        console.log(`  Examples: ${config.examples.join(', ')}`);
      }
    });

    console.log(`\nTotal service types: ${Object.keys(result.service_types).length}`);
    console.log('Configuration source: CORE Documentation Standard');
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Styxy daemon is not running. Start it with: styxy daemon start');
    } else {
      console.error(`❌ Error: ${error.message}`);
    }
    process.exit(1);
  }
}

async function validateConfig(options) {
  console.log('🔍 Validating port configuration against CORE standards...');

  const coreConfigFile = path.join(__dirname, '../../config/core-ports.json');

  if (!fs.existsSync(coreConfigFile)) {
    console.error('❌ CORE configuration file not found');
    return;
  }

  try {
    const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));

    console.log('✅ Configuration is valid');
    console.log(`📋 Compliance version: ${coreConfig.compliance.version}`);
    console.log(`📚 Based on: ${coreConfig._meta.source}`);

    // Validate ranges don't overlap
    const ranges = [];
    Object.entries(coreConfig.service_types).forEach(([serviceType, config]) => {
      ranges.push({
        service: serviceType,
        start: config.port_range[0],
        end: config.port_range[1]
      });
    });

    // Check for overlaps
    let hasOverlaps = false;
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        if (a.start <= b.end && b.start <= a.end) {
          console.warn(`⚠️  Port range overlap: ${a.service} (${a.start}-${a.end}) overlaps with ${b.service} (${b.start}-${b.end})`);
          hasOverlaps = true;
        }
      }
    }

    if (!hasOverlaps) {
      console.log('✅ No port range overlaps detected');
    }

  } catch (error) {
    console.error('❌ Configuration validation failed:', error.message);
  }
}

async function generateUserConfig(options) {
  const configDir = path.join(process.env.HOME, '.styxy');
  const configFile = path.join(configDir, 'config.json');

  if (fs.existsSync(configFile) && !options.force) {
    console.log('❌ User configuration already exists. Use --force to overwrite.');
    return;
  }

  const userConfig = {
    "_comment": "User configuration overrides for Styxy",
    "_generated": new Date().toISOString(),
    "service_types": {
      "custom": {
        "description": "Custom service example",
        "preferred_ports": [7000],
        "range": [7000, 7099]
      }
    },
    "daemon": {
      "listen_port": 9876,
      "log_level": "info",
      "cleanup_interval": 30
    }
  };

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    fs.writeFileSync(configFile, JSON.stringify(userConfig, null, 2));
    console.log(`✅ Generated user configuration: ${configFile}`);
    console.log('📝 Edit this file to add your custom service types');
  } catch (error) {
    console.error('❌ Failed to generate configuration:', error.message);
  }
}

async function showInstanceTemplates(options) {
  const coreConfigFile = path.join(__dirname, '../../config/core-ports.json');

  if (!fs.existsSync(coreConfigFile)) {
    console.error('❌ CORE configuration file not found');
    return;
  }

  try {
    const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));

    console.log('\n🏗️  Instance Templates:');
    console.log('=' .repeat(50));

    Object.entries(coreConfig.instance_templates).forEach(([instanceName, template]) => {
      console.log(`\n${instanceName.toUpperCase()} Instance:`);
      console.log(`  Description: ${template.description}`);
      console.log('  Port Assignments:');

      Object.entries(template.port_offsets).forEach(([service, offset]) => {
        const serviceConfig = coreConfig.service_types[service];
        if (serviceConfig) {
          const basePort = serviceConfig.preferred_ports[0];
          const assignedPort = basePort + offset;
          console.log(`    ${service}: ${assignedPort} (${basePort} + ${offset})`);
        }
      });
    });

    console.log('\n💡 Example usage:');
    console.log('  styxy allocate --service dev --instance main    # Gets port 3000');
    console.log('  styxy allocate --service dev --instance dev     # Gets port 3001');
    console.log('  styxy allocate --service dev --instance staging # Gets port 3002');
  } catch (error) {
    console.error('❌ Failed to load instance templates:', error.message);
  }
}

/**
 * Manage auto-allocation feature (Feature #2)
 */
async function manageAutoAllocation(options) {
  const subcommand = options.subcommand || 'status';
  const configDir = path.join(process.env.HOME, '.styxy');
  const userConfigFile = path.join(configDir, 'config.json');
  const ConfigWriter = require('../utils/config-writer');
  const AuditLogger = require('../utils/audit-logger');

  const configWriter = new ConfigWriter(configDir);
  const auditLogger = new AuditLogger(configDir);

  switch (subcommand) {
    case 'status':
      return showAutoAllocationStatus(userConfigFile, configWriter, auditLogger);
    case 'enable':
      return setAutoAllocationEnabled(userConfigFile, true);
    case 'disable':
      return setAutoAllocationEnabled(userConfigFile, false);
    case 'undo':
      return undoAutoAllocation(options.serviceType, configWriter, auditLogger);
    case 'list':
      return listAutoAllocatedServices(configWriter);
    default:
      console.error(`Unknown auto-allocation subcommand: ${subcommand}`);
      console.log('Available subcommands: status, enable, disable, undo, list');
      process.exit(1);
  }
}

/**
 * Show auto-allocation status
 */
async function showAutoAllocationStatus(userConfigFile, configWriter, auditLogger) {
  console.log('\n🔧 Auto-Allocation Status');
  console.log('='.repeat(50));

  // Load configuration
  const coreConfigFile = path.join(__dirname, '../../config/core-ports.json');
  let config = { auto_allocation: { enabled: false } };

  if (fs.existsSync(userConfigFile)) {
    const userConfig = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
    config = { ...config, ...userConfig };
  } else if (fs.existsSync(coreConfigFile)) {
    const coreConfig = JSON.parse(fs.readFileSync(coreConfigFile, 'utf8'));
    config = { ...config, ...coreConfig };
  }

  const autoConfig = config.auto_allocation || {};

  console.log(`\n📊 Status: ${autoConfig.enabled ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   Default chunk size: ${autoConfig.default_chunk_size || 10} ports`);
  console.log(`   Placement strategy: ${autoConfig.placement || 'after'}`);
  console.log(`   Port range: ${autoConfig.min_port || 10000}-${autoConfig.max_port || 65000}`);
  console.log(`   Preserve gaps: ${autoConfig.preserve_gaps ? 'Yes' : 'No'} (${autoConfig.gap_size || 10} ports)`);

  // Show auto-allocated services
  const autoAllocated = configWriter.getAutoAllocatedServiceTypes();
  console.log(`\n📦 Auto-allocated services: ${autoAllocated.length}`);

  if (autoAllocated.length > 0) {
    autoAllocated.forEach(service => {
      console.log(`   • ${service.name}: ${service.range[0]}-${service.range[1]} (${service.allocatedAt})`);
    });
  } else {
    console.log('   No services have been auto-allocated yet');
  }

  // Show recent auto-allocation events from audit log
  const recentAllocations = auditLogger.getAuditsByAction('AUTO_ALLOCATION', 5);
  if (recentAllocations.length > 0) {
    console.log(`\n📋 Recent auto-allocation events:`);
    recentAllocations.forEach(event => {
      const date = new Date(event.timestamp).toLocaleString();
      console.log(`   • ${event.serviceType}: ${event.range[0]}-${event.range[1]} (${date})`);
    });
  }

  // Show statistics
  const stats = auditLogger.getStatistics();
  if (stats.byAction && stats.byAction.AUTO_ALLOCATION) {
    console.log(`\n📈 Total auto-allocations: ${stats.byAction.AUTO_ALLOCATION}`);
  }

  console.log();
}

/**
 * Enable or disable auto-allocation
 */
async function setAutoAllocationEnabled(userConfigFile, enabled) {
  const configDir = path.dirname(userConfigFile);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  let config = { auto_allocation: {} };

  if (fs.existsSync(userConfigFile)) {
    config = JSON.parse(fs.readFileSync(userConfigFile, 'utf8'));
  }

  if (!config.auto_allocation) {
    config.auto_allocation = {};
  }

  config.auto_allocation.enabled = enabled;

  fs.writeFileSync(userConfigFile, JSON.stringify(config, null, 2), { mode: 0o600 });

  console.log(`✅ Auto-allocation ${enabled ? 'enabled' : 'disabled'}`);
  console.log(`📁 Configuration saved to: ${userConfigFile}`);

  if (enabled) {
    console.log('\n💡 New unknown service types will now be automatically allocated port ranges');
  } else {
    console.log('\n💡 Unknown service types will now require manual configuration');
  }
}

/**
 * Undo an auto-allocation (rollback)
 */
async function undoAutoAllocation(serviceType, configWriter, auditLogger) {
  if (!serviceType) {
    console.error('❌ Service type is required');
    console.log('Usage: styxy config auto-allocation undo <service-type>');
    process.exit(1);
  }

  try {
    // Check if it was auto-allocated
    const autoAllocated = configWriter.getAutoAllocatedServiceTypes();
    const service = autoAllocated.find(s => s.name === serviceType);

    if (!service) {
      console.error(`❌ Service type '${serviceType}' was not auto-allocated`);
      console.log('\nAuto-allocated services:');
      if (autoAllocated.length === 0) {
        console.log('  (none)');
      } else {
        autoAllocated.forEach(s => console.log(`  • ${s.name}`));
      }
      process.exit(1);
    }

    // Remove the service type
    await configWriter.removeServiceType(serviceType);

    // Log the undo action
    auditLogger.log('AUTO_ALLOCATION_UNDO', {
      serviceType,
      range: service.range,
      originallyAllocatedAt: service.allocatedAt
    });

    console.log(`✅ Removed auto-allocated service type '${serviceType}'`);
    console.log(`   Range ${service.range[0]}-${service.range[1]} is now available`);
    console.log('\n💡 A backup of the previous configuration has been saved');
  } catch (error) {
    console.error(`❌ Failed to undo auto-allocation: ${error.message}`);
    process.exit(1);
  }
}

/**
 * List all auto-allocated services
 */
async function listAutoAllocatedServices(configWriter) {
  const autoAllocated = configWriter.getAutoAllocatedServiceTypes();

  console.log('\n📦 Auto-Allocated Services');
  console.log('='.repeat(50));

  if (autoAllocated.length === 0) {
    console.log('\nNo services have been auto-allocated yet');
    console.log('\n💡 Enable auto-allocation with: styxy config auto-allocation enable');
    return;
  }

  console.log(`\nTotal: ${autoAllocated.length} service(s)\n`);

  autoAllocated.forEach((service, index) => {
    const allocatedDate = new Date(service.allocatedAt).toLocaleString();
    const chunkSize = service.range[1] - service.range[0] + 1;

    console.log(`${index + 1}. ${service.name}`);
    console.log(`   Range: ${service.range[0]}-${service.range[1]} (${chunkSize} ports)`);
    console.log(`   Allocated: ${allocatedDate}`);
    console.log();
  });

  console.log('💡 To remove: styxy config auto-allocation undo <service-type>');
}

module.exports = config;