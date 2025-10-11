# Shadow Mode Flow Diagrams

## Complete Shadow Mode Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Claude Code Conversation                            │
│  User: "Start the dev server on port 8080"                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Claude Code Generates Command                       │
│  Command: npm run dev -- --port 8080                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    PreToolUse Hook Triggers                             │
│  Matcher: "Bash(*--port*)" → styxy-shadow-notices.sh                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Shadow Notice Script Runs                            │
│  1. Extract port: 8080                                                  │
│  2. Query Styxy: GET /check/8080                                        │
│  3. Check allocation status                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                   (Available)              (Allocated)
                        │                       │
                        ▼                       ▼
            ┌────────────────────┐  ┌──────────────────────────┐
            │  No Notice         │  │  ⚠️ Warning Notice       │
            │  Command proceeds  │  │  "Port 8080 allocated    │
            │                    │  │   to 'react-dev'"        │
            └────────────────────┘  │  💡 Suggestions shown    │
                        │           │  Command still proceeds  │
                        │           └──────────────────────────┘
                        │                       │
                        └───────────┬───────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Command Executes                                 │
│  npm run dev -- --port 8080                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                        ┌───────────┴───────────┐
                        │                       │
                   (Success)              (Port Conflict)
                        │                       │
                        ▼                       ▼
            ┌────────────────────┐  ┌──────────────────────────┐
            │  Exit Code: 0      │  │  Exit Code: 1            │
            │  No PostToolUse    │  │  Error: EADDRINUSE       │
            └────────────────────┘  └──────────────────────────┘
                        │                       │
                        │                       ▼
                        │           ┌──────────────────────────┐
                        │           │  PostToolUse Hook        │
                        │           │  styxy-post-notices.sh   │
                        │           └──────────────────────────┘
                        │                       │
                        │                       ▼
                        │           ┌──────────────────────────┐
                        │           │  Error Analysis          │
                        │           │  1. Detect conflict      │
                        │           │  2. Extract port 8080    │
                        │           │  3. Query allocation     │
                        │           │  4. Generate solutions   │
                        │           └──────────────────────────┘
                        │                       │
                        │                       ▼
                        │           ┌──────────────────────────────────────┐
                        │           │  🚫 PORT CONFLICT DETECTED           │
                        │           │                                      │
                        │           │  Port 8080 in use by 'react-dev'     │
                        │           │                                      │
                        │           │  Solutions:                          │
                        │           │  1. styxy allocate dev <name>        │
                        │           │  2. Use port 8081 instead            │
                        │           │  3. styxy list / cleanup             │
                        │           │  4. Manual port change               │
                        │           └──────────────────────────────────────┘
                        │                       │
                        └───────────┬───────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     Claude Code Conversation                            │
│  [Notice shown to user]                                                 │
│  Claude can now make informed decision about next steps                 │
└─────────────────────────────────────────────────────────────────────────┘
```

## PreToolUse Shadow Notice Detail

```
┌────────────────────────────────────────────────────────────────┐
│  Input: Bash command with port specification                  │
│  Example: "python -m http.server 8080"                         │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Port Extraction (10+ patterns)                                │
│  ├─ --port 8080                                                │
│  ├─ -p 8080                                                    │
│  ├─ PORT=8080                                                  │
│  ├─ python -m http.server 8080                                 │
│  ├─ php -S localhost:8080                                      │
│  └─ [more patterns...]                                         │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Port extracted?      │
                └───────────────────────┘
                     │            │
                  (Yes)        (No)
                     │            │
                     │            ▼
                     │    ┌─────────────────┐
                     │    │  Exit silently  │
                     │    │  No notice      │
                     │    └─────────────────┘
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  Query Styxy Daemon                                            │
│  GET /check/{port}                                             │
│  Timeout: 5 seconds                                            │
└────────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
         (Available)               (Allocated)
                │                       │
                ▼                       ▼
    ┌─────────────────────┐  ┌──────────────────────────────┐
    │  No notice needed   │  │  Generate Warning Notice     │
    │  Log: "available"   │  │  ├─ Who allocated it?        │
    │  Exit               │  │  ├─ Which instance?           │
    │                     │  │  ├─ Suggest alternative       │
    │                     │  │  │   (via dry-run API)        │
    │                     │  │  └─ Show helpful commands     │
    └─────────────────────┘  └──────────────────────────────┘
                                           │
                                           ▼
                            ┌───────────────────────────────┐
                            │  Output Notice to Claude Code │
                            │  Command proceeds anyway      │
                            └───────────────────────────────┘
