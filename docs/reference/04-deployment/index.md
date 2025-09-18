# Deployment Documentation

This directory contains deployment and installation documentation.

## Installation

### Global Installation
```bash
npm install -g styxy
```

### Local Installation
```bash
# In project directory
npm install styxy
npx styxy daemon start
```

## Configuration

- Default daemon port: 9876
- Configuration directory: `~/.styxy/`
- CORE integration: Automatic from `config/core-ports.json`

## Service Management

### Systemd Service (Linux)
```bash
# Create service file for daemon auto-start
sudo systemctl enable styxy-daemon
```

### Manual Management
```bash
# Start/stop daemon manually
styxy daemon start --detach
styxy daemon stop
```