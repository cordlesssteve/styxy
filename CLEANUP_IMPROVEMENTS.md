# Styxy Port Coordination Issue Prevention Plan

## Root Cause Analysis

The 58 stale allocations issue was caused by:

1. **Non-functional cleanup logic**: `cleanupStaleAllocations()` has TODO comment with no actual cleanup
2. **Conservative cleanup timing**: Only cleans allocations older than 1 hour
3. **No process validation**: Doesn't check if allocated processes are still alive
4. **No startup cleanup**: Stale state persists across daemon restarts

## Immediate Implementation Plan

### 1. Fix `cleanupStaleAllocations()` Method

Replace the existing TODO implementation with actual cleanup logic:

```javascript
/**
 * Cleanup stale allocations - IMPROVED VERSION
 */
async cleanupStaleAllocations() {
  try {
    let cleaned = 0;
    const staleAllocations = [];
    const now = new Date();

    for (const [port, allocation] of this.allocations) {
      const isStale = await this.isAllocationStale(allocation, now);
      if (isStale) {
        staleAllocations.push(port);
      }
    }

    // Remove stale allocations
    for (const port of staleAllocations) {
      const allocation = this.allocations.get(port);
      this.allocations.delete(port);
      cleaned++;
      
      this.logger.info('Cleaned stale allocation', {
        port,
        serviceType: allocation.serviceType,
        allocatedAt: allocation.allocated_at,
        reason: 'process_dead_or_expired'
      });
    }

    if (cleaned > 0) {
      await this.saveState();
      this.lastCleanup = new Date().toISOString();
      this.metrics.incrementCounter('stale_allocations_cleaned_total', cleaned);
    }

    // Log cleanup summary periodically
    if (this.allocations.size > 0 && this.allocations.size % 10 === 0) {
      this.logger.debug('Cleanup summary', {
        totalAllocations: this.allocations.size,
        cleanedThisRun: cleaned
      });
    }

  } catch (error) {
    this.logger.error('Cleanup failed', { error: error.message });
    this.metrics.incrementCounter('cleanup_errors_total');
  }
}
```

### 2. Add `isAllocationStale()` Helper Method

```javascript
/**
 * Check if an allocation is stale
 */
async isAllocationStale(allocation, now = new Date()) {
  // 1. Check allocation age (reduce from 1 hour to 30 minutes)
  const allocatedAt = new Date(allocation.allocated_at);
  const minutesSinceAllocation = (now - allocatedAt) / (1000 * 60);
  
  if (minutesSinceAllocation > 30) {
    return true;
  }

  // 2. Check if process is still alive
  if (allocation.process_id) {
    try {
      // Use kill(pid, 0) to check if process exists without killing it
      process.kill(allocation.process_id, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        // Process doesn't exist
        return true;
      }
      // Other errors (EPERM, etc.) mean process exists but we can't signal it
    }
  }

  // 3. Check if port is actually in use by the process
  try {
    const portInfo = await this.portScanner.getPortInfo(allocation.port);
    if (portInfo && portInfo.pid && portInfo.pid !== allocation.process_id) {
      // Port is being used by a different process
      return true;
    }
  } catch (error) {
    // If we can't check port usage, don't consider it stale based on this alone
  }

  return false;
}
```

### 3. Reduce Cleanup Interval

Change from 30 seconds to 10 seconds for faster detection:

```javascript
startCleanupTimer() {
  this.cleanupInterval = setInterval(async () => {
    await this.cleanupStaleAllocations();
  }, 10000); // Reduced from 30000ms to 10000ms (10 seconds)
}
```

### 4. Add Startup Cleanup

Add this to the `start()` method after loading state:

```javascript
async start() {
  try {
    // ... existing startup code ...
    
    // Load previous state with recovery
    await this.loadState();
    
    // NEW: Perform startup cleanup to clear stale allocations
    await this.performStartupCleanup();
    
    // ... rest of startup code ...
  } catch (error) {
    // ... error handling ...
  }
}

/**
 * Perform cleanup at startup to clear stale allocations from previous runs
 */
async performStartupCleanup() {
  try {
    this.logger.info('Performing startup cleanup');
    const result = await this.performCleanup(false);
    
    if (result.cleaned > 0) {
      this.logger.info('Startup cleanup completed', {
        cleaned: result.cleaned,
        message: result.message
      });
    }
  } catch (error) {
    this.logger.warn('Startup cleanup failed', { error: error.message });
    // Don't fail startup if cleanup fails
  }
}
```

### 5. Enhanced State Validation

Add validation before saving state:

```javascript
async saveState() {
  try {
    // NEW: Validate allocations before saving
    const validAllocations = [];
    const now = new Date();
    
    for (const [port, allocation] of this.allocations) {
      const isStale = await this.isAllocationStale(allocation, now);
      if (!isStale) {
        validAllocations.push({ ...allocation, port });
      } else {
        this.logger.debug('Excluding stale allocation from state save', {
          port,
          serviceType: allocation.serviceType
        });
      }
    }

    const state = {
      saved_at: new Date().toISOString(),
      allocations: validAllocations,
      instances: Array.from(this.instances.entries()).map(([id, instance]) => ({
        ...instance,
        id
      }))
    };

    // ... rest of save logic ...
  } catch (error) {
    // ... error handling ...
  }
}
```

## Implementation Priority

1. **HIGH PRIORITY** (implement immediately):
   - Fix `cleanupStaleAllocations()` method
   - Add `isAllocationStale()` helper
   - Reduce cleanup interval to 10 seconds
   - Add startup cleanup

2. **MEDIUM PRIORITY** (implement this week):
   - Enhanced state validation
   - Add allocation TTL with renewal
   - Improve process validation

3. **LOW PRIORITY** (future improvements):
   - Circuit breaker for cleanup operations
   - Comprehensive monitoring
   - Lease-based allocation system

## Testing the Fix

After implementation, test with:

```bash
# 1. Create test allocations
./bin/styxy allocate -s dev -n test1
./bin/styxy allocate -s dev -n test2

# 2. Kill the processes that created allocations

# 3. Wait 10 seconds and check cleanup
./bin/styxy list -v

# 4. Restart daemon and verify startup cleanup
./bin/styxy daemon stop
./bin/styxy daemon start
./bin/styxy list -v
```

This plan addresses the root cause and prevents future accumulation of stale allocations.