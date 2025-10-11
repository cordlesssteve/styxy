# Styxy Observation Mode Refactor - Complete Summary

**Date:** 2025-10-10
**Status:** ✅ Complete - Ready for Testing
**Architecture Shift:** Allocator → Observer/Monitor

---

## 🎯 The Problem (Root Cause Analysis)

### What Was Wrong

**Original Design:**
- Styxy acted as a **port allocator**
- Claude Code had to call `styxy allocate` to get ports
- PreToolUse hooks **intercepted and modified** commands
- Assumed Claude would always use Styxy for coordination

**User's Actual Need:**
> "I want Claude to try natural ports (like storybook on 6006). When conflicts happen, Styxy should provide context about who's using the port and suggest alternatives. Claude naturally adapts based on the enriched error."

**The Gap:**
- ❌ Styxy couldn't help when Claude bypassed it
- ❌ Proactive interception felt forced
- ❌ "Use styxy allocate" suggestions weren't natural
- ❌ No visibility into ports Claude bound directly

---

## ✅ The Solution (Observation-First Architecture)

### New Model: Monitor → Detect → Assist

```
┌─────────────────────────────────────────┐
│ 1. Claude tries natural command         │
│    npm run storybook (→ 6006)          │
└─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ 2. Styxy observes (background)         │
│    Scans: Port 6006 bound by PID 1234  │
│    Tracks: Instance A, storybook       │
└─────────────────────────────────────────┘
                │
    (Later, different instance)
                │
                ▼
┌─────────────────────────────────────────┐
│ 3. Claude Instance B tries same         │
│    npm run storybook (→ 6006)          │
│    ❌ OS Error: EADDRINUSE             │
└─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ 4. PostToolUse hook intercepts error   │
│    Asks: Who has 6006?                 │
│    Gets: Instance A/storybook          │
│    Suggests: 6007, 6008, 6009          │
└─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ 5. Claude sees enriched error          │
│    "Port 6006 used by Instance A"      │
│    "Try: npm run storybook -- -p 6007" │
└─────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────┐
│ 6. Claude naturally retries with 6007  │
│    ✅ Success!                          │
└─────────────────────────────────────────┘
```

---

## 📁 What Was Built

### 1. Port Observer System

**File:** `src/utils/port-observer.js` (new)

**Capabilities:**
- ✅ Scans system ports every 10 seconds (configurable)
- ✅ Uses `lsof`, `netstat`, or `ss` (multi-platform)
- ✅ Tracks: PID, process name, command line, working directory
- ✅ Infers service type from command (storybook, dev, api, etc.)
- ✅ Infers Claude instance from project path
- ✅ Maintains observation cache (port → metadata)
- ✅ Detects when ports are released
- ✅ Suggests available ports by service type

**Key Methods:**
```javascript
portObserver.start()                    // Begin scanning
portObserver.getObservation(port)       // Who has this port?
portObserver.suggestPorts(serviceType)  // Free ports for service
portObserver.getStats()                 // Usage statistics
```

### 2. New Daemon API Endpoints

**File:** `src/daemon.js` (modified)

**New Observation Endpoints:**

```
GET /observe/:port
  → Returns: Who's using port, what service, which instance, how long

GET /observe/all
  → Returns: Complete port visibility, all observations

GET /suggest/:serviceType?count=5
  → Returns: Available ports for service type (e.g., storybook)

POST /register-instance
  → Allows Claude instances to self-identify

GET /observation-stats
  → Returns: Port usage statistics
```

**Integration:**
- ✅ Port observer starts with daemon
- ✅ Port observer stops with daemon
- ✅ All endpoints authenticated
- ✅ No breaking changes to existing API

### 3. Natural Conflict Helper Hook

**File:** `~/scripts/claude/styxy-conflict-helper.sh` (new)

**Purpose:** PostToolUse hook that provides natural port suggestions

**Flow:**
1. Detects EADDRINUSE errors
2. Extracts conflicting port number
3. Queries Styxy for observation
4. Detects service type from command
5. Gets suggested available ports
6. Generates natural command modification

**Example Output:**
```
⚠️  PORT 6006 IS ALREADY IN USE

**Currently running:** npm
**Service type:** storybook
**Instance:** claude-instance-a

**💡 Available storybook ports you can use:**
   1. Port 6007
   2. Port 6008
   3. Port 6009

**🔧 Try this instead:**
```bash
npm run storybook -- -p 6007
```
```

**Key Features:**
- ✅ NO "run styxy allocate" suggestions
- ✅ Natural command modifications
- ✅ Tool-specific port syntax (npm vs python vs storybook)
- ✅ Context about who's using the port
- ✅ Only activates on actual conflicts

---

## 🔄 What Changed

### Daemon Architecture

**Before:**
```javascript
// Allocator model
allocatePort(serviceType) {
  // Find free port in range
  // Create lock
  // Return port
}
```

