# PostToolUse Hook Behavior Test

**Goal:** Empirically verify whether PostToolUse hooks trigger on Bash command failures

## Test Setup

### 1. Test Hook Created

**Location:** `~/scripts/claude/test-posttooluse-on-failure.sh`

**What it does:**
- Logs every time it's called with timestamp
- Records all arguments received
- Records all environment variables
- Captures stdin input
- Always exits 0 (non-blocking)

**Log location:** `~/.claude/logs/posttooluse-test.log`

### 2. Configuration Needed

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
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
  }
}
```

## Test Procedure

### Test Case 1: Successful Bash Command

**Command to run in Claude Code:**
```bash
echo "Hello, this should succeed"
```

**Expected:**
- ✅ Command succeeds (exit 0)
- ✅ PostToolUse hook triggers (if it triggers on success)
- ✅ Log file shows hook was called

**Check log:**
```bash
cat ~/.claude/logs/posttooluse-test.log
```

### Test Case 2: Failed Bash Command

**Command to run in Claude Code:**
```bash
exit 1
```

**Expected (if PostToolUse triggers on failures):**
- ❌ Command fails (exit 1)
- ✅ PostToolUse hook triggers
- ✅ Log file shows hook was called

**Expected (if PostToolUse ONLY on success - per docs):**
- ❌ Command fails (exit 1)
- ❌ PostToolUse hook does NOT trigger
- ❌ No new entry in log file

**Check log:**
```bash
cat ~/.claude/logs/posttooluse-test.log
# Count entries to see if new one was added
```

### Test Case 3: Port Conflict Error (Real World)

**Setup:**
```bash
# Terminal 1: Bind port 8888
python -m http.server 8888 &
```

**Command to run in Claude Code:**
```bash
python -m http.server 8888
```

**Expected:**
- ❌ Command fails with EADDRINUSE
- ❓ Does PostToolUse trigger?
- ✅ Log will tell us

**Check log:**
```bash
cat ~/.claude/logs/posttooluse-test.log
# Look for entry after EADDRINUSE error
```

## How to Run This Test

### Step 1: Clear Previous Logs
```bash
rm -f ~/.claude/logs/posttooluse-test.log
rm -f ~/.claude/logs/posttooluse-test.log.stdin
```

### Step 2: Add Hook to Settings
Edit `~/.claude/settings.json` and add the PostToolUse hook configuration above.

### Step 3: Restart Claude Code
Close and reopen Claude Code to load new settings.

### Step 4: Run Test Case 1 (Success)

In Claude Code, ask:
```
Please run this command: echo "Test case 1 - success"
```

Then check:
```bash
cat ~/.claude/logs/posttooluse-test.log
```

**If you see an entry:** PostToolUse triggers on success ✅

### Step 5: Run Test Case 2 (Failure)

In Claude Code, ask:
```
Please run this command: exit 1
```

Then check:
```bash
cat ~/.claude/logs/posttooluse-test.log
wc -l ~/.claude/logs/posttooluse-test.log  # Count entries
```

**If entry count increased:** PostToolUse triggers on failures ✅
**If entry count unchanged:** PostToolUse does NOT trigger on failures ❌

### Step 6: Run Test Case 3 (Real Port Conflict)

Setup port conflict:
```bash
python -m http.server 8888 &
```

In Claude Code, ask:
```
Please run this command: python -m http.server 8888
```

Check log:
```bash
tail -50 ~/.claude/logs/posttooluse-test.log
```

**If you see an entry with EADDRINUSE context:** Hook saw the error ✅

## Expected Outcomes

### Scenario A: PostToolUse ONLY on Success (Per Docs)

```
Test 1 (echo success): ✅ Hook triggers
Test 2 (exit 1):       ❌ Hook does NOT trigger
Test 3 (EADDRINUSE):   ❌ Hook does NOT trigger
```

**Conclusion:** Documentation is correct, my architecture is broken

### Scenario B: PostToolUse on ALL Bash Completions

```
Test 1 (echo success): ✅ Hook triggers
Test 2 (exit 1):       ✅ Hook triggers
Test 3 (EADDRINUSE):   ✅ Hook triggers
```

**Conclusion:** Documentation is misleading, my architecture works!

### Scenario C: PostToolUse on Some Failures

```
Test 1 (echo success): ✅ Hook triggers
Test 2 (exit 1):       ❌ Hook does NOT trigger
Test 3 (EADDRINUSE):   ✅ Hook triggers (maybe different error type?)
```

**Conclusion:** Complex behavior, need to understand edge cases

## What to Look For in Logs

### Key Questions:

1. **Does the hook receive exit code?**
   - Look for arguments or stdin containing exit code
   - Check if tool_response includes failure info

2. **Does the hook receive stderr?**
   - Look for EADDRINUSE error text in stdin
   - Check if tool_response includes stderr

3. **What's in the stdin JSON?**
   - Save to `.stdin` file for inspection
   - Look for tool_response structure

4. **Environment variables?**
   - Any TOOL_EXIT_CODE or similar?
   - Any HOOK_ERROR_MODE indicator?

## Analysis Script

Quick analysis after running tests:

```bash
#!/bin/bash
echo "PostToolUse Hook Test Results"
echo "=============================="
echo ""

LOG_FILE="${HOME}/.claude/logs/posttooluse-test.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "❌ No log file found - hook never triggered"
    exit 1
fi

echo "Total hook invocations: $(grep -c "PostToolUse Hook Triggered" "$LOG_FILE")"
echo ""

echo "Test Case 1 (success - echo):"
if grep -q "Test case 1 - success" "$LOG_FILE"; then
    echo "  ✅ Hook triggered on successful command"
else
    echo "  ❌ Hook did NOT trigger on successful command"
fi
echo ""

echo "Test Case 2 (failure - exit 1):"
# Count entries before and after
if [ $(grep -c "PostToolUse Hook Triggered" "$LOG_FILE") -gt 1 ]; then
    echo "  ⚠️  Multiple triggers detected - checking if exit 1 is included..."
    # This requires manual inspection
    tail -100 "$LOG_FILE" | grep -A 20 "exit 1" || echo "  ❌ No 'exit 1' found in logs"
else
    echo "  ❌ Hook did NOT trigger on failed command (exit 1)"
fi
echo ""

echo "Test Case 3 (EADDRINUSE error):"
if grep -q "EADDRINUSE\|8888" "$LOG_FILE"; then
    echo "  ✅ Hook triggered on port conflict error"
else
    echo "  ❌ Hook did NOT trigger on port conflict error"
fi
echo ""

echo "Full log location: $LOG_FILE"
echo ""
echo "Stdin captures: $LOG_FILE.stdin"
```

Save as `~/scripts/claude/analyze-posttooluse-test.sh` and run after tests.

## Next Steps Based on Results

### If PostToolUse ONLY on Success
- ✅ Documentation was correct
- ❌ My PostToolUse error detection architecture is broken
- 🔧 Need to pivot to PreToolUse warnings or accept limitations

### If PostToolUse on Failures Too
- ❌ Documentation was incomplete/wrong
- ✅ My architecture can work!
- 🔧 Refine the conflict helper hook

### If Unclear/Mixed Results
- 🔍 Need more investigation
- 📚 Check Claude Code release notes or source code
- 💬 Ask Anthropic team for clarification

## Current Status

**Test hook created:** ✅
**Configuration documented:** ✅
**Test procedure ready:** ✅
**Waiting for:** User to run tests in Claude Code

**Next:** Run the tests and analyze the log file to see what actually happens!
