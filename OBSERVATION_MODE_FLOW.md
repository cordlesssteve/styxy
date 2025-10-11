# Styxy Observation Mode - Detailed Flow Diagram

## Complete System Interaction Flow

```
═══════════════════════════════════════════════════════════════════════════════
                        OBSERVATION MODE: FULL FLOW
═══════════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────────────────────┐
│                          PHASE 1: DAEMON STARTUP                            │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────────┐
    │  User Terminal   │
    └──────────────────┘
            │
            │ $ styxy daemon start
            ▼
    ┌──────────────────────────────────────────────────────┐
    │  Styxy Daemon Process (daemon.js)                    │
    │  ┌────────────────────────────────────────────────┐  │
    │  │  1. Load configuration                         │  │
    │  │  2. Initialize HTTP server (port 9876)         │  │
    │  │  3. Start health monitor                       │  │
    │  │  4. Start port observer  ← NEW!                │  │
    │  └────────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────────┘
            │
            │ portObserver.start()
            ▼
    ┌──────────────────────────────────────────────────────┐
    │  Port Observer (port-observer.js)                    │
    │  ┌────────────────────────────────────────────────┐  │
    │  │  setInterval(() => {                           │  │
    │  │    scan();  // Every 10 seconds                │  │
    │  │  }, 10000)                                     │  │
    │  └────────────────────────────────────────────────┘  │
    └──────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
│                    PHASE 2: BACKGROUND OBSERVATION                          │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │  Port Observer (every 10 seconds)                       │
    └─────────────────────────────────────────────────────────┘
            │
            │ scan()
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  System Port Scan                                       │
    │  ┌───────────────────────────────────────────────────┐  │
    │  │  Try: lsof -i -P -n | grep LISTEN                 │  │
    │  │  Fallback: netstat -tulpn | grep LISTEN           │  │
    │  │  Fallback: ss -tulpn | grep LISTEN                │  │
    │  └───────────────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────────────┘
            │
            │ Output: List of bound ports
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Parse Results                                          │
    │                                                         │
    │  For each bound port:                                   │
    │    • Extract: port number, PID, process name           │
    │    • Get command: ps -p {PID} -o command=              │
    │    • Get cwd: lsof -p {PID} -d cwd                     │
    │    • Infer service type from command                   │
    │    • Infer instance ID from cwd                        │
    └─────────────────────────────────────────────────────────┘
            │
            │ Update observation cache
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Observation Cache (Map)                                │
    │                                                         │
    │  6006 → {                                              │
    │    pid: 12345,                                          │
    │    process: "node",                                     │
    │    command: "npm run storybook",                        │
    │    service_type: "storybook",                           │
    │    instance_id: "claude-instance-a",                    │
    │    timestamp: 1696900000000                             │
    │  }                                                      │
    │                                                         │
    │  3000 → { ... }  (dev server)                          │
    │  8080 → { ... }  (api server)                          │
    └─────────────────────────────────────────────────────────┘

    [This happens continuously in the background]

═══════════════════════════════════════════════════════════════════════════════
│                    PHASE 3: CLAUDE INSTANCE A - NORMAL USAGE                │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────┐
    │  Claude Code Instance A      │
    │  (Project: ~/projects/app-a) │
    └──────────────────────────────┘
            │
            │ User: "Start storybook"
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Claude analyzes, generates command                     │
    │                                                         │
    │  Command: npm run storybook                             │
    │  (Uses default port 6006)                               │
    └─────────────────────────────────────────────────────────┘
            │
            │ Execute bash command
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Bash Execution                                         │
    │                                                         │
    │  $ npm run storybook                                    │
    └─────────────────────────────────────────────────────────┘
            │
            │ npm runs storybook
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Storybook Process Starts                               │
    │                                                         │
    │  Attempts to bind: 0.0.0.0:6006                         │
    └─────────────────────────────────────────────────────────┘
            │
            │ Check: Is port 6006 available?
            ▼

        ┌─────────────┐
        │  OS Kernel  │  Port 6006 is FREE
        └─────────────┘
            │
            │ bind() succeeds
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ✅ Storybook Running                                    │
    │                                                         │
    │  Storybook started                                      │
    │  Local:   http://localhost:6006                         │
    │  PID: 12345                                             │
    └─────────────────────────────────────────────────────────┘
            │
            │ (10 seconds later...)
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Port Observer Scans                                    │
    │                                                         │
    │  Detects: Port 6006 bound by PID 12345                  │
    │  Command: npm run storybook                             │
    │  CWD: ~/projects/app-a                                  │
    └─────────────────────────────────────────────────────────┘
            │
            │ Update cache
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Observation Cache Updated                              │
    │                                                         │
    │  6006 → {                                              │
    │    pid: 12345,                                          │
    │    process: "node",                                     │
    │    command: "npm run storybook",                        │
    │    service_type: "storybook",     ← Inferred           │
    │    instance_id: "claude-app-a",   ← Inferred from path │
    │    timestamp: 1696900010000                             │
    │  }                                                      │
    └─────────────────────────────────────────────────────────┘

    [Instance A continues running... no issues]

═══════════════════════════════════════════════════════════════════════════════
│              PHASE 4: CLAUDE INSTANCE B - PORT CONFLICT                     │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────────────────────┐
    │  Claude Code Instance B      │
    │  (Project: ~/projects/app-b) │
    └──────────────────────────────┘
            │
            │ User: "Start storybook"
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Claude analyzes, generates command                     │
    │                                                         │
    │  Command: npm run storybook                             │
    │  (Also tries default port 6006)                         │
    └─────────────────────────────────────────────────────────┘
            │
            │ Execute bash command
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Bash Execution                                         │
    │                                                         │
    │  $ npm run storybook                                    │
    └─────────────────────────────────────────────────────────┘
            │
            │ npm runs storybook
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Storybook Process Starts                               │
    │                                                         │
    │  Attempts to bind: 0.0.0.0:6006                         │
    └─────────────────────────────────────────────────────────┘
            │
            │ Check: Is port 6006 available?
            ▼

        ┌─────────────┐
        │  OS Kernel  │  Port 6006 is IN USE (by PID 12345)
        └─────────────┘
            │
            │ bind() FAILS
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ❌ Error: EADDRINUSE                                    │
    │                                                         │
    │  Error: listen EADDRINUSE: address already in use      │
    │  :::6006                                                │
    └─────────────────────────────────────────────────────────┘
            │
            │ Exit code: 1 (failure)
            │ stderr contains error
            ▼

═══════════════════════════════════════════════════════════════════════════════
│                    PHASE 5: POSTTOOLUSE HOOK ACTIVATION                     │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │  Claude Code Hook System                                │
    │                                                         │
    │  Detects: Bash command exited with code 1              │
    │  Triggers: PostToolUse hooks                            │
    └─────────────────────────────────────────────────────────┘
            │
            │ Call hook with:
            │   - Tool: "Bash"
            │   - Args: "npm run storybook"
            │   - Exit code: 1
            │   - Stderr: "Error: listen EADDRINUSE :::6006"
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  styxy-conflict-helper.sh                               │
    │                                                         │
    │  1. Check exit code: 1 ✓ (failed)                       │
    │  2. Scan stderr for port conflict pattern               │
    └─────────────────────────────────────────────────────────┘
            │
            │ Pattern match: "EADDRINUSE"
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Conflict Detected                                      │
    │                                                         │
    │  Extract port: grep -oE "[0-9]{4,5}"                    │
    │  Result: 6006                                           │
    └─────────────────────────────────────────────────────────┘
            │
            │ Query Styxy for observation
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  HTTP Request to Styxy                                  │
    │                                                         │
    │  GET http://localhost:9876/observe/6006                 │
    └─────────────────────────────────────────────────────────┘
            │
            │ Styxy lookups observation cache
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Styxy Daemon                                           │
    │                                                         │
    │  app.get('/observe/:port', (req, res) => {              │
    │    const port = req.params.port;                        │
    │    const obs = portObserver.getObservation(port);       │
    │    return obs;                                          │
    │  })                                                     │
    └─────────────────────────────────────────────────────────┘
            │
            │ Return observation
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  HTTP Response                                          │
    │                                                         │
    │  {                                                      │
    │    "port": 6006,                                        │
    │    "bound": true,                                       │
    │    "observation": {                                     │
    │      "pid": 12345,                                      │
    │      "process": "node",                                 │
    │      "command": "npm run storybook",                    │
    │      "service_type": "storybook",                       │
    │      "instance_id": "claude-app-a"                      │
    │    }                                                    │
    │  }                                                      │
    └─────────────────────────────────────────────────────────┘
            │
            │ Hook receives observation
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Detect Service Type from Command                       │
    │                                                         │
    │  Command: "npm run storybook"                           │
    │  Pattern match: grep "storybook"                        │
    │  Result: service_type = "storybook"                     │
    └─────────────────────────────────────────────────────────┘
            │
            │ Request port suggestions
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  HTTP Request to Styxy                                  │
    │                                                         │
    │  GET http://localhost:9876/suggest/storybook?count=5    │
    └─────────────────────────────────────────────────────────┘
            │
            │ Styxy finds available ports
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Styxy Daemon                                           │
    │                                                         │
    │  app.get('/suggest/:serviceType', (req, res) => {       │
    │    const range = [6000, 6099];  // storybook range     │
    │    const suggestions = [];                              │
    │    for (let p = 6000; p <= 6099; p++) {                │
    │      if (!observations.has(p)) {                        │
    │        suggestions.push(p);                             │
    │        if (suggestions.length >= 5) break;              │
    │      }                                                  │
    │    }                                                    │
    │    return suggestions;                                  │
    │  })                                                     │
    └─────────────────────────────────────────────────────────┘
            │
            │ Return suggestions
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  HTTP Response                                          │
    │                                                         │
    │  {                                                      │
    │    "service_type": "storybook",                         │
    │    "suggestions": [6007, 6008, 6009, 6010, 6011],      │
    │    "count": 5                                           │
    │  }                                                      │
    └─────────────────────────────────────────────────────────┘
            │
            │ Hook generates natural notice
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Generate Notice                                        │
    │                                                         │
    │  notice = "⚠️  PORT 6006 IS ALREADY IN USE\n"           │
    │  notice += "\n**Currently running:** node\n"            │
    │  notice += "**Service type:** storybook\n"              │
    │  notice += "**Instance:** claude-app-a\n"               │
    │  notice += "\n💡 Available storybook ports:\n"          │
    │  notice += "   1. Port 6007\n"                          │
    │  notice += "   2. Port 6008\n"                          │
    │  notice += "   3. Port 6009\n"                          │
    │  notice += "\n🔧 Try this instead:\n"                   │
    │  notice += "```bash\n"                                  │
    │  notice += "npm run storybook -- -p 6007\n"             │
    │  notice += "```"                                        │
    └─────────────────────────────────────────────────────────┘
            │
            │ Output notice to Claude Code
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Hook Output (stdout)                                   │
    │                                                         │
    │  ⚠️  PORT 6006 IS ALREADY IN USE                         │
    │                                                         │
    │  **Currently running:** node                            │
    │  **Service type:** storybook                            │
    │  **Instance:** claude-app-a                             │
    │                                                         │
    │  💡 Available storybook ports:                          │
    │     1. Port 6007                                        │
    │     2. Port 6008                                        │
    │     3. Port 6009                                        │
    │                                                         │
    │  🔧 Try this instead:                                    │
    │  ```bash                                                │
    │  npm run storybook -- -p 6007                           │
    │  ```                                                    │
    └─────────────────────────────────────────────────────────┘
            │
            │ Claude Code receives hook output
            ▼