**After:**
```javascript
// Observer model
portObserver.scan() {
  // Scan system ports (lsof/netstat)
  // Track who owns what
  // Update observation cache
}

GET /observe/:port {
  // Query observation cache
  // Return metadata
}

GET /suggest/:serviceType {
  // Find free ports in range
  // Return suggestions
}
```

### Hook Philosophy

**Before (Proactive):**
- PreToolUse hooks intercepted commands
- Modified commands to use Styxy-allocated ports
- Required Claude to follow Styxy's allocation

**After (Reactive):**
- PostToolUse hooks analyze failures
- Provide context when conflicts occur
- Claude uses natural ports, adapts on conflict

### API Focus

**Before:**
```
Primary: POST /allocate → Get port from Styxy
Secondary: GET /check/:port → Is port available?
```

**After:**
```
Primary: GET /observe/:port → Who has this port?
Primary: GET /suggest/:serviceType → What ports are free?
Secondary: POST /allocate → (Still exists for backward compat)
```

---

## ✅ Testing Status

### What I Verified

**✓ VERIFIED:**
- JavaScript syntax validates (no compilation errors)
- Port observer imports correctly
- Daemon starts observer on startup
- Daemon stops observer on shutdown
- New API endpoints are defined

**❌ NOT YET TESTED:**
- Port observer actually scans ports
- Observation data is accurate
- Conflict helper detects real errors
- Natural port suggestions work
- Multi-instance coordination
- Performance impact of 10s scans

---

## 🚀 Deployment Steps

### 1. Update Settings

**Remove old PreToolUse allocation hooks** (or keep for backward compat):
```json
{
  "hooks": {
    "PreToolUse": [
      // Can keep existing hooks OR remove them
      // New system works without them
    ]
  }
}
```

**Add new PostToolUse conflict helper:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash(*)",
        "hooks": [{
          "type": "command",
          "command": "/home/cordlesssteve/scripts/claude/styxy-conflict-helper.sh"
        }]
      }
    ]
  }
}
```

### 2. Restart Daemon

```bash
# Stop old daemon
styxy daemon stop

# Start new daemon (with observer)
styxy daemon start

