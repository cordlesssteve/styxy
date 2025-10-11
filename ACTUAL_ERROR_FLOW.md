# What Claude Code ACTUALLY Receives - Real Error Flow

## The Truth About PostToolUse Hooks

**✓ VERIFIED:** PostToolUse hooks only trigger "after a tool completes successfully"
**❌ MY MISTAKE:** PostToolUse hooks do NOT trigger on Bash failures

---

## What ACTUALLY Happens (No Styxy Intervention)

### Step-by-Step Reality

```
┌─────────────────────────────────────────────────────────┐
│  Claude Code Instance B                                 │
│  User: "Start storybook"                                │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  Claude generates command                               │
│  > npm run storybook                                    │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  Claude Code Executes Bash Tool                         │
│                                                         │
│  Tool: Bash                                             │
│  Input: { command: "npm run storybook" }               │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  OS Level - Command Execution                           │
│                                                         │
│  $ npm run storybook                                    │
│  > storybook start                                      │
│  > Attempting to bind port 6006...                      │
│  > ❌ Error: EADDRINUSE :::6006                         │
└─────────────────────────────────────────────────────────┘
            │
            │ Process exits with code 1
            ▼
┌─────────────────────────────────────────────────────────┐
│  Bash Tool Result                                       │
│                                                         │
│  Exit Code: 1                                           │
│  Stdout: [npm output before error]                      │
│  Stderr: "Error: listen EADDRINUSE: address already    │
│           in use :::6006"                               │
└─────────────────────────────────────────────────────────┘
            │
            ▼
    ┌─────────────────────────────────────┐
    │  PostToolUse Hook Check             │
    │                                     │
    │  Condition: Did tool succeed?       │
    │  Exit code: 1 (FAILED)              │
    │  Result: DON'T RUN HOOKS ❌         │
    └─────────────────────────────────────┘
            │
            │ NO HOOK RUNS
            ▼
┌─────────────────────────────────────────────────────────┐
│  Claude Code Receives (Raw)                             │
│                                                         │
│  Tool: Bash                                             │
│  Result: ERROR                                          │
│  Exit Code: 1                                           │
│  Message: "Error: listen EADDRINUSE: address already   │
│            in use :::6006"                              │
│                                                         │
│  [NO STYXY CONTEXT]                                     │
│  [NO PORT SUGGESTIONS]                                  │
│  [JUST THE RAW ERROR]                                   │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  Claude's Analysis (Without Help)                       │
│                                                         │
│  "I see port 6006 is in use. Let me try a different    │
│   port. I'll use 6007."                                 │
│                                                         │
│  [Claude guesses at solution without Styxy context]     │
└─────────────────────────────────────────────────────────┘
```

---

## The Real Problem

### What Claude Actually Sees

```json
{
  "tool": "Bash",
  "command": "npm run storybook",
  "exit_code": 1,
  "stderr": "Error: listen EADDRINUSE: address already in use :::6006\n    at Server.setupListenHandle [as _listen2] (node:net:1740:16)\n    at listenInCluster (node:net:1788:12)\n    at Server.listen (node:net:1876:7)\n    ...",
  "stdout": "Starting Storybook...\nLoading config...\n"
}
```

**That's it. No enrichment. No context. No suggestions.**

### What I THOUGHT Would Happen

```
❌ WRONG: PostToolUse hook sees failure, queries Styxy, adds context
```

### What ACTUALLY Happens

```
✓ CORRECT: Claude sees raw EADDRINUSE error, has to figure it out alone
```

---

## Why My Architecture Fails

### The PostToolUse Hook I Built

**File:** `~/scripts/claude/styxy-conflict-helper.sh`

```bash
# Main execution
main() {
    # Only analyze failed commands
    if [[ "${EXIT_CODE}" -eq 0 ]]; then
        exit 0
    fi

    # Detect port conflict...
    # Query Styxy...
    # Generate suggestions...
}
```

**Problem:** This script checks `EXIT_CODE != 0` to detect failures...
**But:** PostToolUse hooks never receive failed commands!
**Result:** The entire script is unreachable code!

---

## Can PreToolUse Hooks Help?

### PreToolUse Hook Capabilities

**✓ VERIFIED:** PreToolUse hooks run BEFORE tool execution

**Input Schema:**
```json
{
  "hook_event_name": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": {
    "command": "npm run storybook"
  }
}
```

**Output Options:**
1. **Allow execution:** Exit 0, command proceeds
2. **Block execution:** Exit 2, command blocked
3. **Modify command:** Output JSON with modified parameters

### Could PreToolUse Detect Conflicts?

**Yes, theoretically:**
```bash
# PreToolUse hook
# 1. Parse command for port
# 2. Query Styxy: Is port available?
# 3. If not, suggest alternative
# 4. Either block or modify command
```

**But this requires:**
- Parsing port from command (error-prone)
- Proactive checking (the "allocator" model we moved away from)
- Modifying commands before execution (feels forced)

