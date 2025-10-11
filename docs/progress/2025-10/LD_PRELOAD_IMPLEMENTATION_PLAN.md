# LD_PRELOAD Auto-Reassignment Implementation Plan

**Status:** PLANNING
**Date:** 2025-10-10
**Goal:** Implement automatic port reassignment using LD_PRELOAD to intercept bind() calls and communicate successes to Claude Code

## Architecture Overview

```
┌────────────────────────────────────────────────────────┐
│  Application (npm, python, node, etc.)                 │
│  Attempts: bind(port 6006)                            │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  LD_PRELOAD: ~/lib/styxy-intercept.so                 │
│                                                         │
│  1. Intercept bind(sockfd, 0.0.0.0:6006)              │
│  2. Query: GET http://localhost:7878/observe/6006     │
│  3. If BOUND:                                          │
│     a. Query: GET /suggest/{service_type}             │
│     b. Pick first available (6007)                    │
│     c. Notify Claude via STDOUT                       │
│     d. Modify bind() → port 6007                      │
│     e. Register with Styxy: POST /register-instance   │
│  4. Call original bind(6007)                           │
└─────────────────┬──────────────────────────────────────┘
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│  Kernel binds to port 6007                             │
│  Application continues on 6007                         │
│  Claude sees: "✓ STYXY: Auto-assigned port 6007"      │
└────────────────────────────────────────────────────────┘
```

## What Needs to Be Built

### 1. LD_PRELOAD Shared Library (NEW)

**File:** `~/lib/styxy-intercept.c`

**Requirements:**
- Intercept `bind()` system calls for IPv4 TCP sockets
- Query Styxy daemon for port availability
- Query Styxy daemon for port suggestions
- Automatically reassign to available port when conflict detected
- Notify Claude via stdout (visible message)
- Log all reassignments to audit file
- Register reassigned ports with Styxy daemon
- Handle errors gracefully (timeout, daemon not running, etc.)

**Configuration Mode:**
```c
#define AUTO_REASSIGN 1  // Enable auto-reassignment
#define STYXY_DAEMON "http://localhost:7878"
#define REASSIGNMENT_LOG "/tmp/styxy-reassignments.log"
```

**Key Functions:**
- `int bind()` - Main interceptor
- `char* http_get(url)` - Query Styxy daemon
- `int parse_json_bool/string/int_array()` - Parse responses
- `void notify_claude_reassignment()` - Print to stdout
- `void log_reassignment()` - Append to audit log

### 2. Activation Script (NEW)

**File:** `~/scripts/claude/styxy-activate-ldpreload.sh`

**Purpose:** SessionStart hook that exports LD_PRELOAD

**Requirements:**
- Print informative banner to stderr
- Export LD_PRELOAD environment variable
- Verify shared library exists
- Exit 0 (non-blocking)

### 3. Styxy Daemon API Extensions (MODIFY EXISTING)

**Already exists in daemon.js:**
- ✅ `GET /observe/:port` - Check if port is bound
- ✅ `GET /suggest/:serviceType` - Get available ports
- ✅ `POST /register-instance` - Register instance with Styxy

**Need to verify:**
- `/register-instance` accepts `port`, `service_type`, `pid`
- `/suggest/:serviceType` returns JSON array of ports
- Daemon runs on port 7878 (not 9876)

**ACTION NEEDED:** Check daemon port configuration

### 4. Port Observer Service Type Detection (ENHANCE EXISTING)

**File:** `src/utils/port-observer.js`

**Current capability:** Infers service type from command/process name

**Enhancement needed:**
- Ensure service type detection works for common tools:
  - `npm run storybook` → `storybook`
  - `npm run dev` → `web-dev`
  - `python -m http.server` → `http-server`
  - `node server.js` → `web-dev`

**ACTION NEEDED:** Review and enhance service type patterns

### 5. Claude Code Hook Configuration (MODIFY USER CONFIG)

**File:** `~/.claude/settings.json`

**Add SessionStart hook:**
```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [{
          "type": "command",
          "command": "/home/cordlesssteve/scripts/claude/styxy-activate-ldpreload.sh"
        }]
      }
    ]
  }
}
```

**Alternative:** Global activation in `~/.bashrc`
```bash
export LD_PRELOAD="${HOME}/lib/styxy-intercept.so"
```

## What Needs to Be Reworked

### 1. Daemon Port Number

**Current status:** Daemon runs on port 9876
**LD_PRELOAD expects:** Port 7878

