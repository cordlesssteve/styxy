# LD_PRELOAD Automatic Port Reassignment

**Status:** Production Ready
**Version:** 1.0
**Last Updated:** 2025-10-11

## Overview

Styxy's LD_PRELOAD mode provides **automatic port reassignment** for any application that tries to bind to an occupied port. When enabled, if a program attempts to use a port that's already in use, Styxy automatically reassigns it to an available alternative port.

### Key Benefits

- **Universal**: Works with ANY language (Python, Node.js, Go, Rust, C, etc.)
- **Transparent**: Applications don't need modification
- **Automatic**: Zero manual intervention required
- **Visible**: Claude sees reassignment notifications in command output
- **Fail-safe**: Gracefully handles daemon unavailability

### How It Works

When a Claude Code session starts, the SessionStart hook automatically sets the `LD_PRELOAD` environment variable to load Styxy's shared library. This library intercepts all `bind()` system calls:

1. Application tries to bind to a port (e.g., port 8000)
2. If port is available → bind succeeds normally
3. If port is occupied → Styxy queries daemon for suggestions
4. Library automatically binds to suggested port (e.g., 3001)
5. Application runs successfully on the reassigned port
6. Claude sees notification: "✓ STYXY: Port 8000 was in use, auto-assigned port 3001"

## Getting Started

### Verify LD_PRELOAD Mode is Active

When you start a new Claude Code session, you should see:

```
🔧 Styxy LD_PRELOAD mode active - automatic port reassignment enabled
✅ Styxy port coordination active (Instance: claude-code-...)
```

If you see these messages, automatic port reassignment is working.

### Check Current Status

```bash
# Check if LD_PRELOAD is set
echo $LD_PRELOAD
# Output: /home/username/lib/styxy-intercept.so

# Verify library exists
ls -lh ~/lib/styxy-intercept.so
# Output: -rwxr-xr-x 1 user user 17K Oct 11 22:17 /home/username/lib/styxy-intercept.so

# Check daemon is running
node bin/styxy instances
```

## Usage Examples

### Example 1: Python HTTP Server

```bash
# Start Python server on port 8000 (occupied by chroma)
python3 -m http.server 8000
```

**Output:**
```
✓ STYXY: Port 8000 was in use, auto-assigned port 3001
Serving HTTP on 0.0.0.0 port 3001 (http://0.0.0.0:3001/) ...
```

The server automatically runs on port 3001 instead!

### Example 2: Node.js Development Server

```bash
# npm start tries to use port 3000 (already in use)
npm start
```

**Output:**
```
✓ STYXY: Port 3000 was in use, auto-assigned port 3002
Server listening on port 3002
```

### Example 3: Custom Application

```bash
# Your application tries port 6006
./my-app --port 6006
```

**Output:**
```
✓ STYXY: Port 6006 was in use, auto-assigned port 6007
Application started on port 6007
```

### Example 4: Multiple Conflicts

If the first suggestion is also busy, Styxy tries the next available port automatically:

```bash
python3 -m http.server 3001
```

**Output:**
```
✓ STYXY: Port 3001 was in use, auto-assigned port 3002
Serving HTTP on 0.0.0.0 port 3002 ...
```

## How Applications See the Reassigned Port

Applications use the **reassigned port** automatically. Here's what happens:

```c
// Your application code
int sockfd = socket(AF_INET, SOCK_STREAM, 0);
struct sockaddr_in addr;
addr.sin_port = htons(8000);  // You request port 8000

// LD_PRELOAD intercepts bind()
bind(sockfd, (struct sockaddr*)&addr, sizeof(addr));

// Library automatically changes addr.sin_port to 3001 if 8000 is busy
// Your application proceeds with port 3001, completely unaware

getsockname(sockfd, ...);  // Returns port 3001
// Your application logs: "Server started on port 3001"
```

## Configuration

### Environment Variables

You can customize LD_PRELOAD behavior with these environment variables:

