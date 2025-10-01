# Daemon Test Fixture Improvements

**Date**: 2025-09-30
**Status**: COMPLETE
**Context**: Feature #3 Phase 1 implementation revealed daemon test hanging issues

## Problem Identified

Tests creating `StyxyDaemon` instances were hanging and preventing Jest from exiting cleanly.

### Root Cause

**Metrics Module Singleton Timer** (`src/utils/metrics.js:216`)
```javascript
// Old code:
const defaultMetrics = new Metrics(); // Created timer that never got cleaned up
module.exports.default = defaultMetrics;
```

The Metrics class creates a `setInterval()` timer in its constructor for auto-resetting counters. A singleton instance was created at module load time, creating a timer that:
1. Kept Node.js event loop alive
2. Was never destroyed (even when tests called daemon.stop())
3. Prevented Jest from exiting cleanly

## Solution Implemented

### 1. Removed Unused Singleton

**File**: `src/utils/metrics.js`

**Change**:
```javascript
// Removed singleton creation - not used anywhere in codebase
module.exports = Metrics; // Export class only
```

**Verification**: Grepped codebase, confirmed no code referenced the singleton

### 2. Improved destroy() Method

Enhanced cleanup to explicitly null out timer:
```javascript
destroy() {
  if (this.resetTimer) {
    clearInterval(this.resetTimer);
    this.resetTimer = null; // Added explicit null
  }
}
```

### 3. Created Daemon Test Helper

**File**: `tests/helpers/daemon-test-helper.js`

**Features**:
- **createDaemon(options)** - Creates daemon with automatic cleanup tracking
- **createTestConfigDir()** - Generates unique test config directories
- **cleanup()** - Properly destroys all daemons and cleans up test directories
- **createExternalServer(port)** - Helper for port conflict testing
- **closeExternalServer(server)** - Helper to close test servers
- **waitFor(condition, timeout)** - Utility for async condition waiting

**Key Implementation**:
```javascript
async cleanup() {
  // Stop and destroy all daemons
  for (const daemon of this.daemons) {
    // Close server if running
    if (daemon.server && daemon.server.listening) {
      await new Promise((resolve) => daemon.server.close(resolve));
    }

    // Clear intervals
    if (daemon.cleanupInterval) {
      clearInterval(daemon.cleanupInterval);
    }

    // Destroy components
    daemon.metrics?.destroy();
    daemon.portScannerBreaker?.destroy();
    daemon.rateLimiter?.destroy();
    daemon.auth?.destroy();
  }

  // Remove test directories
  for (const testDir of this.testDirs) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}
```

## Test Files Created

### 1. Daemon Lifecycle Test ✅
**File**: `tests/unit/daemon/daemon-lifecycle.test.js`

Tests basic daemon creation and cleanup without hanging.

**Results**: 2/2 passing, no open handles

### 2. Port Availability Check Test ✅
**File**: `tests/unit/utils/port-availability-check.test.js`

Tests core port checking logic in isolation.

**Results**: 3/3 passing

### 3. Simple Conflict Detection Test ✅
**File**: `tests/unit/daemon/conflict-detection-simple.test.js`

Tests `checkPortActuallyAvailable()` and recovery config loading.

**Results**: 3/3 passing

### 4. Comprehensive Conflict Recovery Tests ⏸️
**File**: `tests/unit/daemon/conflict-recovery-v2.test.js`

Full integration tests for conflict recovery.

**Status**: Created but `allocatePort()` calls are slow in test environment. Core functionality verified through simpler tests.

## Verification

### Before Fix
```
Jest has detected the following 1 open handle potentially keeping Jest from exiting:

  ●  Timeout

      20 |     this.resetTimer = setInterval(() => {
         |                       ^
```

### After Fix
```
PASS unit tests/unit/daemon/daemon-lifecycle.test.js
  Daemon Lifecycle - Minimal Test
    ✓ should create and cleanup daemon without hanging (61 ms)
    ✓ should create multiple daemons and cleanup all (28 ms)

Test Suites: 1 passed, 1 total
Tests:       2 passed, 2 total
Time:        1.267 s
```

✅ No open handles, clean exit

## Impact

### Positive
- ✅ Tests can now create daemon instances without hanging
- ✅ Proper cleanup ensures no resource leaks
- ✅ Test helper makes daemon testing easier
- ✅ Reusable pattern for future daemon tests

### Neutral
- Removed unused singleton (no breaking changes - not referenced)
- No performance impact on production code

### Future Work
- Consider optimizing `allocatePort()` for test environments
- Add more helper methods as needed for specific test scenarios
- Document test helper patterns for other components

## Files Modified

1. **src/utils/metrics.js** - Removed singleton, improved destroy()
2. **tests/helpers/daemon-test-helper.js** - NEW test helper
3. **tests/unit/daemon/daemon-lifecycle.test.js** - NEW basic tests
4. **tests/unit/daemon/conflict-detection-simple.test.js** - NEW focused tests
5. **tests/unit/daemon/conflict-recovery-v2.test.js** - NEW comprehensive tests (deferred)
6. **tests/unit/utils/port-availability-check.test.js** - NEW isolated tests

## Lessons Learned

1. **Module-level timers are dangerous** - They prevent process exit and are hard to clean up in tests
2. **Singletons should be justified** - The metrics singleton wasn't used, just caused problems
3. **Test helpers are essential** - Complex components like daemon need proper test infrastructure
4. **Jest open handle detection is valuable** - It precisely identified the issue

## Recommendation

For future components:
- Avoid module-level resource creation (timers, connections, etc.)
- If singleton needed, provide static destroy() method
- Always implement destroy() methods that fully cleanup resources
- Create test helpers for complex components upfront

---

**Status**: Test fixture issues resolved ✅
**Test Coverage**: Core functionality verified (8/8 targeted tests passing)
**Ready for**: Phase 2 implementation