**Options:**
- A. Change daemon default port to 7878
- B. Make daemon port configurable via env var
- C. Update LD_PRELOAD to use 9876

**DECISION NEEDED**

### 2. Service Type Detection

**Current:** PortObserver infers from process command
**Needed:** More robust detection for edge cases

**Review:**
- Read `src/utils/port-observer.js:inferServiceType()`
- Test with common commands
- Add missing patterns

### 3. Instance Registration API

**Current:** `/register-instance` expects instance_id, project_path
**LD_PRELOAD provides:** port, service_type, pid

**Options:**
- A. Extend API to accept minimal registration (port + service_type + pid)
- B. Make LD_PRELOAD generate instance_id (from hostname or cwd)
- C. Make instance_id optional in API

**DECISION NEEDED**

### 4. Port Suggestion Logic

**Current:** PortObserver.suggestPorts() returns available ports in service range
**Needed:** Verify it handles unknown service types gracefully

**Test cases:**
- Known service type: `storybook` → [6007, 6008, 6009]
- Unknown service type: `my-custom-app` → fallback range?
- No available ports: return empty array or default range?

**ACTION:** Add fallback behavior for unknown service types

## Implementation Phases

### Phase 1: Preparation & Testing (Day 1)

**Tasks:**
1. ✅ Review current daemon port configuration
2. ✅ Review PortObserver service type detection
3. ✅ Review /register-instance API requirements
4. ✅ Create implementation plan (this document)
5. ⬜ Decide on daemon port number
6. ⬜ Decide on registration API changes

**Deliverables:**
- Finalized decisions on port number and API changes
- Updated daemon configuration if needed

### Phase 2: C Library Development (Day 1-2)

**Tasks:**
1. ⬜ Write `styxy-intercept.c` with full functionality
2. ⬜ Compile to `~/lib/styxy-intercept.so`
3. ⬜ Test basic bind() interception (manual test)
4. ⬜ Test Styxy daemon queries
5. ⬜ Test stdout notification visibility
6. ⬜ Test audit logging

**Deliverables:**
- Working `styxy-intercept.so`
- Reassignment audit log at `/tmp/styxy-reassignments.log`

**Test scenarios:**
- Port available → bind succeeds normally
- Port taken → auto-reassign to suggestion
- Styxy daemon not running → proceed normally (fail-safe)
- Suggestion API returns empty → return error with context

### Phase 3: Activation Script (Day 2)

**Tasks:**
1. ⬜ Write `styxy-activate-ldpreload.sh`
2. ⬜ Test SessionStart hook integration
3. ⬜ Verify LD_PRELOAD exports correctly
4. ⬜ Test banner visibility in Claude Code

**Deliverables:**
- Working activation script
- Updated `~/.claude/settings.json`

### Phase 4: Daemon Enhancements (Day 2)

**Tasks:**
1. ⬜ Update PortObserver service type detection if needed
2. ⬜ Enhance /register-instance API if needed
3. ⬜ Add fallback behavior for unknown service types in suggest API
4. ⬜ Test complete flow: bind → query → reassign → register

**Deliverables:**
- Enhanced daemon APIs
- Passing integration tests

### Phase 5: End-to-End Testing (Day 3)

**Test scenarios:**

**Scenario 1: Storybook port conflict**
```bash
# Terminal 1: Start Storybook on port 6006
npm run storybook

# Terminal 2: Claude tries to start Storybook again
# Expected: Auto-reassigned to 6007
# Expected: Claude sees notification
```

**Scenario 2: Python HTTP server conflict**
```bash
# Terminal 1: Start server on 8000
python -m http.server 8000

# Terminal 2: Claude tries same
# Expected: Auto-reassigned to 8001
```

**Scenario 3: Unknown service type**
```bash
# Claude tries to start custom app on port 5000 (taken)
# Expected: Auto-reassigned to available port in fallback range
```

**Scenario 4: Styxy daemon not running**
```bash
# Stop Styxy daemon
# Claude tries to start service
# Expected: Proceed normally, no interception
```

**Deliverables:**
- All scenarios passing
- Documentation of behavior

### Phase 6: Documentation & Cleanup (Day 3)

**Tasks:**
1. ⬜ Write user-facing documentation
2. ⬜ Update CURRENT_STATUS.md
3. ⬜ Archive old observation mode plans
4. ⬜ Add troubleshooting guide
5. ⬜ Create monitoring/audit scripts