#### `STYXY_DAEMON_PORT`
Override the daemon port (default: 9876)

```bash
export STYXY_DAEMON_PORT=9877
```

#### `STYXY_DAEMON_HOST`
Override the daemon host (default: 127.0.0.1)

```bash
export STYXY_DAEMON_HOST=192.168.1.100
```

#### `STYXY_DISABLE_REASSIGN`
Temporarily disable automatic reassignment

```bash
export STYXY_DISABLE_REASSIGN=1
python3 -m http.server 8000  # Will fail if port busy instead of reassigning
```

#### `LD_PRELOAD`
Manually control LD_PRELOAD activation

```bash
# Disable for a single command
LD_PRELOAD="" python3 -m http.server 8000

# Re-enable
export LD_PRELOAD="${HOME}/lib/styxy-intercept.so"
```

### Disabling LD_PRELOAD Mode

To disable automatic port reassignment for your session:

```bash
unset LD_PRELOAD
```

To permanently disable, comment out the export line in `~/.claude/hooks/session-start.sh`:

```bash
# echo "export LD_PRELOAD=\"${LDPRELOAD_LIB}\""
```

## Audit Logging

All port reassignments are logged to `/tmp/styxy-reassignments.log`:

```bash
cat /tmp/styxy-reassignments.log
```

**Example output:**
```
[2025-10-11 19:25:22] PID 110548: Port 8000 -> 3001 (service: dev)
[2025-10-11 19:29:44] PID 121458: Port 8000 -> 3001 (service: dev)
[2025-10-11 19:42:09] PID 147965: Port 8000 -> 3001 (service: dev)
```

Each entry shows:
- Timestamp
- Process ID
- Original port → Reassigned port
- Service type (used for selecting port range)

## Troubleshooting

### "Port conflict but no reassignment happened"

**Possible causes:**

1. **LD_PRELOAD not set**
   ```bash
   echo $LD_PRELOAD
   # If empty, run: export LD_PRELOAD="${HOME}/lib/styxy-intercept.so"
   ```

2. **Library doesn't exist**
   ```bash
   ls ~/lib/styxy-intercept.so
   # If missing, library needs to be compiled
   ```

3. **Daemon not running**
   ```bash
   node bin/styxy instances
   # If fails, daemon needs to be started
   ```

4. **Port < 1024 (privileged ports)**
   LD_PRELOAD only intercepts user ports (>= 1024). System ports require root privileges.

### "Library not loading"

Check if the library is valid:

```bash
file ~/lib/styxy-intercept.so
# Should show: ELF 64-bit LSB shared object

# Check for errors
LD_PRELOAD=~/lib/styxy-intercept.so /bin/true
```

### "Reassignment happening but application doesn't work"

Some applications cache the port number before binding. If the application checks what port it's bound to after `bind()`, it should work correctly. Example:

```python
# This works - Python checks the actual bound port
with socketserver.TCPServer(("", 8000), Handler) as httpd:
    print(f"Serving on port {httpd.server_address[1]}")  # Shows actual port
```

### "No notification message visible"

Notifications go to stdout. Some applications may buffer or redirect output. Check the audit log:

```bash
tail -f /tmp/styxy-reassignments.log
```

### "Daemon authentication error"

The library needs the auth token:

```bash
ls ~/.styxy/auth.token
# Should exist and be readable

# Verify token works
TOKEN=$(cat ~/.styxy/auth.token)
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:9876/status
# Should return daemon status
```

## Advanced Topics

### How bind() Interception Works

The LD_PRELOAD library uses dynamic linking to intercept system calls:

```c
// 1. Get original bind() function
original_bind = dlsym(RTLD_NEXT, "bind");

// 2. Try original bind() first
result = original_bind(sockfd, addr, addrlen);

// 3. If EADDRINUSE (port busy), query daemon for suggestions
if (result == -1 && errno == EADDRINUSE) {
    suggestions = get_port_suggestions("dev");

    // 4. Try each suggested port
    for (each suggestion) {
        addr->sin_port = htons(suggestion);
        result = original_bind(sockfd, addr, addrlen);
        if (result == 0) break;  // Success!
    }
}
```

