# Troubleshooting Documentation

This directory contains troubleshooting guides and common issue resolution.

## Common Issues

### Daemon Won't Start
```bash
# Check if daemon is already running
styxy daemon status

# Check port availability
netstat -tlnp | grep 9876

# Start with debugging
styxy daemon start --verbose
```

### Port Allocation Fails
```bash
# Check what's using the port
styxy check 3000

# List current allocations
styxy list -v

# Force cleanup if needed
styxy cleanup --force
```

### Stale Allocations
```bash
# Manual cleanup
styxy cleanup

# Check daemon status
styxy daemon status

# Restart daemon if necessary
styxy daemon restart
```

## Debugging Commands

### Status Checks
```bash
styxy daemon status          # Daemon health
styxy list -v               # Detailed allocations
styxy config show           # Current configuration
styxy instances             # Active Claude instances
```

### Log Analysis
```bash
# Check daemon logs (if available)
tail -f ~/.styxy/logs/daemon.log

# Test connectivity
curl http://127.0.0.1:9876/status
```

## Error Messages & Solutions

### "Styxy daemon is not running"
- **Cause**: Daemon process is not started or crashed
- **Solution**:
  ```bash
  # Start daemon
  node src/daemon.js --daemon

  # Or check if daemon is running on different port
  ps aux | grep styxy
  ```

### "Port X is in use"
- **Cause**: Port is occupied by system process or Styxy allocation
- **Solution**:
  ```bash
  # Check detailed port info
  ./bin/styxy check 3000

  # Find alternative port
  ./bin/styxy allocate -s dev  # Let Styxy choose
  ```

### "Unknown service type: X"
- **Cause**: Service type not in configuration
- **Solution**:
  ```bash
  # View available service types
  ./bin/styxy config show

  # Use correct service type
  ./bin/styxy allocate -s dev -n my-app
  ```

### "Lock ID X not found"
- **Cause**: Trying to release invalid or expired allocation
- **Solution**:
  ```bash
  # List current allocations
  ./bin/styxy list -v

  # Use correct lock ID from list
  ./bin/styxy release <correct-lock-id>
  ```

### "ECONNREFUSED"
- **Cause**: Cannot connect to daemon (wrong port, daemon down)
- **Solution**:
  ```bash
  # Check daemon status
  curl -s http://127.0.0.1:9876/status || echo "Daemon not responding"

  # Set correct port if needed
  export STYXY_DAEMON_PORT=9876

  # Restart daemon
  pkill -f styxy && node src/daemon.js --daemon
  ```

## Advanced Debugging

### Enable Debug Output
```bash
# Debug all modules
DEBUG=styxy:* node src/daemon.js --daemon

# Debug specific components
DEBUG=styxy:port-scanner ./bin/styxy scan -s 3000 -e 3010
DEBUG=styxy:daemon ./bin/styxy allocate -s dev
```

### Manual State Recovery
```bash
# If state is corrupted, reset it
rm -f ~/.styxy/state.json

# Restart daemon to rebuild state
pkill -f styxy
node src/daemon.js --daemon
```

### System Port Detection Issues
```bash
# Test system tools availability
which lsof && echo "lsof available"
which netstat && echo "netstat available"
which ss && echo "ss available"

# Manual port check
lsof -i :3000
netstat -tlnp | grep 3000
ss -tlnp | grep 3000
```

### Test Infrastructure
```bash
# Verify test setup
npm test -- --verbose tests/helpers/daemon-helper.test.js

# Check test ports availability
./bin/styxy scan -s 10000 -e 10100

# Clean up test processes
pkill -f "test-daemon"
```

## Performance Issues

### High CPU Usage
- **Cause**: Too frequent cleanup cycles or large port ranges
- **Solution**:
  ```bash
  # Check cleanup interval in config
  ./bin/styxy config show

  # Reduce scan ranges
  ./bin/styxy scan -s 3000 -e 3100  # Smaller range
  ```

### Memory Leaks
- **Cause**: Accumulating stale allocations or daemon not cleaning up
- **Solution**:
  ```bash
  # Force cleanup
  ./bin/styxy cleanup -f

  # Restart daemon periodically
  pkill -f styxy && node src/daemon.js --daemon
  ```

## Getting Help

### Check System Status
```bash
# Full system overview
./bin/styxy list -v
./bin/styxy instances
./bin/styxy config show
curl -s http://127.0.0.1:9876/status | jq
```

### Collect Debug Information
```bash
# For bug reports, collect:
echo "=== Styxy Version ==="
node -e "console.log(require('./package.json').version)"

echo "=== System Info ==="
uname -a
node --version

echo "=== Daemon Status ==="
curl -s http://127.0.0.1:9876/status | jq || echo "Daemon not responding"

echo "=== Current Allocations ==="
./bin/styxy list --json

echo "=== System Ports ==="
./bin/styxy scan -s 3000 -e 9000 | head -20
```

### Report Issues
- Include debug information above
- Describe expected vs actual behavior
- Provide steps to reproduce
- Submit to: https://github.com/cordlesssteve/styxy/issues