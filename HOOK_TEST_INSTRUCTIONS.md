# PostToolUse Hook Test - Manual Instructions

## Current Status

✅ **Test hook created:** `~/scripts/claude/test-posttooluse-on-failure.sh`
✅ **Configuration added:** PostToolUse hook in `~/.claude/settings.json`
✅ **Analysis script ready:** `~/scripts/claude/analyze-posttooluse-test.sh`

⚠️ **Cannot test in current session:** Hooks were loaded at session start, before PostToolUse was added

## What You Need To Do

### Step 1: Start a NEW Claude Code Session

The PostToolUse hook is now configured in settings, but it won't be active in THIS session. You need to:

1. **Exit Claude Code completely**
2. **Start a new Claude Code session**
3. The new session will load the PostToolUse hook

### Step 2: Clear Previous Logs

In the new session, run:
```bash
rm -f ~/.claude/logs/posttooluse-test.log*
```

### Step 3: Run Test Case 1 (Success)

Ask Claude in the new session:
```
Please run this command: echo "Test case 1 - success"
```

### Step 4: Check if Hook Triggered on Success

```bash
cat ~/.claude/logs/posttooluse-test.log
```

**Expected:** You should see a log entry if PostToolUse triggers on success ✅

### Step 5: Run Test Case 2 (Failure)

Ask Claude:
```
Please run this command: exit 1
```

### Step 6: Check if Hook Triggered on Failure

```bash
cat ~/.claude/logs/posttooluse-test.log
wc -l ~/.claude/logs/posttooluse-test.log
```

**Key Question:** Did the line count increase after the failed command?

- **If YES:** PostToolUse CAN trigger on failures ✅ (My architecture works!)
- **If NO:** PostToolUse only on success ❌ (Documentation is correct, architecture broken)

### Step 7: Run Test Case 3 (Port Conflict)

First, bind port 8888:
```bash
python -m http.server 8888 &
```

Then ask Claude:
```
Please run this command: python -m http.server 8888
```

### Step 8: Analyze Results

```bash
~/scripts/claude/analyze-posttooluse-test.sh
```

This will show you:
- Total hook invocations
- Which test cases triggered the hook
- What data the hook received
- **THE ANSWER: Can PostToolUse detect failures?**

## What the Results Mean

### Scenario A: Hook Only on Success

```
Test 1 (echo): ✅ Hook triggered
Test 2 (exit 1): ❌ Hook NOT triggered
Test 3 (EADDRINUSE): ❌ Hook NOT triggered
```

**Conclusion:**
- Documentation was correct
- My PostToolUse conflict helper won't work
- Need to use PreToolUse warnings instead

### Scenario B: Hook on ALL Completions

```
Test 1 (echo): ✅ Hook triggered
Test 2 (exit 1): ✅ Hook triggered
Test 3 (EADDRINUSE): ✅ Hook triggered
```

**Conclusion:**
- Documentation was incomplete
- My PostToolUse conflict helper WILL work!
- Observation mode architecture is valid

### Scenario C: Mixed Behavior

```
Test 1 (echo): ✅ Hook triggered
Test 2 (exit 1): ❌ Hook NOT triggered
Test 3 (EADDRINUSE): ✅ Hook triggered (special case?)
```

**Conclusion:**
- Complex behavior, need to investigate further
- Might depend on error type

## After Testing

Once you have results, share them and I'll:

1. **Update the architecture** based on findings
2. **Fix or remove** the PostToolUse conflict helper
3. **Design alternative approach** if needed
4. **Document the truth** about PostToolUse behavior

## Quick Commands Reference

```bash
# Clear logs
rm -f ~/.claude/logs/posttooluse-test.log*

# View log
cat ~/.claude/logs/posttooluse-test.log

# Analyze results
~/scripts/claude/analyze-posttooluse-test.sh

# Bind test port
python -m http.server 8888 &

# Kill test server
pkill -f "python -m http.server 8888"
```

## Remove Test Hook After Testing

Once testing is complete, edit `~/.claude/settings.json` and remove:

```json
    "PostToolUse": [
      {
        "matcher": "Bash(*)",
        "hooks": [
          {
            "type": "command",
            "command": "/home/cordlesssteve/scripts/claude/test-posttooluse-on-failure.sh"
          }
        ]
      }
    ]
```

(Or keep it if you want to keep monitoring PostToolUse behavior)

---

**The test is ready. We just need a fresh Claude Code session to run it.**