═══════════════════════════════════════════════════════════════════════════════
│                    PHASE 6: CLAUDE ADAPTS NATURALLY                         │
└─────────────────────────────────────────────────────────────────────────────┘

    ┌─────────────────────────────────────────────────────────┐
    │  Claude Code Conversation                               │
    │                                                         │
    │  [Shows user the error and notice]                      │
    │                                                         │
    │  "I see that port 6006 is already in use by another     │
    │   instance running storybook. Let me try port 6007      │
    │   instead."                                             │
    └─────────────────────────────────────────────────────────┘
            │
            │ Generate new command
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Claude Re-attempts with Suggested Port                 │
    │                                                         │
    │  Command: npm run storybook -- -p 6007                  │
    └─────────────────────────────────────────────────────────┘
            │
            │ Execute bash command
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Bash Execution                                         │
    │                                                         │
    │  $ npm run storybook -- -p 6007                         │
    └─────────────────────────────────────────────────────────┘
            │
            │ npm runs storybook with port 6007
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Storybook Process Starts                               │
    │                                                         │
    │  Attempts to bind: 0.0.0.0:6007                         │
    └─────────────────────────────────────────────────────────┘
            │
            │ Check: Is port 6007 available?
            ▼

        ┌─────────────┐
        │  OS Kernel  │  Port 6007 is FREE
        └─────────────┘
            │
            │ bind() succeeds
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  ✅ Storybook Running (Instance B)                       │
    │                                                         │
    │  Storybook started                                      │
    │  Local:   http://localhost:6007                         │
    │  PID: 54321                                             │
    └─────────────────────────────────────────────────────────┘
            │
            │ (10 seconds later...)
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Port Observer Scans                                    │
    │                                                         │
    │  Detects: Port 6007 bound by PID 54321                  │
    │  Command: npm run storybook -- -p 6007                  │
    │  CWD: ~/projects/app-b                                  │
    └─────────────────────────────────────────────────────────┘
            │
            │ Update cache
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Observation Cache Updated                              │
    │                                                         │
    │  6006 → {                                              │
    │    instance_id: "claude-app-a",                         │
    │    service_type: "storybook",                           │
    │    ...                                                  │
    │  }                                                      │
    │                                                         │
    │  6007 → {                                              │
    │    pid: 54321,                                          │
    │    process: "node",                                     │
    │    command: "npm run storybook -- -p 6007",            │
    │    service_type: "storybook",                           │
    │    instance_id: "claude-app-b",   ← NEW!               │
    │    timestamp: 1696900020000                             │
    │  }                                                      │
    └─────────────────────────────────────────────────────────┘

    ✅ Both instances running happily on different ports!

