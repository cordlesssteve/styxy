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
    default:
      console.error(`Unknown config action: ${action}`);
      console.log('Available actions: show, validate, generate, instances');
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

module.exports = config;