### Port Suggestion Algorithm

When a conflict occurs, the daemon suggests ports from the appropriate range:

1. **Service Type Detection**: Daemon infers service type (dev, api, test, etc.)
2. **Range Selection**: Suggests ports from the matching range (e.g., dev: 3000-3099)
3. **Availability Check**: Only suggests ports not currently allocated
4. **Sequential Allocation**: Suggests up to 5 ports in sequential order

### Performance Impact

**Minimal overhead:**
- If port is available: ~0.01ms overhead (single bind() call)
- If port is busy: ~50-100ms (daemon API call + retry)
- No overhead for ports outside interception scope (< 1024, non-TCP, IPv6)

### Security Considerations

1. **Local only**: Daemon only accepts connections from localhost
2. **Authentication**: All API calls require bearer token
3. **User scope**: LD_PRELOAD only affects processes you start
4. **Audit trail**: All reassignments logged with PID and timestamp

## FAQ

### Does this work with Docker containers?

No. LD_PRELOAD doesn't cross container boundaries. For containerized applications, use Styxy's CLI commands or Docker port mapping instead.

### Can I use this in production?

LD_PRELOAD mode is designed for development environments. For production, configure ports explicitly in your application configuration.

### What if the daemon is down?

The library gracefully handles daemon unavailability:
- If daemon is unreachable, the original `bind()` proceeds normally
- Application may fail with "Address already in use" (expected behavior without daemon)
- No crash or undefined behavior

### Will this break my application?

No. The library only intercepts TCP IPv4 bind() calls on user ports (>= 1024). All other operations pass through unchanged. Applications that check their bound port using `getsockname()` will see the correct reassigned port.

### How do I know what port my application is using?

1. Check the application's output (most servers log their port)
2. Check Claude's notification message
3. Check the audit log: `cat /tmp/styxy-reassignments.log`
4. Use Styxy CLI: `node bin/styxy list`

### Can I choose which ports to intercept?

Currently, all user ports (>= 1024) are intercepted. To disable interception for specific commands:

```bash
LD_PRELOAD="" your-command
```

### Does this work with https/SSL?

Yes. LD_PRELOAD intercepts the port binding, not the protocol. HTTPS/SSL works normally on the reassigned port.

### How do I report issues?

Check the audit log and daemon logs:

```bash
# Audit log
cat /tmp/styxy-reassignments.log

# Daemon status
node bin/styxy instances

# Test library manually
LD_PRELOAD=~/lib/styxy-intercept.so /tmp/test_bind 8000
```

Report issues with these logs to the development team.

## Related Documentation

- [Styxy CLI Reference](./CLI_REFERENCE.md)
- [Port Configuration Guide](../01-architecture/PORT_CONFIGURATION.md)
- [Daemon API Reference](../02-apis/DAEMON_API.md)
- [SessionStart Hooks](./SESSION_HOOKS.md)

## Technical Specifications

| Property | Value |
|----------|-------|
| Library Location | `~/lib/styxy-intercept.so` |
| Library Size | ~17KB |
| Language | C (compiled with gcc) |
| Supported Architectures | x86_64, ARM64 |
| Minimum Port | 1024 (user ports only) |
| Maximum Port | 65535 |
| Protocols | TCP IPv4 (IPv6 passes through) |
| Daemon Port | 9876 (configurable) |
| Audit Log | `/tmp/styxy-reassignments.log` |
| Hook Location | `~/.claude/hooks/session-start.sh` |

---

**Next Steps:**
- Try running servers on occupied ports
- Check the audit log to see reassignments
- Experiment with different service types
- Review [CLI Reference](./CLI_REFERENCE.md) for manual port management
