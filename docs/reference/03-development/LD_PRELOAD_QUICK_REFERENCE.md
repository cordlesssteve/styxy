# LD_PRELOAD Quick Reference

**One-page cheat sheet for Styxy's automatic port reassignment**

## Quick Status Check

```bash
# Is LD_PRELOAD active?
echo $LD_PRELOAD
# Expected: /home/username/lib/styxy-intercept.so

# Is daemon running?
node bin/styxy instances

# View recent reassignments
tail -5 /tmp/styxy-reassignments.log
```

## Common Commands

### Run with automatic reassignment (default)
```bash
python3 -m http.server 8000
npm start
./your-app --port 6006
```

### Temporarily disable for one command
```bash
LD_PRELOAD="" python3 -m http.server 8000
```

### Disable for entire session
```bash
unset LD_PRELOAD
```

### Re-enable for session
```bash
export LD_PRELOAD="${HOME}/lib/styxy-intercept.so"
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `LD_PRELOAD` | `~/lib/styxy-intercept.so` | Enable/disable interception |
| `STYXY_DAEMON_PORT` | `9876` | Override daemon port |
| `STYXY_DAEMON_HOST` | `127.0.0.1` | Override daemon host |
| `STYXY_DISABLE_REASSIGN` | `0` | Set to `1` to disable reassignment |

## Examples

### Example 1: Python server on busy port
```bash
$ python3 -m http.server 8000
✓ STYXY: Port 8000 was in use, auto-assigned port 3001
Serving HTTP on 0.0.0.0 port 3001 ...
```

### Example 2: Node.js with conflict
```bash
$ npm start
✓ STYXY: Port 3000 was in use, auto-assigned port 3002
Server listening on port 3002
```

### Example 3: Multiple conflicts
```bash
$ python3 -m http.server 3001
✓ STYXY: Port 3001 was in use, auto-assigned port 3002
```

## Troubleshooting Quick Fixes

### Problem: No reassignment happening
```bash
# Check LD_PRELOAD is set
echo $LD_PRELOAD

# If empty, set it
export LD_PRELOAD="${HOME}/lib/styxy-intercept.so"

# Check daemon is running
node bin/styxy instances
```

### Problem: Library not found
```bash
# Verify library exists
ls -lh ~/lib/styxy-intercept.so

# If missing, needs to be compiled (contact dev team)
```

### Problem: Can't see notifications
```bash
# Check audit log instead
tail -f /tmp/styxy-reassignments.log
```

### Problem: Daemon not responding
```bash
# Check daemon status
curl -s http://localhost:9876/status

# With authentication
TOKEN=$(cat ~/.styxy/auth.token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:9876/status
```

## Audit Log Format

```
[2025-10-11 19:25:22] PID 110548: Port 8000 -> 3001 (service: dev)
│                     │          │              │           └─ Service type
│                     │          │              └─ Reassigned port
│                     │          └─ Original port
│                     └─ Process ID
└─ Timestamp
```

## Port Ranges by Service Type

| Service Type | Port Range | Example Uses |
|--------------|------------|--------------|
| dev | 3000-3099 | General development servers |
| api | 8000-8099 | REST APIs, GraphQL |
| database | 5430-5499 | PostgreSQL, MySQL |
| test | 9000-9099 | Test runners |
| storybook | 6000-6049 | Storybook servers |
| docs | 4000-4099 | Documentation sites |
| monitoring | 9100-9199 | Prometheus, Grafana |
| infrastructure | 6370-6399 | Redis, caches |
| ai | 11400-11499 | Ollama, LLMs |
| messaging | 9050-9098 | Kafka, RabbitMQ |

## Common Use Cases

### Development server on different port
```bash
# Your server tries 3000, gets 3001
npm run dev
# Access at http://localhost:3001
```

### Testing with multiple instances
```bash
# Terminal 1
python3 -m http.server 8000  # Gets 8000

# Terminal 2
python3 -m http.server 8000  # Gets 8001 automatically
```

### Docker conflicts
```bash
# Host port 5432 used by PostgreSQL container
# Your local postgres tries 5432, gets 5433
postgres -D data -p 5432
```

## Advanced Usage

### Custom daemon port
```bash
export STYXY_DAEMON_PORT=9877
python3 -m http.server 8000
```

### Disable reassignment temporarily
```bash
export STYXY_DISABLE_REASSIGN=1
python3 -m http.server 8000  # Will fail if port busy
unset STYXY_DISABLE_REASSIGN
```

### Check what port was assigned
```bash
# Method 1: Read application output
python3 -m http.server 8000
# Shows: Serving HTTP on ... port 3001

# Method 2: Check audit log
cat /tmp/styxy-reassignments.log | tail -1
# [2025-10-11 19:25:22] PID 110548: Port 8000 -> 3001 (service: dev)

# Method 3: Use Styxy CLI
node bin/styxy list
```

## Files & Locations

| Item | Location |
|------|----------|
| LD_PRELOAD Library | `~/lib/styxy-intercept.so` |
| SessionStart Hook | `~/.claude/hooks/session-start.sh` |
| Audit Log | `/tmp/styxy-reassignments.log` |
| Auth Token | `~/.styxy/auth.token` |
| Daemon Binary | `./bin/styxy` |
| Configuration | `~/.styxy/config.json` |

## What Gets Intercepted?

✅ **Intercepted:**
- TCP IPv4 bind() on ports >= 1024
- Python servers, Node.js servers, Go servers
- Any compiled application (C, Rust, etc.)

❌ **Not Intercepted:**
- Privileged ports (< 1024) - require root
- IPv6 sockets - pass through unchanged
- UDP sockets - pass through unchanged
- Containers - LD_PRELOAD doesn't cross boundaries

## Performance

| Scenario | Overhead |
|----------|----------|
| Port available | ~0.01ms |
| Port conflict (first suggestion works) | ~50-100ms |
| Multiple conflicts | ~50-100ms per retry |

## Getting Help

```bash
# Check system status
node bin/styxy doctor

# View daemon logs
~/.styxy/logs/styxy-$(date +%Y-%m-%d).log

# View hook logs
~/.claude/logs/styxy-hooks.log

# Full documentation
cat docs/reference/03-development/LD_PRELOAD_MODE.md
```

## Quick Disable/Enable

### Permanently disable
Edit `~/.claude/hooks/session-start.sh`:
```bash
# Comment out this line:
# echo "export LD_PRELOAD=\"${LDPRELOAD_LIB}\""
```

### Permanently enable
Edit `~/.claude/hooks/session-start.sh`:
```bash
# Uncomment this line:
echo "export LD_PRELOAD=\"${LDPRELOAD_LIB}\""
```

---

**Full documentation:** [LD_PRELOAD_MODE.md](./LD_PRELOAD_MODE.md)
