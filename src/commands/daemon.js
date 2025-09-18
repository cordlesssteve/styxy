/**
 * Daemon management commands
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const configDir = path.join(process.env.HOME, '.styxy');
const pidFile = path.join(configDir, 'daemon.pid');

async function daemon(action, options) {
  switch (action) {
    case 'start':
      return startDaemon(options);
    case 'stop':
      return stopDaemon(options);
    case 'status':
      return showStatus(options);
    case 'restart':
      return restartDaemon(options);
    default:
      console.error(`Unknown daemon action: ${action}`);
      console.log('Available actions: start, stop, status, restart');
      process.exit(1);
  }
}

function startDaemon(options) {
  // Check if daemon is already running
  if (isDaemonRunning()) {
    console.log('Styxy daemon is already running');
    return;
  }
  
  console.log('Starting Styxy daemon...');
  
  // Start daemon process
  const daemonPath = path.join(__dirname, '../daemon.js');
  const args = ['--port', options.port];
  
  const child = spawn('node', [daemonPath, ...args], {
    detached: options.detach,
    stdio: options.detach ? 'ignore' : 'inherit'
  });
  
  if (options.detach) {
    child.unref();
    console.log(`Daemon started in background (PID: ${child.pid})`);
  } else {
    console.log('Daemon started in foreground (Ctrl+C to stop)');
  }
}

function stopDaemon(options) {
  const pid = getDaemonPid();
  
  if (!pid) {
    console.log('Styxy daemon is not running');
    return;
  }
  
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Styxy daemon (PID: ${pid})`);
  } catch (error) {
    if (error.code === 'ESRCH') {
      console.log('Daemon process not found, cleaning up PID file');
      try {
        fs.unlinkSync(pidFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    } else {
      console.error('Failed to stop daemon:', error.message);
    }
  }
}

function showStatus(options) {
  const pid = getDaemonPid();
  
  if (!pid) {
    console.log('Status: Stopped');
    return;
  }
  
  try {
    // Check if process is actually running
    process.kill(pid, 0);
    console.log(`Status: Running (PID: ${pid})`);
    
    // Try to get more info from daemon API
    fetchDaemonStatus(options.port)
      .then(status => {
        console.log(`Uptime: ${Math.floor(status.uptime)}s`);
        console.log(`Allocations: ${status.allocations}`);
        console.log(`Instances: ${status.instances}`);
      })
      .catch(() => {
        console.log('(Unable to fetch detailed status)');
      });
  } catch (error) {
    if (error.code === 'ESRCH') {
      console.log('Status: Stopped (stale PID file)');
      try {
        fs.unlinkSync(pidFile);
      } catch (e) {
        // Ignore cleanup errors
      }
    } else {
      console.log('Status: Unknown');
    }
  }
}

function restartDaemon(options) {
  console.log('Restarting Styxy daemon...');
  stopDaemon(options);
  
  // Wait a moment for graceful shutdown
  setTimeout(() => {
    startDaemon(options);
  }, 1000);
}

function isDaemonRunning() {
  const pid = getDaemonPid();
  if (!pid) return false;
  
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return false;
  }
}

function getDaemonPid() {
  try {
    if (fs.existsSync(pidFile)) {
      const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim());
      return isNaN(pid) ? null : pid;
    }
  } catch (error) {
    // Ignore read errors
  }
  return null;
}

async function fetchDaemonStatus(port = 9876) {
  const response = await fetch(`http://127.0.0.1:${port}/status`);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

module.exports = daemon;
