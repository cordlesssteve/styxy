# Performance Documentation

This directory contains performance characteristics and optimization guides.

## Performance Characteristics

### Memory Usage
- **Daemon**: ~10-20MB RAM typical usage
- **State Size**: Minimal - port allocations are small objects
- **Scaling**: Can handle hundreds of concurrent allocations

### Response Times
- **Port Allocation**: < 1ms (in-memory operations)
- **Availability Check**: < 1ms (memory lookup)
- **Cleanup Operations**: < 100ms (process validation)

### Network Performance
- **Local HTTP**: Sub-millisecond latency (localhost)
- **Concurrent Requests**: Handled efficiently by Express.js
- **Throughput**: Limited by local HTTP stack, not application logic

## Optimization Guidelines

### Daemon Configuration
```bash
# Start daemon with minimal resource usage
styxy daemon start --detach

# Avoid frequent restarts (state persistence overhead)
# Use heartbeat for instance coordination instead
```

### Client Usage Patterns
```bash
# Batch operations when possible
styxy allocate --service dev --name app1
styxy allocate --service api --name app1

# Prefer specific service types over generic allocation
styxy allocate --service dev  # Better than --port 3000
```

## Monitoring

### Health Checks
```bash
# Quick status check
styxy daemon status

# Detailed allocation view
styxy list -v

# Performance impact assessment
ps aux | grep styxy
```

### Resource Monitoring
- Monitor daemon memory usage over time
- Watch for excessive allocation/release cycles
- Check cleanup effectiveness with `styxy list`