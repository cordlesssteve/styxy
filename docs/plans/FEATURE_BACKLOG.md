# Styxy Feature Backlog

**Status**: ACTIVE
**Last Updated**: 2025-09-30
**Purpose**: Track planned features, improvements, and technical debt items

---

## Priority Legend

- **P0**: Critical - Blocks production use
- **P1**: High - Important for production quality
- **P2**: Medium - Nice to have, improves UX/performance
- **P3**: Low - Future optimization, polish

---

## Backlog Items

### P1: Fix Auto-Allocation Gap Spacing Race Condition

**Issue**: Under extreme concurrent load (10+ simultaneous unknown services), gap spacing between auto-allocated ranges can be suboptimal due to range calculation happening before lock acquisition.

**Current Behavior**:
- Multiple concurrent auto-allocations read config state before acquiring lock
- Each process calculates range based on potentially stale data
- Result: Gaps may be 0-9 ports instead of configured 10 ports
- No overlaps occur (file locking prevents), but spacing is tighter than optimal

**Example**:
```
Expected: 10000-10009 [gap:10] 10020-10029 [gap:10] 10040-10049
Actual:   10000-10009 [gap:5]  10015-10024 [gap:3]  10028-10037
```

**Root Cause**:
Range calculation in `handleAutoAllocation()` (src/daemon.js:763-768) occurs BEFORE ConfigWriter acquires file lock:

```javascript
// Current flow:
1. Mark service as "in progress" (prevents duplicate allocation of SAME type)
2. RangeAnalyzer.findNextAvailableRange(...) // reads config, NO LOCK
3. configWriter.addServiceType(...) // acquires lock, writes calculated range
```

**Proposed Solution**:
Move range calculation inside the locked section:

```javascript
// Option 1: Move calculation into ConfigWriter
await configWriter.lockConfigFile();
try {
  const currentConfig = configWriter.loadUserConfig();
  const existingRanges = RangeAnalyzer.extractRanges(currentConfig.service_types);
  const [startPort, endPort] = RangeAnalyzer.findNextAvailableRange(...);
  // Write immediately while holding lock
  await configWriter.writeServiceType(serviceType, [startPort, endPort], metadata);
} finally {
  await release();
}

// Option 2: Create atomic allocateWithLock() method
await configWriter.atomicAllocate(serviceType, (currentConfig) => {
  // This callback runs inside the lock
  const ranges = RangeAnalyzer.extractRanges(currentConfig.service_types);
  return RangeAnalyzer.findNextAvailableRange(...);
});
```

**Verification**:
- Modify stress test `tests/stress/concurrent-auto-allocation.test.js`
- Verify all gaps are >= configured gap_size under 10+ concurrent allocations
- Ensure no performance degradation (lock held for minimal time)

**Impact**:
- **User Impact**: Low (only affects extreme concurrent scenarios)
- **Code Changes**: Medium (refactor ConfigWriter + handleAutoAllocation)
- **Testing**: High (stress tests must all pass)
- **Risk**: Low (file locking already prevents corruption)

**Discovered By**: Stress test suite (tests/stress/concurrent-auto-allocation.test.js)
**Related Tests**:
- `tests/stress/concurrent-auto-allocation.test.js:143` - "gaps should be preserved between ranges"
- `tests/stress/concurrent-auto-allocation.test.js:119` - "all allocated ranges should not overlap"

**Estimated Effort**: 4-6 hours
- Refactor ConfigWriter: 2 hours
- Update handleAutoAllocation: 1 hour
- Update tests: 1 hour
- Testing/validation: 2 hours

**Related Files**:
- `src/daemon.js` (handleAutoAllocation method)
- `src/utils/config-writer.js` (needs atomic allocate method)
- `src/utils/range-analyzer.js` (no changes needed)
- `tests/stress/concurrent-auto-allocation.test.js` (verification)

**Status**: Not Started
**Assigned**: Unassigned
**Target Version**: v1.1.0

---

## Future Enhancements

### P2: Web UI for Port Management

**Description**: Create web-based dashboard for visualizing port allocations, service types, and audit trail.

**Features**:
- Real-time port allocation visualization
- Service type management (add/remove/edit)
- Audit log viewer with filtering
- Metrics dashboard
- Configuration editor

**Estimated Effort**: 20-30 hours
**Status**: Not Started
**Target Version**: v2.0.0

---

### P2: Metrics Export to Prometheus

**Description**: Add `/metrics` endpoint that exports Styxy metrics in Prometheus format.

**Current State**: Metrics collected internally, no export mechanism
**Benefits**: Integration with existing monitoring infrastructure

**Estimated Effort**: 4-6 hours
**Status**: Not Started
**Target Version**: v1.2.0

---

### P3: Smart Range Consolidation

**Description**: Automatically consolidate fragmented port ranges when services are released.

**Example**:
```
Before: 10000-10009 [free] 10010-10019 [free] 10020-10029 [allocated]
After:  10000-10019 [free, consolidated] 10020-10029 [allocated]
```

**Estimated Effort**: 6-8 hours
**Status**: Not Started
**Target Version**: v1.3.0

---

### P3: Custom Placement Strategies

**Description**: Allow users to define custom placement strategies beyond 'after', 'before', 'smart'.

**Example**:
```json
{
  "placement_strategies": {
    "by-team": {
      "team-frontend": { "min_port": 3000, "max_port": 3999 },
      "team-backend": { "min_port": 8000, "max_port": 8999 }
    }
  }
}
```

**Estimated Effort**: 8-10 hours
**Status**: Not Started
**Target Version**: v2.0.0

---

## Completed Items

_(Moved from backlog to CURRENT_STATUS.md when completed)_

### ✅ Feature #1: Single-Instance Service Configuration
**Completed**: 2025-09-30
**Version**: v1.0.0

### ✅ Feature #2: Smart Auto-Allocation
**Completed**: 2025-09-30
**Version**: v1.0.0

---

## Contributing

When adding items to this backlog:

1. **Use descriptive titles** with clear problem statements
2. **Include technical details** about root cause and proposed solution
3. **Reference related code** (files, line numbers, tests)
4. **Estimate effort** realistically
5. **Set priority** based on user impact and technical risk
6. **Link to issues/tests** that discovered the item

## Backlog Review Schedule

- **Weekly**: Review P0/P1 items, update progress
- **Monthly**: Review P2/P3 items, reprioritize based on user feedback
- **Quarterly**: Archive completed items, plan next version features