```

## PostToolUse Conflict Detection Detail

```
┌────────────────────────────────────────────────────────────────┐
│  Input: Command execution result                               │
│  ├─ Exit code: 1 (failure)                                     │
│  ├─ Stdout: [output]                                           │
│  └─ Stderr: "Error: listen EADDRINUSE: port 8080"             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  Exit code == 0?      │
                └───────────────────────┘
                     │            │
                  (Yes)        (No)
                     │            │
                     ▼            │
            ┌────────────┐        │
            │  Exit      │        │
            │  No notice │        │
            └────────────┘        │
                                  ▼
┌────────────────────────────────────────────────────────────────┐
│  Error Pattern Matching (stdout + stderr)                      │
│  ├─ "address already in use"                                   │
│  ├─ "EADDRINUSE"                                               │
│  ├─ "port already in use"                                      │
│  ├─ "bind failed"                                              │
│  └─ "port taken"                                               │
└────────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
         (No match)                (Match found)
                │                       │
                ▼                       ▼
        ┌─────────────┐     ┌────────────────────────┐
        │  Exit       │     │  Extract Port Number   │
        │  No notice  │     │  ├─ "port 8080"        │
        │             │     │  ├─ ":8080 "           │
        │             │     │  └─ "EADDRINUSE 8080"  │
        └─────────────┘     └────────────────────────┘
                                        │
                                        ▼
                            ┌───────────────────────┐
                            │  Port extracted?      │
                            └───────────────────────┘
                                 │            │
                              (Yes)        (No)
                                 │            │
                                 │            ▼
                                 │    ┌────────────────┐
                                 │    │  Generic       │
                                 │    │  conflict msg  │
                                 │    └────────────────┘
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  Query Styxy for Port Details                                 │
│  GET /check/{port}                                             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Detect Service Type from Command                              │
│  ├─ "npm dev" → dev                                            │
│  ├─ "uvicorn" → api                                            │
│  ├─ "cypress" → test                                           │
│  └─ [default] → dev                                            │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Suggest Available Ports                                       │
│  Call Styxy API for service type range                         │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Generate Comprehensive Solution Notice                        │
│  ├─ Conflict description                                       │
│  ├─ Who's using the port                                       │
│  ├─ Option 1: Auto-allocate                                    │
│  ├─ Option 2: Specific port                                    │
│  ├─ Option 3: Review allocations                               │
│  └─ Option 4: Manual change                                    │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────────────┐
                │  Output Notice to Claude Code │
                └───────────────────────────────┘
