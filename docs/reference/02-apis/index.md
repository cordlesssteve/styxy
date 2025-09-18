# API Documentation

This directory contains API documentation for Styxy daemon and CLI interfaces.

## Available APIs

### HTTP REST API
- **Base URL**: `http://127.0.0.1:9876`
- **Port Management**: allocate, release, check availability
- **Instance Management**: register, heartbeat, list
- **Administrative**: status, cleanup, list allocations

### CLI Interface
- **Daemon Management**: start, stop, status, restart
- **Port Operations**: allocate, check, list, release, cleanup
- **Configuration**: show, validate, instances

## Quick Reference

```bash
# Start daemon and allocate port
styxy daemon start
styxy allocate --service dev --name myapp

# Check status and cleanup
styxy list
styxy cleanup
```

For detailed API specifications, see the [System Design](../01-architecture/system-design.md#api-specification) document.