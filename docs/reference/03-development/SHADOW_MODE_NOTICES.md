# Styxy Shadow Mode - In-Conversation Port Notices

**Status:** Active
**Last Updated:** 2025-10-10
**Category:** Development Integration

## Overview

Styxy's **Shadow Mode** is a non-blocking notification system that provides real-time port availability context directly in Claude Code conversations. Unlike the PreToolUse hooks that actively intercept and modify commands, Shadow Mode operates passively—informing Claude Code about port conflicts without blocking execution.

### The Problem

Claude Code often needs to start development servers, but it doesn't always check Styxy for port allocation. This can lead to:
- Port conflicts that fail silently or with cryptic errors
- Manual intervention required to resolve conflicts
- Wasted time debugging "address already in use" errors
- Lack of visibility into what ports are available

### The Solution

Shadow Mode provides **passive, informative notices** at two key points:

1. **Before Command Execution** - Warns if a port is already allocated
2. **After Command Failure** - Provides actionable solutions when port conflicts occur

## Architecture

### Three-Layer Notice System

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: PreToolUse Shadow Notices                 │
│  ├─ Detects explicit ports in commands              │
│  ├─ Checks Styxy allocation registry                │
│  └─ Provides warning if port unavailable            │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Command Execution                         │
│  ├─ Command runs with original parameters           │
│  ├─ May succeed or fail                             │
│  └─ Output captured for analysis                    │
└─────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: PostToolUse Conflict Detection            │
│  ├─ Analyzes stderr/stdout for port errors          │
│  ├─ Extracts conflicting port number                │
│  └─ Provides actionable solutions                   │
└─────────────────────────────────────────────────────┘
```

## Components

### 1. Shadow Notice Hook (PreToolUse)

**Script:** `~/.claude/hooks/styxy-shadow-notices.sh`

**Purpose:** Provides early warning when Claude Code attempts to use an allocated port

**Features:**
- Extracts port numbers from command arguments
- Queries Styxy daemon for port availability
- Identifies who/what is using the port
- Suggests available alternatives
- **Never blocks execution** - always allows command to proceed

**Example Notice:**
```
⚠️ Port 8080 is already allocated to 'react-dev' (dev) by instance 'claude-main'

💡 Suggested available port for dev: 3000
📋 Run: styxy allocate dev <service-name> --preferred 3000
📊 View all allocations: styxy list

The command will execute, but you may encounter port conflicts.
```

### 2. Post-Execution Conflict Detection (PostToolUse)

**Script:** `~/.claude/hooks/styxy-post-execution-notices.sh`

**Purpose:** Detects port conflict errors after command execution and provides solutions

**Features:**
- Pattern-matches common port conflict errors:
  - "address already in use"
  - "EADDRINUSE"
  - "port already in use"
  - "bind failed"
  - "port taken"
- Extracts port number from error messages
- Queries Styxy for allocation details
- Provides 4 actionable solution paths

**Example Notice:**
```
🚫 **PORT CONFLICT DETECTED**

The command failed because port 3000 is already in use.

📌 **Allocated by Styxy:**
   - Service: nextjs-dev
   - Instance: claude-instance-2

**🔧 SOLUTIONS:**

**Option 1: Let Styxy allocate a port automatically**
```bash
styxy allocate dev <service-name>
```

**Option 2: Use a specific available port**
Suggested ports for dev services: 3001, 3002, 3003
```bash
styxy allocate dev <service-name> --preferred <PORT>
```

**Option 3: Review all port allocations**
```bash
styxy list          # See all allocations
styxy cleanup       # Clean up stale allocations
```

**Option 4: Use a different port manually**
Modify your command to use a different port (outside managed ranges).
```

### 3. Daemon Dry-Run Support

**Endpoint:** `POST /allocate` with `dry_run: true`

**Purpose:** Allow hooks to query what port WOULD be allocated without actually allocating it

**Request:**
```json
{
  "service_type": "dev",
  "service_name": "shadow-query-temp",
  "instance_id": "shadow-mode",
  "dry_run": true
}
```

**Response:**
```json
{
  "success": true,
  "port": 3000,
  "dry_run": true,
  "message": "Port 3000 would be allocated (dry run mode)",
  "service_type": "dev",
  "service_name": "shadow-query-temp"
}
```

## Configuration

### Enabling Shadow Mode

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
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
        "matcher": "Bash(*:*)",
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

### Hook Matchers

**PreToolUse Matchers** (trigger shadow notices):
- `Bash(*--port*)` - Any bash command with `--port` flag
- `Bash(*-p *)` - Any bash command with `-p` port flag
- `Bash(python -m http.server*)` - Python simple HTTP server
- `Bash(*PORT=*)` - Environment variable port assignment
- `Bash(php -S *)` - PHP built-in server

**PostToolUse Matcher** (trigger conflict detection):
- `Bash(*)` - Analyze all bash command failures

### Environment Variables

```bash
# Styxy daemon URL (default: http://localhost:9876)
export STYXY_URL="http://localhost:9876"

