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

## Error Messages

### "Daemon not running"
- **Cause**: Styxy daemon is not started
- **Solution**: Run `styxy daemon start`

### "Port already allocated"
- **Cause**: Port is in use by another service
- **Solution**: Use `styxy check <port>` to verify, try different port

### "No available ports in range"
- **Cause**: All ports in service type range are occupied
- **Solution**: Clean up unused allocations or expand port range