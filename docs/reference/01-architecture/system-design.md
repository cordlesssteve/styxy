# Styxy System Design and Architecture
**Status:** ARCHIVED
**Created:** 2025-09-17
**Last Updated:** 2025-09-17
**Purpose:** Comprehensive design and architecture documentation for Styxy port coordination daemon

This document contains the comprehensive design and architecture for Styxy, including the original analysis and planning from the development process.

## Table of Contents

1. [Problem Analysis](#problem-analysis)
2. [Architecture Overview](#architecture-overview)
3. [Pure Daemon Approach](#pure-daemon-approach)
4. [Implementation Details](#implementation-details)
5. [API Specification](#api-specification)
6. [Security Considerations](#security-considerations)

## Problem Analysis

### Core Challenges

1. **Race Conditions**: Multiple instances allocating same port simultaneously
2. **State Persistence**: Surviving process crashes and restarts
3. **Stale Lock Management**: Cleaning up dead process allocations
4. **Service Intelligence**: Understanding service-specific port requirements
5. **Conflict Resolution**: Handling unavailable preferred ports
6. **Cross-Instance Communication**: Coordinating between Claude instances

### Existing Solutions Analysis

After comprehensive research of existing 2025 solutions, no tool directly addresses multi-instance development port coordination:

- **Enterprise solutions** (Kubernetes/Istio) are overkill
- **Development tools** (VS Code, Devbox) require manual coordination
- **Process managers** (PM2) lack port intelligence
- **Abandoned libraries** (port-manager npm) from 2012

Styxy fills a genuine gap in the 2025 development tooling ecosystem.

## Architecture Overview

### 4-Layer System

**1. Detection Layer**
- OS-level port scanning (`lsof`, `ss`, `netstat`)
- Docker container port mapping detection
- Process-to-port relationship tracking
- Real-time availability verification

**2. Allocation Layer**
- Atomic port reservation using in-memory state
- Service-type-aware port range management
- Lock metadata with expiration
- Race condition prevention via single daemon

**3. Coordination Layer**
- HTTP API for inter-instance communication
- Shared state in daemon memory
- Heartbeat system for instance liveness
- Deterministic conflict arbitration

**4. Intelligence Layer**
- Service type recognition and preferences
- Port range conventions (dev: 8000-8099, test: 9000-9099)
- Alternative suggestion algorithms
- Project context awareness

## Pure Daemon Approach

### Core Architecture

Instead of filesystem locks, a single background daemon (`styxy-daemon`) becomes the **single source of truth** for all port coordination:

```
styxy-daemon (Main Process)
├── HTTP Server (localhost:9876)
├── Process Monitor Thread
├── Port Registry (In-Memory)
├── Cleanup Engine
├── Configuration Manager
└── State Persistence Layer
```

### In-Memory Port Registry

All state lives in fast memory structures:

```javascript
{
  allocations: {
    "8000": {
      port: 8000,
      service_type: "dev",
      service_name: "main-app",
      process_id: 12345,
      process_start_time: 1737142052,
      instance_id: "claude_a",
      project_path: "/home/user/project",
      allocated_at: "2025-01-17T17:07:32Z",
      lock_id: "uuid-abc123"
    }
  },
  instances: {
    "claude_a": {
      working_directory: "/home/user/project",
      active_allocations: ["abc123", "def456"],
      last_heartbeat: "2025-01-17T17:10:00Z"
    }
  }
}
```

### Real-Time Process Monitoring

#### Signal-Based Detection (Preferred)
```javascript
// Daemon gets notified immediately when processes die
process.on('SIGCHLD', (pid) => {
  cleanupProcessAllocations(pid);
  notifyClients(`Port auto-released for PID ${pid}`);
});
```

#### Polling + Validation (Fallback)
```javascript
// Every 10 seconds, validate all tracked processes
setInterval(() => {
  for (let allocation of Object.values(allocations)) {
    if (!isProcessStillAlive(allocation.process_id, allocation.process_start_time)) {
      releasePort(allocation.port);
    }
  }
}, 10000);
```

**Key Advantage**: Ports become available **immediately** when services stop, no waiting for cleanup cycles.

## Implementation Details

### File System Structure
```
~/.styxy/
├── config.json         # Service type configurations
├── daemon.state        # Persistent state backup
├── daemon.pid          # Daemon process ID
└── logs/
    └── daemon.log      # Daemon logs
```

### Service Type Configuration
```json
{
  "dev": {
    "preferred_ports": [3000, 8000, 8080],
    "port_range": [8000, 8099],
    "description": "Development servers"
  },
  "storybook": {
    "preferred_ports": [6006],
    "port_range": [6006, 6010],
    "description": "Storybook instances"
  },
  "test": {
    "preferred_ports": [9000, 9001, 9002],
    "port_range": [9000, 9099],
    "description": "Testing frameworks"
  }
}
```

### Atomic Allocation Protocol

1. **Request Validation**: Verify service type and parameters
2. **Availability Check**: Check port availability atomically in memory
3. **Process Verification**: Confirm requesting process is alive
4. **Instant Reservation**: Reserve port and return lock_id
5. **State Persistence**: Save state for crash recovery

**No race conditions possible** - only daemon modifies state, all operations atomic.

## API Specification

### HTTP REST API

```
# Port Management
POST   /allocate          # Request port allocation
DELETE /allocate/{lockId} # Release specific allocation
GET    /check/{port}      # Check port availability
GET    /suggest/{serviceType} # Get suggested port

# Instance Management
POST   /instance/register # Register Claude instance
POST   /instance/heartbeat # Update instance liveness
GET    /instance/list     # List active instances

# Administrative
GET    /status           # Daemon health check
POST   /cleanup          # Force cleanup
GET    /allocations      # List all allocations
```

### CLI Interface

```bash
# Daemon management
styxy daemon start          # Start coordination daemon
styxy daemon stop           # Stop daemon
styxy daemon status         # Check status

# Port operations
styxy allocate --service dev --port 8000    # Request specific port
styxy check 8000                            # Check availability
styxy list                                  # List allocations
styxy release <lock-id>                     # Release allocation
```

## Security Considerations

- **localhost-only binding**: Daemon only accepts connections from 127.0.0.1
- **Input validation**: All API inputs validated and sanitized
- **Process verification**: PID + start time validation prevents spoofing
- **No privilege escalation**: Runs as regular user, no root access needed
- **State isolation**: Each user gets isolated daemon instance

## Key Advantages

✅ **Eliminates ALL race conditions** - single process manages state
✅ **Real-time cleanup** - ports available immediately
✅ **No filesystem I/O** during normal operations (fast)
✅ **Atomic operations** - all allocations happen instantly
✅ **Cross-platform** - Node.js abstracts OS differences
✅ **Scalable** - can handle hundreds of allocations efficiently

## Challenges & Solutions

**Single Point of Failure** → State persistence + auto-restart + fallback mode
**Management Complexity** → Auto-start + simple CLI tools
**Resource Usage** → Lightweight design (~10-20MB RAM)
**Security** → localhost-only binding + input validation

This approach provides **bulletproof coordination** with **excellent performance** - the most robust solution for multi-instance Claude setups.