**This is the OLD model you rejected!**

---

## Alternative Solutions

### Option 1: Error Message Enhancement (Impossible?)

**Idea:** Somehow inject context into the stderr before Claude sees it

**Problem:**
- Stderr is from the Bash process, not a hook
- No hook runs after failures
- Can't modify past errors

**Verdict:** ❌ Not possible with current hook system

### Option 2: PreToolUse Port Check (Proactive)

**Idea:** Check port availability BEFORE execution

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash(*storybook*)",
        "hooks": [{
          "type": "command",
          "command": "styxy-precheck-port.sh"
        }]
      }
    ]
  }
}
```

**PreToolUse Hook Flow:**
1. Parse command for likely port (6006 for storybook)
2. Query Styxy: Is 6006 available?
3. If not, output warning to Claude BEFORE execution
4. Let command proceed (will fail, but Claude has context)

**Output:**
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "⚠️ Port 6006 appears to be in use by Instance A. Consider using port 6007 instead."
  }
}
```

**Verdict:** 🟡 Possible, but Claude sees warning THEN error separately

### Option 3: Command Modification (Allocator Model)

**Idea:** PreToolUse hook modifies command to use available port

```json
{
  "modifiedCommand": "npm run storybook -- -p 6007"
}
```

**Verdict:** ✅ Works, but this is the forced allocation we moved away from

### Option 4: Custom Error Handling in Commands

**Idea:** Wrap commands in error handlers

```bash
# Instead of: npm run storybook
# Use: ./run-with-styxy-fallback.sh "npm run storybook"
```

**Script:**
```bash
#!/bin/bash
cmd="$1"
$cmd
if [ $? -ne 0 ]; then
  # Query Styxy for suggestions
  # Show suggestions
  # Retry with alternative
fi
```

**Verdict:** 🟡 Requires Claude to use wrapper scripts (not natural)

### Option 5: Accept Limitations

**Idea:** Styxy provides visibility, but can't auto-assist on conflicts

**Flow:**
1. Claude tries natural command
2. Gets raw error
3. Claude asks user or makes educated guess
4. User/Claude can manually query Styxy for help: `styxy suggest storybook`

**Verdict:** ✅ Honest, but less helpful than hoped

---

## What Claude Code Documentation DOESN'T Say

### Questions I Can't Answer

❌ **UNKNOWN:** Can hooks receive tool failures somehow?
❌ **UNKNOWN:** Is there a different hook type for errors?
❌ **UNKNOWN:** Can we inject context into stderr after the fact?
❌ **UNKNOWN:** Does Claude Code have error interceptors?

### What I Need to Find Out

1. Is there any hook that triggers on Bash failures?
2. Can we provide context to Claude without blocking commands?
3. Is there a way to enrich errors post-execution?

---

## The Honest Assessment

### What Works
- ✅ Port Observer tracks all bound ports
- ✅ Styxy can suggest available ports via API
- ✅ Observation cache provides visibility

### What Doesn't Work
- ❌ PostToolUse hook for failed commands (wrong hook type)
- ❌ Automatic error enrichment (no mechanism exists)
- ❌ Seamless conflict assistance (not possible without proactive hooks)

### The Hard Truth

**We have three options:**

1. **Go back to PreToolUse allocation** (proactive, forced)
   - Claude Code always uses Styxy-allocated ports
   - Commands modified before execution
   - Works, but feels unnatural

2. **Use PreToolUse warnings** (informative, but noisy)
   - Warn before likely conflicts
   - Claude sees warning + error separately
   - Helpful but cluttered

3. **Accept manual fallback** (honest, limited)
   - Styxy provides visibility and API
   - Claude gets raw errors
   - User/Claude manually queries Styxy when needed

**None of these match your original vision perfectly.**

---

## What You Asked For vs. What's Possible

### Your Vision
> "Claude tries natural ports. When conflicts happen, Styxy provides enriched error context. Claude adapts based on the enriched error."

### Reality Check
- ✅ Claude can try natural ports
- ❌ Styxy can't enrich errors after they happen (no post-failure hooks)
- 🟡 Claude could get context BEFORE errors (PreToolUse warnings)

### The Gap

**The critical piece missing:** A hook that runs AFTER Bash failures to enrich the error message.

**This doesn't exist in Claude Code's hook system** (based on current documentation).

---

## Next Steps - Be Honest

I need to:

1. **Verify hook behavior** - Test if PostToolUse ever triggers on failures
2. **Find workarounds** - Explore PreToolUse warning approach
3. **Update architecture** - Revise to what's actually possible
4. **Set realistic expectations** - Explain limitations clearly

**The observation system is solid. The error enrichment mechanism we designed doesn't exist.**

Should I:
- A) Test to confirm PostToolUse never triggers on failures?
- B) Design PreToolUse warning system (proactive but informative)?
- C) Accept limitations and document manual Styxy usage?
- D) Research if there's ANY error hook mechanism I'm missing?