═══════════════════════════════════════════════════════════════════════════════
│                    PHASE 7: CONTINUOUS MONITORING                           │
└─────────────────────────────────────────────────────────────────────────────┘

    [Every 10 seconds, Port Observer scans...]

    ┌─────────────────────────────────────────────────────────┐
    │  Port Observer Scan Cycle                               │
    │                                                         │
    │  1. Run: lsof -i -P -n | grep LISTEN                    │
    │  2. Parse currently bound ports                         │
    │  3. Update observation cache:                           │
    │     • Add new bindings                                  │
    │     • Remove released ports                             │
    │     • Update timestamps                                 │
    │  4. Sleep 10 seconds                                    │
    │  5. Repeat                                              │
    └─────────────────────────────────────────────────────────┘
            │
            │ If Instance A stops storybook...
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Port 6006 Released                                     │
    │                                                         │
    │  Process PID 12345 exits                                │
    │  Port 6006 no longer in lsof output                     │
    └─────────────────────────────────────────────────────────┘
            │
            │ Next scan (10 seconds later)
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Observer detects port 6006 missing                     │
    │                                                         │
    │  observations.delete(6006)                              │
    └─────────────────────────────────────────────────────────┘
            │
            │ Port 6006 now available again
            ▼
    ┌─────────────────────────────────────────────────────────┐
    │  Future conflict on 6006?                               │
    │                                                         │
    │  GET /observe/6006                                      │
    │  → { "bound": false }                                   │
    │                                                         │
    │  GET /suggest/storybook                                 │
    │  → { "suggestions": [6006, 6007, ...] }  ← 6006 back!  │
    └─────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════════
