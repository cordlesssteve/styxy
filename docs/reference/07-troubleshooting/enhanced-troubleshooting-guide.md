# Enhanced Troubleshooting Guide

This guide provides comprehensive troubleshooting for Styxy with enhanced error handling and actionable solutions.

## Quick Health Check

Run the diagnostic command first for immediate assessment:
```bash
styxy doctor
```

This will provide a comprehensive health check with specific recommendations.

## Enhanced Error Messages Reference

Styxy now provides enhanced error messages with actionable suggestions. Each error includes:
- Clear description of the problem
- Specific suggestions for resolution
- Help URLs for detailed guidance
- Context information about system state

### Port Range Exhaustion

**Error**: `No available ports in range 6006-6029 for service type storybook`

**Enhanced Response**:
```
❌ No available ports in range 6006-6029 for service type storybook

💡 Suggestions:
   • Run "styxy cleanup" to release stale allocations
   • Check "styxy list --service storybook" for active allocations
   • Release unused ports with "styxy release <lock-id>"
   • Consider using a different service type with available ports

📖 More help: https://docs.styxy.io/troubleshooting#port-exhaustion
```

**Resolution Steps**:
1. Check current allocations: `styxy list --service storybook`
2. Clean up stale allocations: `styxy cleanup`
3. Release specific ports: `styxy release <lock-id>`
4. Verify available ports: `styxy scan -s 6006 -e 6029`

### Daemon Connection Issues

**Error**: `Styxy daemon is not running or not responding`

**Enhanced Response**:
```
❌ Styxy daemon is not running or not responding

💡 Suggestions:
   • Start the daemon with "styxy daemon start"
   • Check daemon status with "styxy status"
   • Verify daemon port is not blocked by firewall
   • Run "styxy doctor" for comprehensive health check

📖 More help: https://docs.styxy.io/troubleshooting#daemon-connection
```

**Resolution Steps**:
1. Check daemon status: `styxy daemon status`
2. Start daemon if needed: `styxy daemon start`
3. Verify port availability: `lsof -i :9876`
4. Run health check: `styxy doctor`

### Invalid Service Type

**Error**: `Invalid service type: xyz`

**Enhanced Response**:
```
❌ Invalid service type: xyz

💡 Suggestions:
   • Valid service types: dev, api, test, storybook, docs, next, react, vue, angular, fastapi, django, flask, cypress, playwright
   • Run "styxy config" to see all available service types
   • Check your spelling and try again
   • Use "styxy help" for usage examples

📖 More help: https://docs.styxy.io/configuration#service-types
```

**Resolution Steps**:
1. View available types: `styxy config show`
2. Use correct service type: `styxy allocate -s dev`
3. Check documentation for service type mappings

### Invalid Lock ID

**Error**: `Invalid lock ID format: abc123`

**Enhanced Response**:
```
❌ Invalid lock ID format: abc123

💡 Suggestions:
   • Lock ID must be a valid UUID v4 format
   • Get valid lock IDs with "styxy list"
   • Example format: 550e8400-e29b-41d4-a716-446655440000
   • Use "styxy cleanup" to remove invalid allocations

📖 More help: https://docs.styxy.io/api#lock-ids
```

**Resolution Steps**:
1. List current allocations: `styxy list`
2. Copy correct UUID format from list
3. Use correct lock ID: `styxy release <correct-uuid>`

## Diagnostic Commands

### Health Check and System Status
```bash
# Comprehensive health check
styxy doctor

# Health check with JSON output
styxy doctor --json

# Quick daemon status
styxy daemon status

# Detailed system information
styxy list -v
styxy config show
styxy instances
```

### Port Diagnostics
```bash
# Check specific port
styxy check 3000

# Scan port range for usage
styxy scan -s 3000 -e 3100

# List all allocations
styxy list

# List allocations for specific service
styxy list --service storybook
```

### Connection Testing
```bash
# Test daemon API directly
curl http://127.0.0.1:9876/status

# Test with authentication if enabled
curl -H "X-API-Key: your-key" http://127.0.0.1:9876/status

# Check daemon health endpoint
curl http://127.0.0.1:9876/health
```

## Common Problem Patterns

### Pattern 1: Development Server Won't Start

**Symptoms**: Error about port already in use

**Investigation**:
```bash
# Check what's using the port
styxy check 3000
lsof -i :3000

# Check Styxy allocations
styxy list --port 3000
```

**Resolution**:
```bash
# Let Styxy allocate automatically
styxy allocate -s dev

# Or allocate specific port
styxy allocate -s dev -p 3001

# Or release existing allocation
styxy release <lock-id>
```

### Pattern 2: Multi-Instance Development Issues

**Symptoms**: Port conflicts between different project instances

**Investigation**:
```bash
# Check all instances
styxy instances

# Check all allocations
styxy list -v

# Check daemon health
styxy doctor
```

