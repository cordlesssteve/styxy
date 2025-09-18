#!/usr/bin/env node

/**
 * Styxy - Development Port Coordination Daemon
 * 
 * Main entry point for the Styxy daemon and CLI interface.
 * Provides intelligent port allocation and process coordination
 * for multi-instance development environments.
 */

const { program } = require('commander');
const pkg = require('../package.json');

// Import command modules
const daemon = require('./commands/daemon');
const allocate = require('./commands/allocate');
const check = require('./commands/check');
const list = require('./commands/list');
const cleanup = require('./commands/cleanup');

// Configure CLI program
program
  .name('styxy')
  .description(pkg.description)
  .version(pkg.version);

// Daemon management commands
program
  .command('daemon')
  .description('Manage the Styxy coordination daemon')
  .argument('<action>', 'Action to perform (start|stop|status|restart)')
  .option('-p, --port <port>', 'Daemon port (default: 9876)', '9876')
  .option('-d, --detach', 'Run daemon in background')
  .action(daemon);

// Port allocation commands
program
  .command('allocate')
  .description('Allocate a port for a service')
  .requiredOption('-s, --service <type>', 'Service type (dev, api, test, storybook, docs)')
  .option('-p, --port <port>', 'Preferred port number')
  .option('-n, --name <name>', 'Service instance name')
  .option('--project <path>', 'Project path context')
  .option('--json', 'Output result as JSON')
  .action(allocate);

// Port availability check
program
  .command('check')
  .description('Check if a port is available')
  .argument('<port>', 'Port number to check')
  .option('--json', 'Output result as JSON')
  .action(check);

// List allocations
program
  .command('list')
  .description('List all current port allocations')
  .option('-v, --verbose', 'Show detailed information')
  .option('--json', 'Output result as JSON')
  .action(list);

// Release allocation
program
  .command('release')
  .description('Release a port allocation')
  .argument('<lockId>', 'Lock ID to release')
  .action(require('./commands/release'));

// Cleanup stale allocations
program
  .command('cleanup')
  .description('Clean up stale port allocations')
  .option('-f, --force', 'Force cleanup of all allocations')
  .action(cleanup);

// Port scan
program
  .command('scan')
  .description('Scan for ports in use (system and Styxy allocations)')
  .option('-s, --start <port>', 'Start port number (default: 3000)', '3000')
  .option('-e, --end <port>', 'End port number (default: 9999)', '9999')
  .action(require('./commands/scan'));

// Instance management
program
  .command('instances')
  .description('List active Styxy instances')
  .action(require('./commands/instances'));

// Configuration management
program
  .command('config')
  .description('Manage Styxy configuration')
  .argument('<action>', 'Action to perform (show|validate|generate|instances)')
  .option('-f, --force', 'Force overwrite when generating config')
  .action(require('./commands/config'));

// Parse command line arguments
program.parse();

// If no command provided, show help
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