# Verify observer is running
curl http://localhost:9876/observation-stats
```

### 3. Test the Flow

**Terminal 1 (Instance A):**
```bash
cd ~/projects/test-project-a
npm run storybook  # Binds to 6006
```

**Terminal 2 (Check observation):**
```bash
curl http://localhost:9876/observe/6006
# Should show: Instance A, storybook, PID, etc.
```

**Terminal 3 (Instance B - in Claude Code):**
```bash
cd ~/projects/test-project-b
npm run storybook  # Tries 6006, gets EADDRINUSE
# PostToolUse hook should show natural suggestions
```

---

## 📊 Key Metrics to Watch

### Performance
- **Scan interval:** 10 seconds (configurable)
- **Scan duration:** 🤔 LIKELY <500ms (needs measurement)
- **API response time:** 🤔 LIKELY <100ms (cached observations)
- **Memory usage:** ❌ UNKNOWN (needs profiling)

### Accuracy
- **Port detection rate:** ❌ UNKNOWN (needs testing)
- **Service type inference:** 🤔 LIKELY 80-90% (pattern-based)
- **Instance detection:** ❌ UNKNOWN (depends on project paths)
- **False positive rate:** ❌ UNKNOWN (needs measurement)

---

## 🎯 Success Criteria

### Must Work
- [ ] Observer detects ports bound by any process
- [ ] Observer correctly identifies service types
- [ ] Conflict helper detects EADDRINUSE errors
- [ ] Suggestions include available ports
- [ ] Natural command modifications are syntactically correct
- [ ] Multi-instance coordination prevents conflicts

### Nice to Have
- [ ] Instance ID inference from project paths
- [ ] 90%+ service type detection accuracy
- [ ] <1% CPU usage for observation
- [ ] <100MB memory overhead

---

## 🔍 What Needs Verification

### Critical (Must Test)
1. **Port scanning actually works** - Run daemon, bind ports, check `/observe/all`
2. **Conflict detection works** - Trigger EADDRINUSE, verify hook activates
3. **Suggestions are accurate** - Verify suggested ports are actually free
4. **Natural syntax correct** - Verify command modifications are valid

### Important (Should Test)
5. **Service type inference** - Test common dev servers, check accuracy
6. **Instance detection** - Run multiple Claude instances, verify tracking
7. **Performance** - Monitor CPU/memory during scans
8. **Cleanup** - Verify observations update when ports released

### Nice to Have (Can Test Later)
9. **Edge cases** - Rapid bind/unbind, non-standard ports
10. **Failure modes** - What if lsof/netstat/ss all fail?
11. **Scalability** - 100+ bound ports, performance?

---

## 📝 Documentation Status

### Created
- ✅ This refactoring summary
- ✅ Port observer code with inline docs
- ✅ Conflict helper with comments

### Needs Update
- [ ] README.md - Explain observation mode
- [ ] API documentation - Document new endpoints
- [ ] Architecture docs - Update diagrams
- [ ] User guide - Natural port usage examples
- [ ] Migration guide - For existing users

---

## 🤔 Open Questions

### Architecture
1. **Should we keep PreToolUse hooks?**
   - 🤔 LIKELY: Keep for backward compatibility
   - ❓ SPECULATION: Users might want proactive allocation option

2. **What if observation is wrong?**
   - 🤔 LIKELY: Claude will try suggested port, get another error, adapt
   - ❓ SPECULATION: Self-correcting through trial and error

3. **How to handle rapid port changes?**
   - ❌ UNKNOWN: 10-second scan interval might miss fast bind/unbind
   - **Solution**: Could add real-time event-based observation

### Performance
4. **Is 10-second scan too slow?**
   - ❌ UNKNOWN: Depends on user workflow
   - **Test**: Try 5s, 10s, 30s intervals, measure impact

5. **Can we optimize port scanning?**
   - 🤔 LIKELY: Cache unchanged ports, only scan deltas
   - ❓ SPECULATION: Event-driven would be faster but more complex

### User Experience
6. **Will users understand observation mode?**
   - ❌ UNKNOWN: Needs user testing
   - **Mitigation**: Clear documentation, examples

---

## 🚦 Current Status

### What's Ready
- ✅ Code written and syntax-validated
- ✅ Observer system integrated into daemon
- ✅ New API endpoints defined
- ✅ Conflict helper hook created
- ✅ Natural port suggestions implemented

### What's Not Ready
- ⚠️ No real-world testing yet
- ⚠️ No performance measurements
- ⚠️ No accuracy verification
- ⚠️ Documentation not updated
- ⚠️ No migration guide

### Next Immediate Steps
1. **Start daemon with observer** - Verify it runs
2. **Bind a test port** - Check `/observe/:port` works
3. **Trigger conflict** - Verify hook activates
4. **Measure performance** - CPU/memory during scans
5. **Update docs** - Once verified working

---

## 💡 Design Rationale

### Why Observation Over Allocation?

**User's Workflow:**
> "Claude tries natural ports. When conflicts happen, Styxy helps. Claude adapts."

**This requires:**
- Passive monitoring (not active assignment)
- Post-conflict assistance (not pre-conflict prevention)
- Natural suggestions (not Styxy-specific commands)
- Visibility (who's using what)

**Observation mode provides all four.**

### Why Keep Old Allocation API?

**Backward compatibility:**
- Existing scripts/tools may call `/allocate`
- Gradual migration possible
- No breaking changes

**Optional proactive mode:**
- Users can still call `styxy allocate` if they want
- Coexists with observation mode
- Best of both worlds

---

## 🎉 Bottom Line

### Before This Refactor
- ❌ Styxy = port allocator
- ❌ Claude must ask Styxy for ports
- ❌ PreToolUse hooks intercept and modify
- ❌ Forced coordination model

### After This Refactor
- ✅ Styxy = port observer/monitor
- ✅ Claude uses natural ports
- ✅ PostToolUse hooks assist on conflict
- ✅ Natural adaptation model

### The Win
**Claude Code can now:**
1. Use natural, default ports (storybook → 6006)
2. Get enriched error context when conflicts occur
3. See natural command suggestions (not "run styxy allocate")
4. Adapt organically based on what's actually happening

**Styxy now:**
1. Monitors the ecosystem passively
2. Tracks all port usage (not just allocated)
3. Provides visibility and context
4. Helps without controlling

**This is the robust, natural path forward the user requested.**

---

## 📋 Testing Checklist

Run through this checklist to verify the refactor:

```bash
# 1. Daemon starts with observer
styxy daemon start
# Check logs for "Port observer started"

# 2. Observer scans ports
sleep 15  # Wait for scan
curl http://localhost:9876/observation-stats
# Should show some observations

# 3. Bind a test port
python -m http.server 8765 &
sleep 5
curl http://localhost:9876/observe/8765
# Should show python process

# 4. Get suggestions
curl http://localhost:9876/suggest/dev
# Should return available ports

# 5. Trigger conflict (manually simulate)
# Terminal 1: python -m http.server 6006
# Terminal 2 (Claude Code context): python -m http.server 6006
# PostToolUse hook should activate with suggestions

# 6. Verify cleanup
kill %1  # Kill python server
sleep 15  # Wait for scan
curl http://localhost:9876/observe/8765
# Should show "not currently bound"
```

---

**Status:** ✅ Refactoring complete, ready for real-world testing
**Risk Level:** 🟡 Medium (new system, needs validation)
**Rollback:** ✅ Easy (old allocation system still exists)