**Resolution**:
```bash
# Use instance-specific allocation
styxy allocate -s dev -n project-a
styxy allocate -s dev -n project-b

# Or use different service types
styxy allocate -s dev --project /path/to/project-a
styxy allocate -s api --project /path/to/project-b
```

### Pattern 3: Cleanup and Maintenance

**Symptoms**: Growing number of stale allocations

**Investigation**:
```bash
# Check allocation age and status
styxy list -v

# Check daemon memory usage
styxy doctor
```

**Resolution**:
```bash
# Automated cleanup
styxy cleanup

# Manual cleanup of specific allocation
styxy release <lock-id>

# Restart daemon for fresh state
styxy daemon restart
```

## Advanced Troubleshooting

### Debug Mode

Enable debug output for detailed analysis:
```bash
# Debug all components
DEBUG=styxy:* styxy allocate -s dev

# Debug specific components
DEBUG=styxy:daemon styxy daemon start
DEBUG=styxy:port-scanner styxy scan -s 3000 -e 3100
DEBUG=styxy:api-client styxy allocate -s storybook
```

### Log Analysis

Check daemon logs for detailed error information:
```bash
# View recent daemon logs
tail -f ~/.styxy/logs/daemon.log

# View audit logs
tail -f ~/.styxy/logs/audit.log

# Search for specific errors
grep "ERROR" ~/.styxy/logs/daemon.log | tail -10
```

### State Recovery

Reset system state if corrupted:
```bash
# Stop daemon
styxy daemon stop

# Backup current state
cp ~/.styxy/daemon.state ~/.styxy/daemon.state.backup

# Reset state (caution: loses all allocations)
rm ~/.styxy/daemon.state

# Restart daemon
styxy daemon start

# Verify clean state
styxy list
```

### Network Diagnostics

Test network connectivity:
```bash
# Test daemon port availability
netstat -tlnp | grep 9876
ss -tlnp | grep 9876

# Test local connectivity
telnet 127.0.0.1 9876

# Test with curl
curl -v http://127.0.0.1:9876/status
```

## Performance Optimization

### High Memory Usage

**Investigation**:
```bash
styxy doctor | grep -A 5 "RESOURCES"
curl -s http://127.0.0.1:9876/metrics | grep memory
```

**Resolution**:
```bash
# Clean up allocations
styxy cleanup

# Restart daemon
styxy daemon restart

# Monitor with smaller batch sizes
```

### Slow Port Allocation

**Investigation**:
```bash
# Check port range sizes
styxy config show | grep range

# Test port scanning performance
time styxy scan -s 3000 -e 3100
```

**Resolution**:
```bash
# Use preferred ports to reduce scanning
styxy allocate -s dev -p 3000

# Optimize service type ranges in config
```

## Getting Help

### Collect Debug Information

For support requests, collect comprehensive system information:

```bash
#!/bin/bash
echo "=== Styxy Debug Report ==="
echo "Timestamp: $(date)"
echo

echo "=== System Information ==="
uname -a
node --version
npm --version

echo
echo "=== Styxy Version ==="
styxy --version

echo
echo "=== Health Check ==="
styxy doctor

echo
echo "=== Configuration ==="
styxy config show

echo
echo "=== Current State ==="
styxy list -v
styxy instances

echo
echo "=== Recent Logs ==="
tail -20 ~/.styxy/logs/daemon.log 2>/dev/null || echo "No daemon logs found"

echo
echo "=== Network Status ==="
netstat -tlnp | grep 9876
lsof -i :9876 2>/dev/null || echo "No process on port 9876"
```

### Support Channels

1. **Self-Diagnosis**: Always run `styxy doctor` first
2. **Documentation**: Check https://docs.styxy.io/troubleshooting
3. **Issues**: https://github.com/cordlesssteve/styxy/issues
4. **Enhanced Errors**: Pay attention to suggestion messages
5. **Health Monitoring**: Set up periodic `styxy doctor` checks

### FAQ

**Q: Can I change the daemon port?**
A: Yes, use `styxy daemon start -p 8765` or set `STYXY_DAEMON_PORT` environment variable.

**Q: How do I backup my port allocations?**
A: Copy `~/.styxy/daemon.state` - this contains all current allocations.

**Q: Can I use Styxy in CI/CD?**
A: Yes, use `--json` flags for programmatic output and check exit codes.

**Q: How do I handle Docker port conflicts?**
A: Use `styxy allocate` before starting containers, then map container ports to allocated ports.

**Q: What happens if daemon crashes?**
A: State is persisted to disk. Restart daemon with `styxy daemon start` to recover allocations.

**Q: Can I run multiple daemons?**
A: No, use a single daemon with multiple instances for coordination.

This enhanced troubleshooting guide should help resolve most issues quickly with actionable steps and comprehensive diagnostics.