│                        KEY ARCHITECTURAL POINTS                             │
└─────────────────────────────────────────────────────────────────────────────┘

1. PASSIVE OBSERVATION
   • Styxy NEVER intercepts commands before execution
   • Claude uses natural, default ports
   • Scanning happens in background (10s interval)

2. REACTIVE ASSISTANCE
   • Only helps AFTER conflicts occur
   • PostToolUse hook detects EADDRINUSE errors
   • Queries Styxy for context and suggestions

3. NATURAL SUGGESTIONS
   • NO "run styxy allocate" messages
   • Shows actual command modifications
   • Tool-specific syntax (npm vs python vs storybook)

4. VISIBILITY
   • Tracks ALL bound ports (not just Styxy-allocated)
   • Infers service types and instances
   • Provides complete ecosystem awareness

5. SELF-CORRECTING
   • Observations update automatically
   • Released ports become available
   • No manual cleanup needed

═══════════════════════════════════════════════════════════════════════════════
│                            API ENDPOINTS                                    │
└─────────────────────────────────────────────────────────────────────────────┘

Observation Endpoints (NEW):

  GET /observe/:port
    → Returns detailed observation for specific port
    → { bound: true/false, observation: {...} }

  GET /observe/all
    → Returns all current observations
    → { total: N, observations: [...], stats: {...} }

  GET /suggest/:serviceType?count=5
    → Returns available ports for service type
    → { service_type: "storybook", suggestions: [6007, 6008, ...] }

  POST /register-instance
    → Allows Claude instances to self-identify
    → { instance_id, project_path, metadata }

  GET /observation-stats
    → Returns port usage statistics
    → { by_service_type: {...}, by_instance: {...} }

Legacy Endpoints (Still exist):

  POST /allocate
    → Still works for backward compatibility
    → Can coexist with observation mode

  GET /check/:port
    → Simple availability check
    → { available: true/false }

═══════════════════════════════════════════════════════════════════════════════
                                  END OF FLOW
═══════════════════════════════════════════════════════════════════════════════
```

## Summary of Communication Flow

**1. Daemon Startup** → Port Observer starts scanning every 10s

**2. Background Observation** → Continuously tracks all bound ports via `lsof`

**3. Claude Instance A** → Binds port 6006 naturally, Styxy observes it

**4. Claude Instance B** → Tries port 6006, gets OS error (EADDRINUSE)

**5. PostToolUse Hook** → Detects error, queries Styxy for context + suggestions

**6. Natural Adaptation** → Claude sees enriched error, retries with suggested port

**7. Continuous Monitoring** → Observer keeps tracking, updates when ports released

**The key insight:** Styxy never controls allocation, only observes and assists when conflicts naturally occur.