# Styxy config directory (default: ~/.styxy)
export STYXY_CONFIG_DIR="${HOME}/.styxy"

# Hook log directory (default: ~/.claude/logs)
export HOOK_LOG_DIR="${HOME}/.claude/logs"
```

## Usage Examples

### Example 1: Port Already Allocated

**Scenario:** Claude Code tries to start a dev server on port 3000, which is already in use.

**Command:**
```bash
npm run dev -- --port 3000
```

**Shadow Notice (PreToolUse):**
```
⚠️ Port 3000 is already allocated to 'vite-dev' (dev) by instance 'claude-main'

💡 Suggested available port for dev: 3001
📋 Run: styxy allocate dev my-service --preferred 3001

The command will execute, but you may encounter port conflicts.
```

**Command Executes:** The command runs but fails with EADDRINUSE.

**Conflict Notice (PostToolUse):**
```
🚫 **PORT CONFLICT DETECTED**

The command failed because port 3000 is already in use.

📌 **Allocated by Styxy:**
   - Service: vite-dev
   - Instance: claude-main

[Solutions listed...]
```

### Example 2: System Process Using Port

**Scenario:** Port 8080 is in use by a system process (not managed by Styxy).

**Command:**
```bash
python -m http.server 8080
```

**Shadow Notice:**
```
⚠️ Port 8080 is in use by system process: nginx
💡 This port is being used outside of Styxy coordination
📊 View all allocations: styxy list
```

### Example 3: Port Available

**Scenario:** Claude Code uses a port that's available.

**Command:**
```bash
npm run dev -- --port 3005
```

**Notice:** None (command executes successfully, no conflict detected).

## Design Principles

### 1. Never Block Execution

Shadow Mode **always allows commands to proceed**, even when conflicts are detected. This prevents disrupting Claude Code's workflow while still providing helpful context.

**Rationale:** Claude Code should be able to make its own decisions. Shadow Mode informs but doesn't interfere.

### 2. Actionable Information Only

Notices only appear when:
- A port conflict is detected
- Actionable solutions are available
- The information is immediately useful

**Anti-pattern:** Showing notices for every command or providing generic "port is available" messages.

### 3. Progressive Disclosure

Information is provided at the right time:
- **Early warning** (PreToolUse): "Heads up, this port is taken"
- **Post-failure** (PostToolUse): "Here's how to fix it"

### 4. Fail Gracefully

If the Styxy daemon is unreachable:
- Log the error
- Allow command to proceed
- Don't show cryptic error notices to Claude Code

## Integration with Existing Hooks

Shadow Mode **complements** the existing PreToolUse allocation hooks:

### PreToolUse Allocation Hook (Active)
- **Matchers:** Specific dev server commands (npm dev, cypress, etc.)
- **Behavior:** Intercepts, allocates port, modifies command
- **Coverage:** ~98% of common dev tools

### Shadow Notice Hook (Passive)
- **Matchers:** Generic port patterns (--port, -p, PORT=, :port)
- **Behavior:** Checks availability, warns, allows execution
- **Coverage:** Any command with a port number

### Why Both?

1. **Allocation hooks** handle known patterns proactively
2. **Shadow notices** catch everything else reactively
3. **Together** they provide comprehensive coverage

**Priority:** Allocation hooks run first (more specific matchers). If they don't match, shadow notices may trigger.

## Logging & Debugging

### Log Files

**Shadow Notices:**
```bash
~/.claude/logs/styxy-shadow-notices.log
```

**Post-Execution Notices:**
```bash
~/.claude/logs/styxy-post-notices.log
```

### Log Format

```
[2025-10-10 16:49:33] [ShadowNotices] Shadow mode analyzing command: Bash python -m http.server 8080
[2025-10-10 16:49:35] [ShadowNotices] Found port 8080 in command, checking availability
[2025-10-10 16:49:36] [ShadowNotices] Port 8080 is available (no notice needed)
```

### Debugging Tips

**Check if hooks are firing:**
```bash
tail -f ~/.claude/logs/styxy-shadow-notices.log
tail -f ~/.claude/logs/styxy-post-notices.log
```

**Test shadow notices manually:**
```bash
~/.claude/hooks/styxy-shadow-notices.sh Bash "python -m http.server 8080"
```

**Verify daemon connectivity:**
```bash
curl http://localhost:9876/status
```

## Performance Considerations

### Hook Execution Time

- **Shadow Notice Check:** ~200ms (includes Styxy API call)
- **Post-Execution Analysis:** ~50ms (pattern matching only)
- **Impact:** Minimal - hooks run asynchronously

### Optimization Strategies

1. **Timeout Protection:** API calls timeout after 5 seconds
2. **Caching:** Daemon maintains allocation cache (no disk I/O)
3. **Early Exit:** If port not found in command, skip processing
4. **Dry Run:** Lightweight query without state modification

### When to Disable

Disable shadow mode if:
- Daemon is consistently unreachable (adds 5s timeout delay)
- You're working offline without Styxy
- Notices become too noisy for your workflow

**Disable command:**
```bash
# Remove PostToolUse hook from ~/.claude/settings.json
```

## Troubleshooting

### Issue: No notices appearing

**Diagnosis:**
```bash
# Check if hooks are configured
cat ~/.claude/settings.json | grep -A 5 "PostToolUse"

