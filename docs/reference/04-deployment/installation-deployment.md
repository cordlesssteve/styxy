# Installation & Deployment Guide

Installation, configuration, and deployment options for Styxy.

## Installation

### From Source (Recommended)
```bash
# Clone the repository
git clone https://github.com/cordlesssteve/styxy.git
cd styxy

# Install dependencies
npm install

# Verify installation
npm test

# Start daemon
node src/daemon.js --daemon
```

### Manual Download
```bash
# Download and extract release
wget https://github.com/cordlesssteve/styxy/archive/main.zip
unzip main.zip && cd styxy-main
npm install
```

## Configuration

### Default Settings
- **Daemon Port**: 9876 (configurable via `STYXY_DAEMON_PORT`)
- **Configuration Directory**: `~/.styxy/`
- **Service Types**: Auto-loaded from CORE documentation
- **State File**: `~/.styxy/state.json`

### CORE Integration
Styxy automatically loads 13 service types from:
```
~/docs/CORE/PORT_REFERENCE_GUIDE.md
```

### Custom Configuration
Override defaults at `~/.styxy/config.json`:
```json
{
  "listen_port": 9876,
  "cleanup_interval": 30,
  "service_types": {
    "custom": {
      "preferred_ports": [9500, 9501],
      "range": [9500, 9599],
      "description": "Custom services"
    }
  }
}
```

## Deployment Options

### Development Environment
```bash
# Quick start for development
node src/daemon.js --daemon --port 9876

# Background with logging
nohup node src/daemon.js --daemon > ~/.styxy/daemon.log 2>&1 &
```

### Production Environment

#### Option 1: Systemd Service (Linux)
Create `/etc/systemd/system/styxy-daemon.service`:
```ini
[Unit]
Description=Styxy Port Coordination Daemon
After=network.target

[Service]
Type=simple
User=developer
WorkingDirectory=/path/to/styxy
ExecStart=/usr/bin/node src/daemon.js --daemon
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start service
sudo systemctl enable styxy-daemon
sudo systemctl start styxy-daemon
sudo systemctl status styxy-daemon
```

#### Option 2: Process Manager (PM2)
```bash
# Install PM2
npm install -g pm2

# Start with PM2
pm2 start src/daemon.js --name styxy-daemon -- --daemon

# Save PM2 configuration
pm2 save
pm2 startup
```

#### Option 3: Docker Container
```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --production

COPY src/ ./src/
COPY bin/ ./bin/

EXPOSE 9876

CMD ["node", "src/daemon.js", "--daemon", "--port", "9876"]
```

```bash
# Build and run
docker build -t styxy .
docker run -d -p 9876:9876 --name styxy-daemon styxy
```

### Multi-Instance Setup
For multiple development teams:
```bash
# Team A - Port 9876
STYXY_DAEMON_PORT=9876 node src/daemon.js --daemon

# Team B - Port 9877
STYXY_DAEMON_PORT=9877 node src/daemon.js --daemon

# Configure clients
export STYXY_DAEMON_PORT=9876  # Team A
export STYXY_DAEMON_PORT=9877  # Team B
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STYXY_DAEMON_PORT` | 9876 | Daemon HTTP port |
| `DEBUG` | - | Debug output (`styxy:*`) |
| `NODE_ENV` | - | Environment mode |

## Security Considerations

### Network Security
- Daemon binds to `127.0.0.1` (localhost only)
- No authentication required (local development assumption)
- Use firewall rules for additional protection

### File Permissions
```bash
# Secure configuration directory
chmod 700 ~/.styxy/
chmod 600 ~/.styxy/config.json
chmod 600 ~/.styxy/state.json
```

### Production Hardening
- Run daemon as non-root user
- Use dedicated service account
- Limit resource usage with systemd
- Monitor daemon health

## Monitoring & Health Checks

### Health Check Endpoint
```bash
# Check daemon status
curl -s http://127.0.0.1:9876/status | jq

# Expected response
{
  "status": "running",
  "uptime": 3600,
  "allocations_count": 5,
  "instances_count": 2
}
```

### Log Monitoring
```bash
# With systemd
journalctl -u styxy-daemon -f

# With PM2
pm2 logs styxy-daemon

# Manual logging
node src/daemon.js --daemon > ~/.styxy/daemon.log 2>&1
```

### Metrics Collection
```bash
# Basic metrics via API
curl -s http://127.0.0.1:9876/allocations | jq length
curl -s http://127.0.0.1:9876/instance/list | jq '.instances | length'
```

## Backup & Recovery

### State Backup
```bash
# Backup daemon state
cp ~/.styxy/state.json ~/.styxy/state.json.backup

# Restore state (daemon must be stopped)
cp ~/.styxy/state.json.backup ~/.styxy/state.json
```

### Configuration Backup
```bash
# Backup entire configuration
tar -czf styxy-config-backup.tar.gz ~/.styxy/
```

## Troubleshooting Deployment

### Port Conflicts
```bash
# Check if port 9876 is available
lsof -i :9876
netstat -tlnp | grep 9876

# Use alternative port
STYXY_DAEMON_PORT=9877 node src/daemon.js --daemon
```

### Permission Issues
```bash
# Check file permissions
ls -la ~/.styxy/

# Fix permissions
chmod 755 ~/.styxy/
chmod 644 ~/.styxy/*
```

### Service Failures
```bash
# Check systemd service
sudo systemctl status styxy-daemon
sudo journalctl -u styxy-daemon --since today

# Check PM2 process
pm2 status
pm2 logs styxy-daemon --lines 50
```

## Performance Tuning

### Resource Limits
```bash
# For systemd service, add to [Service] section:
MemoryMax=128M
CPUQuota=25%
```

### Cleanup Optimization
```json
{
  "cleanup_interval": 60,  # Increase for less frequent cleanup
  "cache_ttl": 30         # Port scanner cache duration
}
```

This deployment guide ensures Styxy runs reliably in both development and production environments.