```

## Dry-Run API Flow

```
┌────────────────────────────────────────────────────────────────┐
│  Shadow Notice needs available port suggestion                 │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  POST /allocate with dry_run=true                              │
│  {                                                             │
│    "service_type": "dev",                                      │
│    "service_name": "shadow-query-temp",                        │
│    "instance_id": "shadow-mode",                               │
│    "dry_run": true                                             │
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Daemon: allocatePort() method                                 │
│  1. Validate service type                                      │
│  2. Build candidate ports list                                 │
│  3. Check dry_run flag                                         │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
                ┌───────────────────────┐
                │  dry_run == true?     │
                └───────────────────────┘
                     │            │
                  (Yes)        (No)
                     │            │
                     ▼            ▼
    ┌─────────────────────────┐  ┌──────────────────────┐
    │  Find first available   │  │  Normal allocation   │
    │  WITHOUT allocating     │  │  Creates lock        │
    │  ├─ Check allocations   │  │  Saves state         │
    │  ├─ Skip in-progress    │  │  Returns lock_id     │
    │  └─ Return immediately  │  └──────────────────────┘
    └─────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────────────────┐
│  Response (no state change!)                                   │
│  {                                                             │
│    "success": true,                                            │
│    "port": 3000,                                               │
│    "dry_run": true,                                            │
│    "message": "Port 3000 would be allocated (dry run mode)"   │
│  }                                                             │
└────────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Shadow Notice uses port 3000 in suggestion                    │
│  "💡 Suggested available port for dev: 3000"                   │
└────────────────────────────────────────────────────────────────┘
```

## Integration with Existing Allocation Hooks

```
Claude Code Command: "npm run dev"
        │
        ▼
┌───────────────────────────────────────┐
│  Check PreToolUse Matchers            │
│  (Priority order - most specific first)│
└───────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│  1. Check Allocation Hooks (Specific)                 │
│     Matcher: "Bash(npm run dev:*)"                    │
│     ├─ MATCH? → styxy-universal-intercept.sh          │
│     │           ├─ Allocate port                      │
│     │           ├─ Modify command                     │
│     │           └─ DONE (skip other hooks)            │
│     └─ NO MATCH? → Continue to next                   │
└───────────────────────────────────────────────────────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│  2. Check Shadow Notice Hooks (Generic)               │
│     Matcher: "Bash(*--port*)"                         │
│     ├─ MATCH? → styxy-shadow-notices.sh               │
│     │           ├─ Check availability                 │
│     │           ├─ Show warning if allocated          │
│     │           └─ Command proceeds unchanged         │
│     └─ NO MATCH? → Command executes as-is             │
└───────────────────────────────────────────────────────┘

COVERAGE MATRIX:
┌─────────────────────┬──────────────────┬─────────────────┐
│ Command Type        │ Allocation Hook  │ Shadow Notice   │
├─────────────────────┼──────────────────┼─────────────────┤
│ npm run dev         │ ✓ Intercepts     │ - Skipped       │
│ cypress open        │ ✓ Intercepts     │ - Skipped       │
│ python -m http 8080 │ ✓ Intercepts     │ - Skipped       │
│ node server --port  │ - No match       │ ✓ Warns         │
│ custom-tool -p 3000 │ - No match       │ ✓ Warns         │
│ unrelated command   │ - No match       │ - No match      │
└─────────────────────┴──────────────────┴─────────────────┘

Result: ~100% coverage (98% active + 2% passive)
```

## Failure Handling

```
┌────────────────────────────────────────┐
│  Shadow Notice Script Executes         │
└────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────┐
│  Try: Query Styxy Daemon               │
│  curl http://localhost:9876/check/8080 │
│  Timeout: 5 seconds                    │
└────────────────────────────────────────┘
        │
        ▼
    ┌───────┴────────┐
    │                │
(Success)        (Failure)
    │                │
    ▼                ▼
┌─────────┐    ┌──────────────────────────┐
│ Process │    │  Daemon Unreachable      │
│ response│    │  ├─ Log error            │
│ Generate│    │  ├─ Return default JSON  │
│ notice  │    │  │   {"available":false}  │
│         │    │  ├─ No notice to Claude  │
│         │    │  └─ Command proceeds     │
└─────────┘    └──────────────────────────┘
    │                │
    └────────┬───────┘
             │
             ▼
┌──────────────────────────────────────────┐
│  Command Execution Proceeds              │
│  (User workflow never blocked)           │
└──────────────────────────────────────────┘

FAILURE MODES:
┌─────────────────────┬────────────────────┬─────────────────┐
│ Failure Type        │ Detection          │ Handling        │
├─────────────────────┼────────────────────┼─────────────────┤
│ Daemon down         │ Connection refused │ Log, allow      │
│ Daemon timeout      │ 5s timeout         │ Log, allow      │
│ Invalid port        │ Extraction fails   │ Skip, allow     │
│ API error           │ Non-200 status     │ Log, allow      │
│ Script error        │ Uncaught exception │ Exit 0, allow   │
└─────────────────────┴────────────────────┴─────────────────┘

Principle: ALWAYS allow command execution
```

## Logging Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Shadow Notice Events                                          │
└────────────────────────────────────────────────────────────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
         (PreToolUse)            (PostToolUse)
                │                       │
                ▼                       ▼
┌─────────────────────────┐  ┌──────────────────────────┐
│  shadow-notices.log     │  │  post-notices.log        │
│  ├─ Command analyzed    │  │  ├─ Exit code checked    │
│  ├─ Port extracted      │  │  ├─ Error detected       │
│  ├─ Availability check  │  │  ├─ Port extracted       │
│  ├─ Notice generated    │  │  └─ Solutions generated  │
│  └─ Timestamp           │  └──────────────────────────┘
└─────────────────────────┘
                │                       │
                └───────────┬───────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────────┐
│  Centralized Log Analysis                                      │
│  ├─ Grep for "PORT CONFLICT" → Count conflicts                │
│  ├─ Grep for "already allocated" → Which ports conflict most  │
│  ├─ Grep for "available" → Successful prevention count        │
│  └─ Timestamp analysis → Conflict patterns over time          │
└────────────────────────────────────────────────────────────────┘

LOG ROTATION:
- Location: ~/.claude/logs/
- Rotation: Manual (logrotate can be configured)
- Size limit: None (append-only)
- Format: [YYYY-MM-DD HH:MM:SS] [Component] Message
```

---

## Legend

```
┌─────────┐
│  Box    │  = Process or component
└─────────┘

    │
    ▼         = Flow direction

┌───┴───┐
│  ?    │     = Decision point
└───────┘

(Label)       = Condition or state

✓             = Match/Success
-             = No match/Skip
⚠️            = Warning
🚫            = Error/Failure
💡            = Suggestion
```
