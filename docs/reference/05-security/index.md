# Security Documentation

This directory contains security policies and considerations.

## Security Model

### Network Security
- **localhost-only binding**: Daemon only accepts connections from 127.0.0.1
- **No external exposure**: No network ports exposed beyond local machine
- **Process isolation**: Each user gets isolated daemon instance

### Input Validation
- All API inputs validated and sanitized
- Service type validation against known types
- Port range validation within allowed bounds

### Process Security
- **PID + start time validation**: Prevents process spoofing
- **No privilege escalation**: Runs as regular user, no root access needed
- **State isolation**: Daemon state isolated per user

## Threat Model

### Mitigated Risks
- ✅ Port conflicts between development instances
- ✅ Race conditions in port allocation
- ✅ Stale allocations from terminated processes

### Accepted Risks
- Local process can communicate with daemon (by design)
- Daemon process failure requires restart
- No authentication between local processes (unnecessary for local development)