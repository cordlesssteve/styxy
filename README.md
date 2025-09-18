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

# Check port availability
styxy check 8000

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

# Information
styxy list                   # List all allocations
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

- [Design Document](./docs/DESIGN.md) - Comprehensive architecture and implementation details
- [API Reference](./docs/API.md) - Complete HTTP and CLI API documentation
- [Configuration Guide](./docs/CONFIGURATION.md) - Setup and customization options
- [Contributing](./CONTRIBUTING.md) - Development setup and contribution guidelines

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) for details on our code of conduct and development process.

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🎉 Acknowledgments

- Inspired by the need for better multi-instance development coordination
- Built for the Claude Code ecosystem but designed to be universally useful
- Thanks to the open source community for daemon architecture patterns

---

**Status**: 🚧 In Development

Styxy is currently in active development. The architecture is designed and the foundation is being implemented. See [Issues](https://github.com/cordlesssteve/styxy/issues) for current progress and roadmap.