# Styxy Sustainable Multi-Instance Setup

## ✅ Problem Solved

**Root Cause**: `"enableAllProjectMcpServers": true` caused every Claude Code instance to spawn its own styxy-server, creating 5+ duplicate processes and daemon conflicts.

**Sustainable Solution**: Implemented singleton behavior, service management, and monitoring.

## 🛠️ Components Implemented

### 1. **MCP Server Singleton** 
- **File**: `/home/cordlesssteve/mcp-servers/styxy-server/src/singleton.js`
- **Function**: Prevents multiple styxy-server MCP instances
- **Mechanism**: PID-based lock files in `~/.styxy/locks/`

### 2. **Systemd Service Management**
- **Service File**: `/home/cordlesssteve/.config/systemd/user/styxy-daemon.service`
- **Manager**: `/home/cordlesssteve/scripts/claude/styxy-service-manager.sh`
- **Function**: Reliable daemon lifecycle management with auto-restart

### 3. **Process Monitoring & Alerting**
- **Monitor**: `/home/cordlesssteve/scripts/claude/styxy-process-monitor.sh`
- **Function**: Detects and cleans up duplicate processes automatically
- **Alerts**: Desktop notifications and log-based alerting

### 4. **Improved Session Hook**
- **Hook**: `/home/cordlesssteve/scripts/claude/styxy-session-start-v2.sh`
- **Function**: Service-aware session initialization without daemon conflicts

## 🔧 How It Works

### Multi-Instance Flow:
1. **First Claude session**: 
   - Singleton lock acquired by styxy-server MCP
   - Daemon starts via systemd service
   - Process monitor begins watching

2. **Subsequent Claude sessions**:
   - styxy-server attempts to start → **singleton prevents it**
   - Daemon already running → **service management handles it**
   - Monitor detects any duplicates → **automatic cleanup**

3. **Session cleanup**:
   - MCP server exits → singleton lock released
   - Daemon continues running → **persistent across sessions**
   - Next session reuses existing daemon → **seamless handoff**

### Process Monitoring:
- **Continuous monitoring** every 30 seconds
- **Automatic cleanup** of duplicate processes
- **Desktop alerts** for anomalies
- **Detailed logging** in `~/.claude/logs/styxy-*.log`

## 📋 Current Status

```bash
# Service Status
✅ Styxy daemon: Running as systemd user service
✅ Auto-start: Enabled on boot
✅ Singleton: MCP server has lock-based prevention
✅ Monitoring: Process monitor active

# Installation Complete
✅ Service installed: ~/.config/systemd/user/styxy-daemon.service
✅ Scripts ready: ~/scripts/claude/styxy-*.sh
✅ Monitoring active: Automatic duplicate prevention
```

## 🎯 Usage Instructions

### For Daily Use:
- **No action needed** - everything runs automatically
- Claude sessions will use existing daemon
- Port allocation works seamlessly across all instances

### For Troubleshooting:

```bash
# Check overall status
~/scripts/claude/styxy-service-manager.sh check

# Check for duplicates
~/scripts/claude/styxy-process-monitor.sh status

# Restart daemon if needed
~/scripts/claude/styxy-service-manager.sh restart

# Force cleanup duplicates
~/scripts/claude/styxy-process-monitor.sh cleanup
```

### For Monitoring:

```bash
# Start continuous monitoring (if not running)
~/scripts/claude/styxy-process-monitor.sh monitor

# View service logs
~/scripts/claude/styxy-service-manager.sh logs

# Check daemon health
~/projects/Utility/styxy/bin/styxy daemon status
```

## 🔍 Verification

### Test Multi-Instance Behavior:
1. **Open 3 Claude Code sessions simultaneously**
2. **Expected**:
   - Only 1 styxy-server MCP process
   - Only 1 styxy daemon process  
   - All sessions can allocate ports
   - No conflicts or duplicate alerts

### Verify Logs:
```bash
# Check for singleton messages
grep "Singleton" ~/.claude/logs/styxy-*.log

# Check for service management
journalctl --user -u styxy-daemon --since "1 hour ago"

# Check monitoring alerts
cat ~/.claude/logs/styxy-alerts.log
```

## 🛡️ Reliability Features

### Auto-Recovery:
- **Daemon crashes**: Systemd auto-restarts (10s delay)
- **Duplicate processes**: Monitor detects and cleans up automatically
- **Stale locks**: Automatic cleanup on process death
- **Service failures**: Comprehensive logging and alerting

### Resource Protection:
- **Memory limits**: 256MB max per daemon
- **CPU limits**: 50% quota
- **File limits**: 65536 max file descriptors
- **Security**: Restricted permissions and private tmp

### Multi-Session Coordination:
- **Session isolation**: Each Claude session gets unique instance ID
- **Shared daemon**: All sessions use same daemon for coordination
- **Lock management**: PID-based locks prevent conflicts
- **Graceful handoff**: Daemon persists across session changes

## 🚀 Benefits Achieved

1. **✅ Sustainable**: No more manual process killing
2. **✅ Reliable**: Service management with auto-restart
3. **✅ Monitored**: Automatic duplicate detection and cleanup
4. **✅ Efficient**: Single daemon serves all Claude instances
5. **✅ Maintainable**: Clear logging and status reporting

## 🔄 Migration from Old System

The old session hook (`styxy-session-start.sh`) is still functional but deprecated. The new system (`styxy-session-start-v2.sh`) should be used in settings.local.json:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/home/cordlesssteve/scripts/claude/styxy-session-start-v2.sh"
          }
        ]
      }
    ]
  }
}
```

## ⚠️ Important Notes

1. **Service Restart**: Daemon restarts are now handled by systemd, not the session hooks
2. **Lock Cleanup**: Singleton locks are automatically cleaned up on process death
3. **Monitoring**: Process monitor should run continuously for best results
4. **Logs**: Monitor `~/.claude/logs/styxy-*.log` for any issues

This setup will reliably handle your multi-instance Claude environment without manual intervention.