# Check if scripts are executable
ls -la ~/.claude/hooks/styxy-*.sh

# Check logs
tail ~/.claude/logs/styxy-shadow-notices.log
```

**Solution:**
```bash
# Make scripts executable
chmod +x ~/.claude/hooks/styxy-shadow-notices.sh
chmod +x ~/.claude/hooks/styxy-post-execution-notices.sh

# Restart Claude Code
```

### Issue: Daemon not responding

**Diagnosis:**
```bash
# Check daemon status
styxy status

# Check if daemon is running
ps aux | grep styxy

# Test API directly
curl http://localhost:9876/status
```

**Solution:**
```bash
# Start daemon
styxy daemon start

# Verify startup
styxy status
```

### Issue: Incorrect port extraction

**Diagnosis:**
Check logs for "Found port X in command" messages.

**Solution:**
Update port extraction regex in `extract_port_from_command()` function.

### Issue: Too many notices

**Diagnosis:**
Notices appearing for commands that shouldn't trigger them.

**Solution:**
Refine PreToolUse matchers to be more specific:
```json
{
  "matcher": "Bash(*--port [0-9]*)",  // Only match explicit port numbers
  "hooks": [...]
}
```

## Future Enhancements

### Planned Features

1. **Smart Notice Suppression**
   - Remember which notices Claude Code acknowledged
   - Only show each unique notice once per session

2. **Allocation Suggestions API**
   - `/suggest` endpoint that returns best ports for a service type
   - Considers current allocations, patterns, and history

3. **Visual Port Map**
   - ASCII art visualization of port ranges and allocations
   - Included in notices for better context

4. **Integration with Claude Code MCP**
   - Direct MCP tool instead of bash hooks
   - Richer data structures and error handling

### Community Requests

- **Custom notice templates** - Allow users to customize notice format
- **Slack/Discord notifications** - Post notices to team channels
- **Metric tracking** - Count how often conflicts occur, which ports conflict most

## Related Documentation

- [PreToolUse Hooks](./CLAUDE_CODE_HOOKS.md) - Active port allocation hooks
- [Daemon API Reference](../02-apis/DAEMON_API.md) - API endpoints and usage
- [Port Management Standard](../01-architecture/PORT_MANAGEMENT.md) - Port allocation strategy
- [Troubleshooting Guide](../07-troubleshooting/COMMON_ISSUES.md) - General troubleshooting

## Contributing

Shadow Mode is designed to be extensible. To add new notice types:

1. **Add extraction pattern** in `extract_port_from_command()`
2. **Add conflict pattern** in `detect_port_conflict()`
3. **Update matchers** in `~/.claude/settings.json`
4. **Test** with real scenarios
5. **Document** in this file

**Submit enhancements:** Open PR in [Styxy repository](https://github.com/yourusername/styxy)