**Deliverables:**
- `docs/reference/03-development/LD_PRELOAD_MODE.md`
- `scripts/claude/styxy-reassignment-audit.sh` (view audit log)
- Updated status documents

## Files to Create

### New Files

1. **`~/lib/styxy-intercept.c`** (~500 lines)
   - Main LD_PRELOAD implementation

2. **`~/scripts/claude/styxy-activate-ldpreload.sh`** (~30 lines)
   - SessionStart activation hook

3. **`~/scripts/claude/styxy-reassignment-audit.sh`** (~50 lines)
   - View and analyze reassignment logs

4. **`docs/reference/03-development/LD_PRELOAD_MODE.md`** (~200 lines)
   - User documentation

5. **`/tmp/styxy-reassignments.log`** (auto-created)
   - Audit trail of reassignments

### Files to Modify

1. **`src/utils/port-observer.js`**
   - Enhanced service type detection (if needed)

2. **`src/daemon.js`**
   - Port number configuration (if changing)
   - /register-instance API enhancement (if needed)
   - /suggest API fallback behavior (if needed)

3. **`~/.claude/settings.json`**
   - Add SessionStart hook

4. **`CURRENT_STATUS.md`**
   - Update with LD_PRELOAD status

5. **`README.md`**
   - Add LD_PRELOAD mode overview

## Decision Points

### 1. Daemon Port Number

**Options:**
- **A.** Keep at 9876, update LD_PRELOAD code
- **B.** Change to 7878, update daemon default
- **C.** Make configurable, use env var in LD_PRELOAD

**Recommendation:** Option C (most flexible)

```c
// In styxy-intercept.c
const char* daemon_port = getenv("STYXY_DAEMON_PORT");
if (!daemon_port) daemon_port = "9876"; // Default
```

### 2. Service Type Detection

**Current approach:** Pattern matching on command string

**Enhancement needed:** Add more patterns

**Recommendation:** Enhance existing patterns, add fallback to "web-dev"

### 3. Instance Registration

**Current API:** Expects instance_id + project_path

**LD_PRELOAD has:** PID only

**Recommendation:** Make instance_id optional, generate from PID:
```javascript
const instance_id = req.body.instance_id || `pid-${req.body.pid}`;
```

### 4. Unknown Service Type Handling

**Current:** /suggest/:serviceType might fail for unknown types

**Recommendation:** Add fallback logic:
```javascript
if (!this.serviceTypes[serviceType]) {
  // Return generic web-dev range as fallback
  serviceType = 'web-dev';
}
```

## Success Criteria

✅ **Complete when:**

1. LD_PRELOAD library compiles and loads without errors
2. Port conflicts are detected and auto-reassigned
3. Claude sees notification: "✓ STYXY: Auto-assigned port 6007"
4. Application starts successfully on reassigned port
5. Reassignments logged to audit file
6. Works with npm, yarn, python, node commands
7. Gracefully handles Styxy daemon not running
8. End-to-end test scenarios all pass
9. Documentation complete

## Risk Mitigation

### Risk 1: LD_PRELOAD breaks applications

**Mitigation:**
- Only intercept IPv4 TCP sockets (port >= 1024)
- Always call original bind() eventually
- Fail-safe: if Styxy unreachable, proceed normally
- Test with diverse applications before wide deployment

### Risk 2: stdout notification not visible to Claude

**Mitigation:**
- Use fflush(stdout) after printing
- Print BEFORE calling original bind()
- Test visibility in actual Claude Code session
- Add timestamp to log file as backup

### Risk 3: Performance overhead

**Mitigation:**
- Cache Styxy daemon URL
- Timeout curl requests (2s max)
- Only query on first bind attempt per process
- Measure overhead with benchmarks

### Risk 4: JSON parsing failures

**Mitigation:**
- Implement robust parsers with error handling
- Fallback to error mode if parsing fails
- Log parsing errors for debugging
- Consider using lightweight JSON-C library

## Next Steps

1. **Decision time:** Choose options for:
   - Daemon port number (Option C - env var)
   - Registration API changes (make instance_id optional)
   - Service type fallback (use web-dev)

2. **Start Phase 1:** Review current implementation
   - Check daemon port
   - Check PortObserver patterns
   - Check registration API

3. **Begin Phase 2:** Write C library
   - Set up development environment
   - Write minimal interceptor
   - Test basic functionality

**Ready to proceed?**
