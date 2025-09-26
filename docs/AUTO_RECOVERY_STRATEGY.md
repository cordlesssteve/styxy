# Styxy Auto-Recovery Strategy

## Problem Statement

The Styxy daemon needs to:
1. Start automatically at system boot
2. Restart gracefully when killed (e.g., SIGKILL)
3. Never block Claude Code startup hooks
4. Require zero manual intervention

## 3-Layer Auto-Recovery Architecture

### Layer 1: Fast Session Hook (Immediate Response)
**Purpose**: Trigger daemon startup without blocking Claude startup

**Implementation**:
- Session hook detects daemon not running
- Issues async start command (systemctl or direct)
- Returns immediately (exit 0) - no waiting
- Provides user feedback that startup is in progress

**Key Principle**: Speed over verification - delegate recovery to other layers

### Layer 2: Reliable systemd Service (Primary Recovery)
**Purpose**: Handle daemon lifecycle with unlimited retries

**Configuration**:
```ini
[Service]
Restart=always                    # Always restart on failure
RestartSec=10                     # Quick restart interval
StartLimitIntervalSec=0          # No rate limiting - unlimited retries
TimeoutStartSec=60               # Generous startup timeout
KillSignal=SIGTERM               # Graceful shutdown
```

**Key Principle**: Persistence over intelligence - keep trying until successful

### Layer 3: Background Watchdog (Backup Recovery)
**Purpose**: Catch edge cases where systemd fails

**Implementation**:
- Timer runs every 5 minutes
- Checks daemon health (API response)
- Restarts service if unhealthy
- Independent of user sessions

**Key Principle**: Defense in depth - redundant recovery mechanism

## Recovery Scenarios

| Scenario | Layer 1 Response | Layer 2 Response | Layer 3 Response |
|----------|------------------|-------------------|-------------------|
| Clean shutdown | Start async | Restart in 10s | Monitor in <5min |
| SIGKILL | Start async | Restart in 10s | Monitor in <5min |
| Service corruption | Start async | Retry indefinitely | Force restart |
| systemd failure | Direct start fallback | N/A | Service restart |
| Boot startup | N/A | Auto-start enabled | Monitor after boot |

## Design Principles

1. **Graceful Degradation**: Each layer provides fallback for the previous
2. **Fail-Fast Hooks**: Never block Claude startup for daemon issues
3. **Eventual Consistency**: Daemon will eventually start, may take time
4. **Zero Manual Intervention**: System self-heals without user action
5. **Idempotent Operations**: Safe to trigger recovery multiple times

## Implementation Files

- **Session Hook**: `~/.claude/hooks/styxy-session-start.sh`
- **systemd Service**: `~/.config/systemd/user/styxy-daemon.service`
- **Watchdog Timer**: `~/.config/systemd/user/styxy-watchdog.{service,timer}`

## Expected Behavior

### Normal Operation
1. systemd starts daemon at boot
2. Daemon runs continuously
3. Session hooks report "already running"

### After SIGKILL
1. systemd detects process death
2. Waits 10 seconds
3. Restarts daemon automatically
4. Next Claude session sees running daemon

### During Claude Startup (daemon down)
1. Session hook detects daemon down
2. Issues start command immediately
3. Hook exits successfully with "starting" message
4. systemd/watchdog ensure daemon eventually starts

### Worst Case (all layers fail)
- Maximum downtime: 5 minutes (watchdog interval)
- Claude startup: Never blocked
- User experience: "Starting..." message, then works

## Monitoring

- **systemd logs**: `journalctl --user -u styxy-daemon -f`
- **Session hooks**: `~/.claude/logs/styxy-hooks.log`
- **Watchdog activity**: `journalctl --user -u styxy-watchdog.service -f`

This strategy prioritizes reliability and user experience over perfect uptime.