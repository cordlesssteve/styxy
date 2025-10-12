# Styxy

> A development port coordination daemon for multi-instance environments

Styxy intelligently manages port allocation and process coordination for Claude Code and other development tools, preventing conflicts when running multiple development servers, Firebase emulators, Storybook, and other services simultaneously.

**✨ With LD_PRELOAD mode, port conflicts are automatically resolved - just run your servers and Styxy handles the rest!**

## ⚡ Quick Start

### Option 1: Automatic Mode (LD_PRELOAD) - Recommended

```bash
# Clone and install
git clone https://github.com/cordlesssteve/styxy.git
cd styxy && npm install

# Start the daemon (runs automatically via systemd/hooks)
node src/daemon.js --daemon

# That's it! Port conflicts are now handled automatically:
python3 -m http.server 8000
# If 8000 is busy: ✓ STYXY: Port 8000 was in use, auto-assigned port 3001
```

LD_PRELOAD mode is **automatically enabled** in Claude Code sessions. No manual port management needed!

### Option 2: Manual Mode (CLI)

```bash
# Allocate ports explicitly for your services
./bin/styxy allocate -s dev -n my-app     # Smart allocation by service type
./bin/styxy allocate -s api -n backend   # Gets appropriate API port range

# Check detailed port availability (system + Styxy info)
./bin/styxy check 3000

# Scan for ports in use across a range
./bin/styxy scan -s 3000 -e 9000

# View all current allocations
./bin/styxy list -v

# Clean up and stop
./bin/styxy cleanup
pkill -f "styxy"
```

## 🎯 Problem Solved

When working with multiple Claude Code instances or development environments, port conflicts are inevitable:

- Instance A wants port 8000 for main app
- Instance B also wants port 8000 for API server
- Firebase emulators conflict on default ports
- Storybook instances clash
- Manual coordination is error-prone

Styxy provides **bulletproof coordination** with **real-time cleanup** and **zero race conditions**.

## 🏗️ Architecture

Styxy uses a **pure daemon approach** with:

- **Background daemon** (`styx-daemon`) as single source of truth
- **HTTP REST API** for Claude instances to coordinate
- **Real-time process monitoring** with immediate cleanup
- **In-memory state** with filesystem persistence
- **Service-type intelligence** (dev, test, storybook, etc.)

```
styxy-daemon (Main Process)
├── HTTP Server (localhost:9876)
├── Process Monitor Thread
├── Port Registry (In-Memory)
├── Cleanup Engine
├── Configuration Manager
└── State Persistence Layer
```

## 🚀 Features

### Core Features
- ✅ **Eliminates ALL race conditions** - single process manages state
- ✅ **Real-time cleanup** - ports available immediately when services stop
- ✅ **No filesystem I/O** during normal operations (fast)
- ✅ **Atomic operations** - all allocations happen instantly
- ✅ **Cross-platform** - Node.js abstracts OS differences
- ✅ **Service-type aware** - understands dev vs test vs storybook requirements
- ✅ **Process monitoring** - tracks PID + start time for reliable validation
- ✅ **Auto-recovery** - graceful shutdown and state restoration

### 🆕 Shadow Mode (Passive Notifications)
- ✅ **In-conversation notices** - Port conflict warnings directly in Claude Code
- ✅ **Non-blocking design** - Never prevents command execution
- ✅ **Actionable solutions** - Every notice includes how to fix the issue
- ✅ **Works in the shadows** - Helps even when Claude doesn't use Styxy directly
- ✅ **Dual-hook system** - PreToolUse warnings + PostToolUse solutions

**New in v1.0:** Shadow Mode provides real-time port availability context without requiring Claude Code to explicitly use Styxy. See [Shadow Mode Setup](./SHADOW_MODE_SETUP.md) for 5-minute quick start.

### 🔧 LD_PRELOAD Automatic Port Reassignment
- ✅ **Universal compatibility** - Works with ANY language (Python, Node.js, Go, Rust, C, etc.)
- ✅ **Zero code changes** - Applications automatically use available ports
- ✅ **Transparent operation** - Intercepts bind() system calls at kernel level
- ✅ **Claude-visible notifications** - See reassignments in command output
- ✅ **Automatic activation** - Enabled by default in all Claude Code sessions
- ✅ **Fail-safe design** - Gracefully handles daemon unavailability

**Example:**
```bash
# Port 8000 is occupied by another service
python3 -m http.server 8000
# Output: ✓ STYXY: Port 8000 was in use, auto-assigned port 3001
# Server automatically runs on port 3001!
```

