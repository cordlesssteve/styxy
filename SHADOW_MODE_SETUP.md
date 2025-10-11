# Styxy Shadow Mode - Quick Setup Guide

**Purpose:** Enable in-conversation port availability notices in Claude Code

## What is Shadow Mode?

Shadow Mode provides **non-blocking port conflict notifications** directly in your Claude Code conversations. When Claude tries to use a port that's already allocated, you'll receive helpful notices with actionable solutions—without blocking command execution.

## Quick Start (5 Minutes)

### Step 1: Copy Hook Scripts

```bash
# Scripts are already installed at:
ls -la ~/scripts/claude/styxy-shadow-notices.sh
ls -la ~/scripts/claude/styxy-post-execution-notices.sh

# Verify they're executable
chmod +x ~/scripts/claude/styxy-shadow-notices.sh
chmod +x ~/scripts/claude/styxy-post-execution-notices.sh
```

### Step 2: Add Hooks to Claude Code Settings

Edit `~/.claude/settings.json` and add these hooks:

```json
{
  "hooks": {
    "PreToolUse": [
      // ... existing hooks ...
      {
        "matcher": "Bash(*--port*)",
        "hooks": [
          {
            "type": "command",
            "command": "/home/cordlesssteve/scripts/claude/styxy-shadow-notices.sh"
          }
        ]
      },
      {
        "matcher": "Bash(python -m http.server*)",
        "hooks": [
          {
            "type": "command",
            "command": "/home/cordlesssteve/scripts/claude/styxy-shadow-notices.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash(*)",
        "hooks": [
          {
            "type": "command",
            "command": "/home/cordlesssteve/scripts/claude/styxy-post-execution-notices.sh"
          }
        ]
      }
    ]
  }
}
```

### Step 3: Restart Styxy Daemon

```bash
# Restart daemon to enable dry-run support
styxy daemon stop
styxy daemon start

# Verify it's running
styxy status
```

### Step 4: Test It

```bash
# Allocate a port
styxy allocate dev test-service --preferred 8080

# In Claude Code, try to use that port
# The shadow notice should warn you before execution
```

## What You'll See

### Before Command Execution (PreToolUse)

When Claude Code tries to use an allocated port:

```
⚠️ Port 8080 is already allocated to 'test-service' (dev)

💡 Suggested available port for dev: 8081
📋 Run: styxy allocate dev <service-name> --preferred 8081
📊 View all allocations: styxy list

The command will execute, but you may encounter port conflicts.
```

### After Command Failure (PostToolUse)

When a port conflict error occurs:

```
🚫 **PORT CONFLICT DETECTED**

The command failed because port 8080 is already in use.

📌 **Allocated by Styxy:**
   - Service: test-service
   - Instance: claude-main

**🔧 SOLUTIONS:**

**Option 1: Let Styxy allocate a port automatically**
```bash
styxy allocate dev <service-name>
```

[... more solutions ...]
```

## Logging

Hooks log to these files for debugging:

```bash
# Shadow notices (PreToolUse)
~/.claude/logs/styxy-shadow-notices.log

# Conflict detection (PostToolUse)
~/.claude/logs/styxy-post-notices.log
```

**Monitor in real-time:**
```bash
tail -f ~/.claude/logs/styxy-shadow-notices.log
```

## How It Works

```
Claude Code Command
        │
        ▼
┌───────────────────┐
│  PreToolUse Hook  │  ← Checks if port is available
│  (Shadow Notice)  │    Shows warning if allocated
└───────────────────┘
        │
        ▼ (command always executes)
┌───────────────────┐
│  Command Runs     │  ← May succeed or fail
└───────────────────┘
        │
        ▼ (if exit code != 0)
┌───────────────────┐
│  PostToolUse Hook │  ← Detects port conflict errors
│  (Conflict Help)  │    Shows actionable solutions
└───────────────────┘
```

## Key Design Principles

1. **Never blocks execution** - Commands always run
2. **Informative, not intrusive** - Only shows notices when conflicts detected
3. **Actionable solutions** - Every notice includes how to fix the issue
4. **Fail gracefully** - If daemon is down, hooks don't show errors

## Troubleshooting

### No notices appearing?

```bash
# 1. Check hooks are configured
cat ~/.claude/settings.json | grep -A 5 "PostToolUse"

# 2. Check scripts are executable
ls -la ~/scripts/claude/styxy-*.sh

# 3. Check logs for errors
tail ~/.claude/logs/styxy-shadow-notices.log

# 4. Verify daemon is running
styxy status
```

### Too many notices?

Refine matchers to be more specific:
```json
{
  "matcher": "Bash(*--port [0-9]*)",  // Only explicit port numbers
  "hooks": [...]
}
```

### Daemon not responding?

```bash
# Restart daemon
styxy daemon stop
styxy daemon start

# Check status
curl http://localhost:9876/status
```

## Integration with Existing Hooks

Shadow Mode **complements** your existing PreToolUse allocation hooks:

- **Allocation hooks** (specific matchers): Actively allocate ports for known tools
- **Shadow notices** (generic matchers): Passively warn about any port usage

They work together for comprehensive coverage!

## Next Steps

- Read [full documentation](./docs/reference/03-development/SHADOW_MODE_NOTICES.md)
- Customize notice matchers for your workflow
- Report issues or suggestions on GitHub

## Quick Reference

### Enable Shadow Mode
```bash
# Add hooks to ~/.claude/settings.json
# Restart daemon
styxy daemon restart
```

### Disable Shadow Mode
```bash
# Remove PostToolUse hooks from ~/.claude/settings.json
# Restart Claude Code
```

### Check Logs
```bash
tail -f ~/.claude/logs/styxy-shadow-notices.log
tail -f ~/.claude/logs/styxy-post-notices.log
```

### Test Manually
```bash
~/scripts/claude/styxy-shadow-notices.sh Bash "python -m http.server 8080"
```

---

**Need help?** Check the [troubleshooting guide](./docs/reference/07-troubleshooting/COMMON_ISSUES.md) or open an issue.
