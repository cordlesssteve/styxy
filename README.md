# Styxy

> A development port coordination daemon for multi-instance environments

Styxy intelligently manages port allocation and process coordination for Claude Code and other development tools, preventing conflicts when running multiple development servers, Firebase emulators, Storybook, and other services simultaneously.

## ⚡ Quick Start

```bash
# Install globally
npm install -g styxy

# Start the daemon
styxy daemon start

# Allocate a port for your development server
styxy allocate --service dev --port 8000

# Check port availability (with detailed system info)
styxy check 8000

# Scan for ports in use
styxy scan --start 3000 --end 9000

# Stop the daemon
styxy daemon stop
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

- ✅ **Eliminates ALL race conditions** - single process manages state
- ✅ **Real-time cleanup** - ports available immediately when services stop
- ✅ **No filesystem I/O** during normal operations (fast)
- ✅ **Atomic operations** - all allocations happen instantly
- ✅ **Cross-platform** - Node.js abstracts OS differences
- ✅ **Service-type aware** - understands dev vs test vs storybook requirements
- ✅ **Process monitoring** - tracks PID + start time for reliable validation
- ✅ **Auto-recovery** - graceful shutdown and state restoration

## 📚 API Reference

### CLI Commands

```bash
# Daemon management
styxy daemon start          # Start the coordination daemon
styxy daemon stop           # Stop the daemon
styxy daemon status         # Check daemon status
styxy daemon restart        # Restart daemon

# Port allocation
styxy allocate --service dev --port 8000    # Request specific port
styxy allocate --service test               # Get suggested port
styxy release <lock-id>                     # Release allocation
styxy check <port>                          # Check availability

# Information & Monitoring
styxy list                   # List all allocations
styxy scan                   # Scan for ports in use (system + Styxy)
styxy check <port>          # Detailed port availability & usage info
styxy instances             # Show active instances
styxy cleanup               # Force cleanup stale locks
```

### HTTP API

```bash
# Port Management
POST   /allocate           # Request port allocation
DELETE /allocate/{lockId}   # Release specific allocation
GET    /check/{port}       # Check port availability
GET    /suggest/{serviceType} # Get suggested port

# Instance Management
POST   /instance/register  # Register Claude instance
POST   /instance/heartbeat # Update instance liveness
GET    /instance/list      # List active instances

# Administrative
GET    /status            # Daemon health check
POST   /cleanup           # Force cleanup
GET    /allocations       # List all allocations
```

## 🛠️ Configuration

Styxy uses `~/.styxy/config.json`:

```json
{
  "listen_port": 9876,
  "log_level": "info",
  "cleanup_interval": 30,
  "service_types": {
    "dev": {"preferred_ports": [3000, 8000], "range": [8000, 8099]},
    "api": {"preferred_ports": [8000, 4000], "range": [8000, 8099]},
    "test": {"preferred_ports": [9000], "range": [9000, 9099]},
    "storybook": {"preferred_ports": [6006], "range": [6006, 6010]},
    "docs": {"preferred_ports": [4000], "range": [4000, 4099]}
  }
}
```

## 📖 Documentation

### Project Status
- **[Current Status](./CURRENT_STATUS.md)** - Real-time project status and progress
- **[Active Plan](./ACTIVE_PLAN.md)** - Current development priorities and tasks

### Technical Reference
- **[Architecture](./docs/reference/01-architecture/)** - System design and architecture details
- **[APIs](./docs/reference/02-apis/)** - HTTP REST API and CLI interface documentation
- **[Development](./docs/reference/03-development/)** - Development setup and contribution guidelines
- **[Deployment](./docs/reference/04-deployment/)** - Installation and configuration guides
- **[Security](./docs/reference/05-security/)** - Security model and considerations
- **[Integrations](./docs/reference/06-integrations/)** - CORE documentation and external system integration
- **[Troubleshooting](./docs/reference/07-troubleshooting/)** - Common issues and debugging guides
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

**Status**: ✅ Production Ready

Styxy is fully operational and ready for production use. All core features have been implemented and tested, including CORE documentation integration and multi-instance coordination. See [Current Status](./CURRENT_STATUS.md) for detailed progress and [Issues](https://github.com/cordlesssteve/styxy/issues) for future enhancements.