**New in v1.0:** LD_PRELOAD mode eliminates manual port management entirely. See [LD_PRELOAD Mode Guide](./docs/reference/03-development/LD_PRELOAD_MODE.md) for complete documentation.

## 📚 API Reference

### CLI Commands

```bash
# Daemon management
styxy daemon start [-p <port>] [-d]  # Start coordination daemon
styxy daemon stop                    # Stop the daemon
styxy daemon status                  # Check daemon status

# Port allocation
styxy allocate -s <service> [-p <port>] [-n <name>] [--project <path>] [--json]
  # -s: Service type (dev, api, storybook, test, etc.)
  # -p: Request specific port (optional)
  # -n: Service name (optional)
  # --json: JSON output for scripting

styxy release <lock-id> [--json]     # Release specific allocation
styxy check <port> [--json]          # Detailed availability check

# Information & Monitoring
styxy list [-v] [--json]             # List allocations (-v for verbose)
styxy scan [-s <start>] [-e <end>] [--json]  # Port range scanning
styxy instances [--json]             # Show active Styxy instances
styxy cleanup [-f] [--json]          # Cleanup stale allocations (-f for force)
styxy config <show|validate>         # Configuration management
```

**Service Types Available:**
- `dev` - Frontend development servers (3000-3099)
- `api` - Backend API servers (8000-8099)
- `storybook` - Component development (6006-6029)
- `test` - Testing frameworks (9200-9299)
- `database` - Database/Firestore emulators (8080-8099)
- `auth` - Authentication services (9099-9199)
- `functions` - Serverless functions (5000-5099)
- `ui` - Admin interfaces (4000-4099)
- Plus 5 additional specialized types

### HTTP API

The daemon exposes a REST API on port 9876 (configurable):

```bash
# Port Management
POST   /allocate           # Request port allocation
  Body: {"service_type": "dev", "service_name": "my-app", "preferred_port": 3000}
  Response: {"success": true, "port": 3001, "lock_id": "uuid", "message": "..."}

DELETE /allocate/{lockId}   # Release specific allocation
  Response: {"success": true, "message": "Port released"}

GET    /check/{port}       # Check port availability with detailed info
  Response: {"port": 3000, "available": false, "allocated_to": {...}, "system_usage": {...}}

GET    /scan?start=3000&end=3010  # Scan port range
  Response: {"scan_range": "3000-3010", "ports_in_use": [...]}

# Instance Management
POST   /instance/register  # Register Claude instance
PUT    /instance/{id}/heartbeat  # Update instance liveness
GET    /instance/list      # List active instances

# Administrative
GET    /status            # Daemon health check
POST   /cleanup           # Force cleanup (with optional {"force": true})
GET    /allocations       # List all current allocations
GET    /config            # View current configuration
```

## 🛠️ Configuration

Styxy automatically loads configuration from **CORE documentation** (`~/docs/CORE/PORT_REFERENCE_GUIDE.md`) providing 13 predefined service types with intelligent port ranges.

**View current configuration:**
```bash
./bin/styxy config show
```

**Manual configuration override** (optional) at `~/.styxy/config.json`:
```json
{
  "listen_port": 9876,
  "cleanup_interval": 30,
  "service_types": {
    "dev": {"preferred_ports": [3000, 3001], "range": [3000, 3099]},
    "api": {"preferred_ports": [8000, 8001], "range": [8000, 8099]},
    "custom": {"preferred_ports": [9500], "range": [9500, 9599]}
  }
}
```

**Default Service Types from CORE:**
- **DEV** (3000-3099): React, Next.js, Vite servers
- **API** (8000-8099): Express, FastAPI, backend services
- **STORYBOOK** (6006-6029): Component development
- **TEST** (9200-9299): Testing frameworks, Chrome DevTools
- **DATABASE** (8080-8099): Firestore emulator, local databases
- **AUTH** (9099-9199): Firebase Auth emulator
- **FUNCTIONS** (5000-5099): Firebase Functions, serverless
- **UI** (4000-4099): Firebase Emulator UI, admin panels
- **PROXY** (8100-8199): Webpack dev server, development proxies
- **DOCS** (4100-4199): Documentation servers
- **MONITORING** (3100-3199): Metrics dashboards
- **BUILD** (8200-8299): Build system services
- **HUB** (4400-4499): Multi-service coordination

## 📖 Documentation

### Project Status
- **[Current Status](./CURRENT_STATUS.md)** - Real-time project status and progress
- **[Active Plan](./ACTIVE_PLAN.md)** - Current development priorities and tasks

