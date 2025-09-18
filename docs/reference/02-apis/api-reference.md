# API Documentation

Complete API reference for Styxy daemon HTTP REST API and CLI interface.

## HTTP REST API

**Base URL**: `http://127.0.0.1:9876` (configurable)

### Port Management

#### POST /allocate
Request port allocation for a service.

**Request Body:**
```json
{
  "service_type": "dev",           // Required: Service type
  "service_name": "my-app",        // Optional: Service name
  "preferred_port": 3000,          // Optional: Preferred port
  "instance_id": "cli",            // Optional: Instance identifier
  "project_path": "/path/to/proj"  // Optional: Project path
}
```

**Response:**
```json
{
  "success": true,
  "port": 3001,
  "lock_id": "uuid-string",
  "message": "Port 3001 allocated for dev service"
}
```

#### DELETE /allocate/{lockId}
Release a specific port allocation.

**Response:**
```json
{
  "success": true,
  "message": "Port 3001 released",
  "port": 3001
}
```

#### GET /check/{port}
Check detailed port availability and usage information.

**Response:**
```json
{
  "port": 3000,
  "available": false,
  "allocated_to": {
    "service_type": "dev",
    "service_name": "my-app",
    "lock_id": "uuid-string",
    "allocated_at": "2025-01-01T12:00:00.000Z",
    "instance_id": "cli"
  },
  "system_usage": {
    "protocol": "listen",
    "process": {"name": "node", "pid": 12345},
    "tool": "ss",
    "local_address": "127.0.0.1:3000"
  }
}
```

#### GET /scan
Scan port range for usage (both Styxy and system).

**Query Parameters:**
- `start`: Start port (default: 3000)
- `end`: End port (default: 9999)

**Response:**
```json
{
  "scan_range": "3000-3010",
  "ports_in_use": [
    {
      "port": 3000,
      "allocated_to": { /* allocation info */ },
      "system_usage": null
    }
  ]
}
```

### Instance Management

#### POST /instance/register
Register a Claude Code instance.

#### PUT /instance/{id}/heartbeat
Update instance heartbeat.

#### GET /instance/list
List all registered instances.

### Administrative

#### GET /status
Daemon health check.

**Response:**
```json
{
  "status": "running",
  "uptime": 3600,
  "allocations_count": 5,
  "instances_count": 2
}
```

#### GET /allocations
List all current port allocations.

#### POST /cleanup
Force cleanup of stale allocations.

**Body (optional):**
```json
{"force": true}  // Force cleanup all allocations
```

#### GET /config
View current daemon configuration.

## CLI Interface

### Command Structure
```bash
styxy <command> [options] [arguments]
```

### Available Commands

#### Daemon Management
```bash
styxy daemon start [-p <port>] [-d]   # Start daemon
styxy daemon stop                      # Stop daemon
styxy daemon status                    # Check status
```

#### Port Operations
```bash
# Allocate port
styxy allocate -s <service> [-p <port>] [-n <name>] [--project <path>] [--json]

# Examples:
styxy allocate -s dev -n my-app                    # Smart allocation
styxy allocate -s api -p 8000 -n backend          # Specific port
styxy allocate -s storybook --json                 # JSON output

# Check port availability
styxy check <port> [--json]

# Release allocation
styxy release <lock-id> [--json]
```

#### Information & Monitoring
```bash
styxy list [-v] [--json]              # List allocations
styxy scan [-s <start>] [-e <end>] [--json]  # Scan port range
styxy instances [--json]               # Show instances
styxy cleanup [-f] [--json]           # Cleanup stale allocations
styxy config <show|validate>          # Configuration management
```

### Service Types

| Type | Range | Description | Examples |
|------|-------|-------------|----------|
| `dev` | 3000-3099 | Frontend development | React, Next.js, Vite |
| `api` | 8000-8099 | Backend services | Express, FastAPI |
| `storybook` | 6006-6029 | Component development | Storybook servers |
| `test` | 9200-9299 | Testing frameworks | Playwright, Jest |
| `database` | 8080-8099 | Database emulators | Firestore, local DBs |
| `auth` | 9099-9199 | Authentication | Firebase Auth |
| `functions` | 5000-5099 | Serverless functions | Firebase Functions |
| `ui` | 4000-4099 | Admin interfaces | Firebase UI |
| `proxy` | 8100-8199 | Development proxies | Webpack dev server |
| `docs` | 4100-4199 | Documentation | Sphinx, MkDocs |
| `monitoring` | 3100-3199 | Metrics dashboards | Logging interfaces |
| `build` | 8200-8299 | Build systems | Webpack, bundlers |
| `hub` | 4400-4499 | Service coordination | Multi-service hubs |

### JSON Output Mode

All CLI commands support `--json` flag for programmatic usage:

```bash
styxy allocate -s dev --json
# {"success":true,"port":3001,"lock_id":"uuid","message":"..."}

styxy check 3000 --json
# {"port":3000,"available":false,"allocated_to":{...}}

styxy list --json
# {"allocations":[{...}]}
```

### Error Handling

- CLI commands exit with code 0 on success, 1 on failure
- JSON mode preserves exit codes while providing structured error info
- HTTP API returns appropriate status codes (200, 400, 404, 500)

## Authentication

Currently, Styxy operates on localhost without authentication. In production environments, consider:
- Binding to localhost only (default)
- Using firewall rules for additional protection
- Running in isolated environments

## Rate Limiting

No rate limiting is currently implemented. The daemon is designed for local development use where high request volumes are unlikely.

## Backwards Compatibility

API versioning is not yet implemented. Breaking changes will be documented in release notes.