### Technical Reference
- **[Architecture](./docs/reference/01-architecture/)** - System design and architecture details
- **[API Reference](./docs/reference/02-apis/api-reference.md)** - Complete HTTP REST API and CLI documentation
- **[Development Guide](./docs/reference/03-development/development-guide.md)** - Setup, testing, and contribution guidelines
- **[LD_PRELOAD Mode Guide](./docs/reference/03-development/LD_PRELOAD_MODE.md)** - 🔧 Complete guide to automatic port reassignment
- **[LD_PRELOAD Quick Reference](./docs/reference/03-development/LD_PRELOAD_QUICK_REFERENCE.md)** - 📋 One-page cheat sheet for LD_PRELOAD mode
- **[Installation & Deployment](./docs/reference/04-deployment/installation-deployment.md)** - Installation, configuration, and production deployment
- **[Security](./docs/reference/05-security/)** - Security model and considerations
- **[Integrations](./docs/reference/06-integrations/)** - CORE documentation and external system integration
- **[Troubleshooting Guide](./docs/reference/07-troubleshooting/troubleshooting-guide.md)** - Common issues, debugging, and solutions
- **[Performance](./docs/reference/08-performance/)** - Performance characteristics and optimization
- **[Compliance](./docs/reference/09-compliance/)** - Standards adherence and audit documentation

> **Documentation Standard**: This project follows the [Universal Project Documentation Standard v2.0](https://docs.example.com/standards/docs) for consistent, status-driven documentation management.

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details on our code of conduct and development process.

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🎉 Acknowledgments

- Inspired by the need for better multi-instance development coordination
- Built for the Claude Code ecosystem but designed to be universally useful
- Thanks to the open source community for daemon architecture patterns

---

## 🎯 Real-World Usage Examples

### Automatic Mode (LD_PRELOAD) - Zero Configuration

```bash
# Terminal 1: Just run your servers - Styxy handles conflicts automatically!
python3 -m http.server 8000
# ✓ STYXY: Port 8000 was in use, auto-assigned port 3001

npm start  # Tries port 3000
# ✓ STYXY: Port 3000 was in use, auto-assigned port 3002

# Terminal 2: Different project, same ports - no problem!
python3 -m http.server 8000
# ✓ STYXY: Port 8000 was in use, auto-assigned port 3003

# Check what happened
cat /tmp/styxy-reassignments.log
# [2025-10-11 19:25:22] PID 110548: Port 8000 -> 3001 (service: dev)
# [2025-10-11 19:29:44] PID 121458: Port 3000 -> 3002 (service: dev)
```

### Manual Mode (CLI) - Explicit Control

```bash
# Terminal 1: Claude Code Instance A
./bin/styxy allocate -s dev -n main-app        # → Port 3000
./bin/styxy allocate -s api -n user-service    # → Port 8000
./bin/styxy allocate -s storybook -n ui-lib    # → Port 6006

# Terminal 2: Claude Code Instance B (no conflicts!)
./bin/styxy allocate -s dev -n feature-branch  # → Port 3001
./bin/styxy allocate -s api -n auth-service    # → Port 8001
./bin/styxy allocate -s test -n e2e-tests      # → Port 9200

# Terminal 3: Monitoring
./bin/styxy list -v                            # See all allocations
./bin/styxy scan -s 3000 -e 9000              # Port usage overview
```

---

## 🚀 **Status: Production Ready & Fully Tested**

✅ **74/74 tests passing** (Unit + Integration + E2E)
✅ **Complete CLI implementation** with JSON support
✅ **Real-time port coordination** with zero race conditions
✅ **CORE documentation integration** with 13 service types
✅ **Cross-platform compatibility** (Node.js)
✅ **Comprehensive error handling** and state persistence

Styxy is **battle-tested** and ready for production use in multi-instance development environments. Perfect for Claude Code workflows, Firebase development, and complex microservice coordination.

## 🔒 Security

### Authentication
- **Secure token generation** using `crypto.randomBytes(32)`
- **File-based authentication** with 0600 permissions (user-only access)
- **Automatic token management** - tokens stored outside repository
- **Masked logging** - API keys are masked in logs for security

### Environment Controls
- `STYXY_SHOW_FULL_KEY=true` - Show full API key in logs (development only)
- `STYXY_SKIP_AUTH=true` - Disable authentication (testing only)

### Protected Files
All sensitive files are automatically excluded from version control:
- `*.token`, `*.key`, `*.secret` - Authentication files
- `.styxy/` - Configuration directory
- `auth.*` - Authentication-related files

**Get Started:** Clone → `npm install` → `node src/daemon.js --daemon` → Start coordinating! 🎉