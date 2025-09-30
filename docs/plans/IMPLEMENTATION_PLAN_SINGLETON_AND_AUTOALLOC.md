# Implementation Plan: Single-Instance Services & Smart Auto-Allocation
**Status:** ACTIVE
**Created:** 2025-09-30
**Target Completion:** 2025-10-02
**Related:** [FEATURE_BACKLOG.md](../../FEATURE_BACKLOG.md)
**Features:** #1 Single-Instance Service Configuration, #2 Smart Auto-Allocation

---

## Executive Summary

Implementing two interconnected features to enhance Styxy's port management capabilities:
1. **Single-Instance Service Configuration**: Prevent multiple instances of services that cannot support concurrency (e.g., RAG service with ChromaDB)
2. **Smart Auto-Allocation**: Automatically configure port ranges for unknown services without manual intervention

**Total Estimated Effort:** 15 hours (~2 work days)
**Implementation Priority:** Feature #1 → Feature #2 (logical dependency)

---

## Feature #1: Single-Instance Service Configuration

### Objective
Enable services to declare single-instance behavior, preventing port allocation conflicts and resource waste when multiple Claude Code sessions attempt to start the same service.

### Current Pain Point
RAG service requires custom flock-based shell script for instance protection. This approach:
- Duplicates logic across multiple services
- Requires manual script maintenance per service
- Doesn't integrate with Styxy's coordination system

### Solution Design

#### Architecture Changes
```
Daemon State (in-memory):
  allocations: Map<lockId, AllocationInfo>
  instances: Map<instanceId, InstanceInfo>
  + singletonServices: Map<serviceType, SingletonInfo>  // NEW

SingletonInfo {
  serviceType: string,
  port: number,
  lockId: string,
  instanceId: string,
  pid: number,
  allocatedAt: timestamp
}

Config Schema:
  service_types[type].instance_behavior: "single" | "multi" (default)
```

#### Allocation Flow with Singleton Check
```
POST /allocate { serviceType, instanceId, ... }
  ↓
Check: service_types[serviceType].instance_behavior === "single"?
  ↓ YES
  ↓
Check: singletonServices.has(serviceType)?
  ↓ YES                              ↓ NO
  ↓                                  ↓
Return existing allocation         Allocate normally
{ port, existing: true }           Register as singleton
                                   Return new allocation
```

---

### Task Breakdown - Feature #1

#### Phase 1.1: Configuration Schema (Priority: Critical)
**Duration:** 30 minutes
**Dependencies:** None

- [ ] **Task 1.1.1**: Update config schema in `config/core-ports.json`
  - Add `instance_behavior` field to service type definition
  - Set `"ai"` service type to `"single"` as pilot
  - Document field in JSON schema comments
  - **Verification:** Config loads without errors, schema validation passes

- [ ] **Task 1.1.2**: Update config validator
  - File: `src/utils/validator.js`
  - Add validation for `instance_behavior` field (must be "single" or "multi")
  - **Verification:** Run validator with test config containing both values

**Acceptance Criteria:**
- ✅ Config loads with new field without errors
- ✅ Validator accepts "single" and "multi", rejects invalid values
- ✅ Default behavior is "multi" when field omitted

---

#### Phase 1.2: State Management (Priority: Critical)
**Duration:** 1 hour
**Dependencies:** 1.1

- [ ] **Task 1.2.1**: Add singleton tracking to daemon state
  - File: `src/daemon.js`
  - Add `this.singletonServices = new Map()` in constructor (line ~54)
  - Add methods:
    - `registerSingleton(serviceType, allocationInfo)`
    - `getSingleton(serviceType)`
    - `releaseSingleton(serviceType)`
  - **Verification:** Unit test singleton map operations

- [ ] **Task 1.2.2**: Integrate singleton state with persistence
  - File: `src/utils/state-manager.js`
  - Add `singletonServices` to state save/load operations
  - Ensure singleton state survives daemon restarts
  - **Verification:** Restart daemon, verify singleton info restored

**Acceptance Criteria:**
- ✅ Singleton map operations work correctly
- ✅ Singleton state persists across daemon restarts
- ✅ Cleanup removes singleton entries properly

---

#### Phase 1.3: Allocation Logic (Priority: Critical)
**Duration:** 1 hour
**Dependencies:** 1.2

- [ ] **Task 1.3.1**: Implement singleton check in allocation
  - File: `src/daemon.js`, method: `allocatePort()`
  - Before port allocation, check:
    ```javascript
    if (serviceType.instance_behavior === 'single') {
      const existing = this.getSingleton(serviceType.name);
      if (existing) {
        return {
          ...existing,
          existing: true,
          message: `Service '${serviceType.name}' only allows single instance`
        };
      }
    }
    ```
  - **Verification:** Unit test returns existing allocation for singleton

- [ ] **Task 1.3.2**: Register singleton after successful allocation
  - After port allocated, if `instance_behavior === 'single'`:
    ```javascript
    this.registerSingleton(serviceType.name, {
      serviceType: serviceType.name,
      port, lockId, instanceId, pid, allocatedAt: Date.now()
    });
    ```
  - **Verification:** Second allocation returns first allocation's port

**Acceptance Criteria:**
- ✅ First allocation for singleton service succeeds normally
- ✅ Second allocation returns existing port, no new port allocated
- ✅ Response includes `existing: true` flag for reused allocations

---

#### Phase 1.4: Cleanup Integration (Priority: High)
**Duration:** 30 minutes
**Dependencies:** 1.3

- [ ] **Task 1.4.1**: Update release endpoint
  - File: `src/daemon.js`, endpoint: `DELETE /allocate/:lockId`
  - On release, check if allocation is singleton
  - Call `this.releaseSingleton(serviceType)` to allow new allocation
  - **Verification:** After release, new allocation creates new singleton

- [ ] **Task 1.4.2**: Update cleanup process
  - File: `src/daemon.js`, method: `cleanupStaleAllocations()`
  - When cleaning stale allocation, also clean singleton entry
  - **Verification:** Stale singleton gets cleaned up, new allocation succeeds

**Acceptance Criteria:**
- ✅ Releasing singleton allocation allows new allocation
- ✅ Stale singleton allocations get cleaned up automatically
- ✅ No orphaned singleton entries after cleanup

---

#### Phase 1.5: CLI Enhancement (Priority: Medium)
**Duration:** 30 minutes
**Dependencies:** 1.3

- [ ] **Task 1.5.1**: Update CLI allocate command
  - File: `src/index.js`, command: `allocate`
  - Detect response with `existing: true` flag
  - Display distinct message:
    ```
    ℹ Service 'ai' uses single-instance mode
    ↪ Connected to existing instance on port 11400 (PID: 12345)
    ```
  - **Verification:** Manual test with singleton service

- [ ] **Task 1.5.2**: Update help documentation
  - Add explanation of single-instance behavior to CLI help
  - **Verification:** `styxy allocate --help` shows singleton info

**Acceptance Criteria:**
- ✅ CLI clearly distinguishes new vs reused allocations
- ✅ Help text explains single-instance behavior

---

#### Phase 1.6: Testing (Priority: Critical)
**Duration:** 1 hour
**Dependencies:** All 1.x tasks

- [ ] **Task 1.6.1**: Unit tests
  - File: `tests/unit/daemon/singleton-allocation.test.js`
  - Test cases:
    - First allocation creates singleton
    - Second allocation returns existing
    - Release allows new allocation
    - Multi-instance services unaffected
  - **Verification:** `npm run test:unit` passes

- [ ] **Task 1.6.2**: Integration tests
  - File: `tests/integration/api/singleton-coordination.test.js`
  - Test cases:
    - 5 concurrent allocation requests for singleton service
    - All receive same port
    - State consistency verified
  - **Verification:** `npm run test:integration` passes

- [ ] **Task 1.6.3**: E2E test - RAG service scenario
  - File: `tests/e2e/scenarios/rag-service-multi-claude.test.js`
  - Simulate:
    1. 3 Claude Code instances start simultaneously
    2. All request RAG service allocation
    3. Only 1 port allocated, all receive same port
    4. First instance releases → second can claim
  - **Verification:** `npm run test:e2e` passes

**Acceptance Criteria:**
- ✅ All unit tests pass (>95% coverage for new code)
- ✅ Integration tests verify concurrent safety
- ✅ E2E test validates real-world RAG scenario

---

### Feature #1 Success Metrics
- [ ] Zero port conflicts for RAG service with 5 simultaneous Claude instances
- [ ] flock-based script can be replaced with Styxy singleton config
- [ ] Performance: Singleton check adds <5ms overhead to allocation
- [ ] No breaking changes to existing multi-instance services

---

## Feature #2: Smart Auto-Allocation

### Objective
Eliminate manual configuration friction when adopting new development tools by automatically allocating port ranges for unknown services.

### Current Pain Point
When user tries new tool (Grafana, Jaeger, etc.):
1. Allocation fails: "Unknown service type 'grafana'"
2. User must manually edit `config/core-ports.json`
3. Must understand existing port ranges to avoid conflicts
4. Must restart daemon to reload config
5. Can finally retry allocation

This 5-step process interrupts workflow and creates adoption friction.

### Solution Design

#### Architecture Changes
```
Config Schema:
  + auto_allocation: {
      enabled: true,
      default_chunk_size: 10,
      placement: "after" | "before" | "smart",
      min_port: 10000,
      max_port: 65000,
      preserve_gaps: true,
      gap_size: 10
    }
  + auto_allocation_rules: {
      "monitoring-*": { chunk_size: 20, preferred_range_start: 9000 },
      "database-*": { chunk_size: 5, preferred_range_start: 5400 }
    }

New Components:
  - RangeAnalyzer: Find safe port ranges
  - ConfigWriter: Atomic config file updates
  - AuditLogger: Track auto-allocation events
```

#### Auto-Allocation Flow
```
POST /allocate { serviceType: "grafana", ... }
  ↓
Check: serviceTypes.has("grafana")?
  ↓ NO
  ↓
Check: auto_allocation.enabled?
  ↓ YES
  ↓
Find safe range: RangeAnalyzer.findNextAvailableRange(10, "after")
  → Returns: [10100, 10109]
  ↓
Verify no collisions: PortScanner.checkRange([10100, 10109])
  ↓
Update config: ConfigWriter.addServiceType("grafana", [10100, 10109])
  ↓
Reload service types: this.serviceTypes = this.loadServiceTypes()
  ↓
Allocate from new range: allocatePort("grafana", ...)
  ↓
Log audit event: AuditLogger.log("auto-allocate", ...)
  ↓
Return: { port: 10100, autoAllocated: true, newRange: [10100, 10109] }
```

---

### Task Breakdown - Feature #2

#### Phase 2.1: Configuration Schema (Priority: Critical)
**Duration:** 30 minutes
**Dependencies:** Feature #1 complete

- [ ] **Task 2.1.1**: Add auto-allocation config section
  - File: `config/core-ports.json`
  - Add top-level `auto_allocation` configuration object
  - Add `auto_allocation_rules` for pattern-based overrides
  - Set `enabled: false` initially (opt-in for testing)
  - **Verification:** Config loads, validator accepts new fields

- [ ] **Task 2.1.2**: Update config validator
  - File: `src/utils/validator.js`
  - Validate auto-allocation config structure
  - Validate pattern rules (chunk_size > 0, ports in valid range)
  - **Verification:** Invalid configs rejected with clear errors

**Acceptance Criteria:**
- ✅ Config loads with auto-allocation settings
- ✅ Validator enforces constraints (chunk_size, port ranges)
- ✅ Default behavior is disabled (opt-in)

---

#### Phase 2.2: Range Analysis (Priority: Critical)
**Duration:** 2 hours
**Dependencies:** 2.1

- [ ] **Task 2.2.1**: Create RangeAnalyzer utility
  - File: `src/utils/range-analyzer.js`
  - Methods:
    - `findNextAvailableRange(chunkSize, placement, config)`
    - `findGapInRanges(existingRanges, requiredSize)`
    - `calculateSmartPlacement(serviceType, existingRanges)`
  - **Verification:** Unit tests for all placement strategies

- [ ] **Task 2.2.2**: Implement "after" placement strategy
  - Find highest used port across all service types
  - Add gap_size buffer
  - Return range: `[maxPort + gap, maxPort + gap + chunkSize - 1]`
  - **Verification:** Unit test with mock service types

- [ ] **Task 2.2.3**: Implement "before" placement strategy
  - Find lowest used port across all service types
  - Subtract chunk_size + gap_size
  - Verify doesn't go below min_port
  - **Verification:** Unit test, verify min_port boundary

- [ ] **Task 2.2.4**: Implement "smart" placement strategy
  - Analyze service type patterns (monitoring, database, etc.)
  - Find ranges for similar service types
  - Look for gaps near similar services
  - Fallback to "after" if no smart placement possible
  - **Verification:** Unit test with realistic service type map

- [ ] **Task 2.2.5**: Add collision detection
  - Method: `detectCollisions(proposedRange, existingRanges)`
  - Check proposed range against:
    - All existing service type ranges
    - OS-level port usage via PortScanner
  - **Verification:** Unit test with overlapping ranges

**Acceptance Criteria:**
- ✅ All placement strategies produce non-overlapping ranges
- ✅ Collision detection catches conflicts with existing allocations
- ✅ Range respects min_port/max_port boundaries
- ✅ Gaps properly maintained between ranges

---

#### Phase 2.3: Config File Writer (Priority: Critical)
**Duration:** 1.5 hours
**Dependencies:** 2.2

- [ ] **Task 2.3.1**: Create ConfigWriter utility
  - File: `src/utils/config-writer.js`
  - Methods:
    - `addServiceType(name, range, metadata, options)`
    - `lockConfigFile()`
    - `unlockConfigFile()`
    - `createBackup()`
    - `writeAtomically(data)`
  - **Verification:** Unit tests for atomic operations

- [ ] **Task 2.3.2**: Implement file locking
  - Use `proper-lockfile` (already in dependencies)
  - Acquire exclusive lock before config modification
  - Handle lock timeout gracefully
  - **Verification:** Test concurrent write attempts

- [ ] **Task 2.3.3**: Implement backup creation
  - Before modifying config, create timestamped backup:
    - `~/.styxy/backups/core-ports.json.YYYY-MM-DD-HHmmss`
  - Keep last 10 backups, delete older
  - **Verification:** Test backup rotation

- [ ] **Task 2.3.4**: Implement atomic write
  - Write to temp file: `core-ports.json.tmp`
  - Verify JSON validity
  - Atomic rename to `core-ports.json`
  - **Verification:** Verify no partial writes on failure

- [ ] **Task 2.3.5**: Update PORT_MANAGEMENT.md (if exists)
  - File: `~/docs/CORE/PORT_MANAGEMENT.md`
  - Append new service type to documentation
  - Format: `| service-type | 10100-10109 | Auto-allocated 2025-09-30 |`
  - **Verification:** Manual inspection, optional feature

**Acceptance Criteria:**
- ✅ Config updates are atomic (no partial writes)
- ✅ File locking prevents concurrent modifications
- ✅ Backups created before each modification
- ✅ Failed writes don't corrupt config file

---

#### Phase 2.4: Audit Logging (Priority: Medium)
**Duration:** 1 hour
**Dependencies:** 2.3

- [ ] **Task 2.4.1**: Create AuditLogger utility
  - File: `src/utils/audit-logger.js`
  - Log to: `~/.styxy/audit.log`
  - Log format (JSON lines):
    ```json
    {
      "timestamp": "2025-09-30T12:34:56.789Z",
      "action": "auto-allocate",
      "serviceType": "grafana",
      "range": [10100, 10109],
      "chunkSize": 10,
      "placement": "after",
      "user": "cordlesssteve",
      "pid": 12345
    }
    ```
  - **Verification:** Unit test writes proper JSON

- [ ] **Task 2.4.2**: Implement log rotation
  - Rotate when audit.log exceeds 10MB
  - Keep last 5 rotated logs
  - **Verification:** Test with large log file

- [ ] **Task 2.4.3**: Add audit query methods
  - Methods:
    - `getRecentAudits(limit)`
    - `getAuditsByAction(action)`
    - `getAuditsByServiceType(serviceType)`
  - **Verification:** Unit tests for filtering

**Acceptance Criteria:**
- ✅ All auto-allocations logged with full context
- ✅ Log rotation prevents unbounded growth
- ✅ Audit queries work correctly

---

#### Phase 2.5: Auto-Allocation Logic (Priority: Critical)
**Duration:** 2 hours
**Dependencies:** 2.2, 2.3, 2.4

- [ ] **Task 2.5.1**: Implement unknown service detection
  - File: `src/daemon.js`, method: `allocatePort()`
  - After receiving allocation request:
    ```javascript
    if (!this.serviceTypes.has(serviceType)) {
      if (this.autoAllocationConfig.enabled) {
        return await this.handleUnknownService(serviceType, options);
      } else {
        throw ErrorFactory.unknownServiceType(serviceType);
      }
    }
    ```
  - **Verification:** Unit test triggers auto-allocation path

- [ ] **Task 2.5.2**: Implement handleUnknownService method
  - Steps:
    1. Check auto-allocation rules for matching pattern
    2. Get chunk_size and placement strategy
    3. Call RangeAnalyzer.findNextAvailableRange()
    4. Verify no collisions
    5. Lock config file
    6. Create backup
    7. Update config with new service type
    8. Unlock config file
    9. Reload service types
    10. Log audit event
    11. Retry allocation (now should succeed)
  - **Verification:** Integration test for full flow

- [ ] **Task 2.5.3**: Handle auto-allocation failures gracefully
  - If range finding fails (no space), throw informative error
  - If config write fails, rollback and throw error
  - If collision detected, try different placement
  - **Verification:** Test failure scenarios

- [ ] **Task 2.5.4**: Add confirmation mode (optional)
  - If `require_confirmation: true` in config:
    - Don't auto-allocate immediately
    - Return proposal to CLI: `{ proposal: { range, placement, reason } }`
    - CLI prompts user: "Auto-allocate ports X-Y? [y/N]"
    - User confirms via new endpoint: `POST /auto-allocate/confirm`
  - **Verification:** Manual test with confirmation mode

**Acceptance Criteria:**
- ✅ Unknown service automatically allocated without errors
- ✅ Config updated correctly with new service type
- ✅ Subsequent allocations use newly created service type
- ✅ Failures handled gracefully with clear error messages

---

#### Phase 2.6: CLI Enhancement (Priority: High)
**Duration:** 1.5 hours
**Dependencies:** 2.5

- [ ] **Task 2.6.1**: Update allocate command output
  - File: `src/index.js`, command: `allocate`
  - Detect `autoAllocated: true` in response
  - Display message:
    ```
    ✨ New service type 'grafana' automatically configured
    📋 Range: 10100-10109 (10 ports)
    ✅ Allocated port: 10100
    ```
  - **Verification:** Manual test with unknown service

- [ ] **Task 2.6.2**: Add auto-allocation management commands
  - `styxy config auto-allocation status`
    - Show: enabled, chunk_size, placement, recent auto-allocations
  - `styxy config auto-allocation enable/disable`
    - Toggle feature on/off
  - `styxy config auto-allocation set-rule <pattern> --chunk-size N --preferred-range X`
    - Configure pattern-based rules
  - **Verification:** Manual test all commands

- [ ] **Task 2.6.3**: Add rollback command
  - `styxy config undo-auto-allocation [service-type]`
  - If service-type specified: remove that service type from config
  - If not specified: remove last auto-allocated service type
  - Restore from backup if available
  - **Verification:** Test rollback after auto-allocation

**Acceptance Criteria:**
- ✅ CLI clearly indicates auto-allocation occurred
- ✅ Management commands work correctly
- ✅ Rollback command restores previous state

---

#### Phase 2.7: Testing (Priority: Critical)
**Duration:** 2 hours
**Dependencies:** All 2.x tasks

- [ ] **Task 2.7.1**: Unit tests
  - Files:
    - `tests/unit/utils/range-analyzer.test.js`
    - `tests/unit/utils/config-writer.test.js`
    - `tests/unit/utils/audit-logger.test.js`
  - Coverage target: >95% for new code
  - **Verification:** `npm run test:unit` passes

- [ ] **Task 2.7.2**: Integration tests
  - File: `tests/integration/api/auto-allocation.test.js`
  - Test cases:
    - Single unknown service auto-allocation
    - Multiple concurrent unknown services
    - Config update atomicity
    - Collision detection and retry
    - Pattern-based rule matching
  - **Verification:** `npm run test:integration` passes

- [ ] **Task 2.7.3**: E2E test - Grafana scenario
  - File: `tests/e2e/scenarios/grafana-auto-allocation.test.js`
  - Simulate:
    1. Fresh Styxy install (no Grafana config)
    2. User runs: `styxy allocate --service-type grafana --instance-id main`
    3. Verify: Grafana range auto-allocated, port returned
    4. Second allocation: uses same range, sequential port
    5. Check: `config/core-ports.json` contains grafana entry
    6. Check: `audit.log` contains auto-allocation event
  - **Verification:** Full flow works end-to-end

- [ ] **Task 2.7.4**: E2E test - Rollback scenario
  - File: `tests/e2e/scenarios/auto-allocation-rollback.test.js`
  - Simulate:
    1. Auto-allocate service "test-service"
    2. Verify config updated
    3. Run: `styxy config undo-auto-allocation test-service`
    4. Verify: Config no longer contains test-service
    5. Verify: Backup exists with previous state
  - **Verification:** Rollback restores correct state

- [ ] **Task 2.7.5**: Stress test - Concurrent unknown services
  - File: `tests/stress/concurrent-auto-allocation.test.js`
  - Simulate:
    - 10 concurrent requests for different unknown services
    - Verify: All get unique non-overlapping ranges
    - Verify: Config consistent after all complete
  - **Verification:** No race conditions, all allocations succeed

**Acceptance Criteria:**
- ✅ All unit tests pass (>95% coverage)
- ✅ Integration tests verify concurrent safety
- ✅ E2E tests validate real-world scenarios
- ✅ Stress tests confirm no race conditions

---

### Feature #2 Success Metrics
- [ ] Zero manual config edits needed for new tools (Grafana, Jaeger, etc.)
- [ ] Auto-allocation completes in <100ms (excluding file I/O)
- [ ] 100% success rate for finding non-conflicting ranges
- [ ] Audit trail captures all auto-allocations for troubleshooting
- [ ] Rollback works correctly for accidental auto-allocations

---

## Cross-Feature Integration

### Dependencies Between Features
- Feature #1 config schema updates lay groundwork for Feature #2
- Feature #2 ConfigWriter can be used to update `instance_behavior` dynamically (future enhancement)
- Both features use enhanced error handling from existing ErrorFactory

### Combined Testing
- [ ] **Task X.1**: Integration test combining both features
  - Auto-allocate singleton service
  - Verify only one instance allowed
  - Verify second request reuses first allocation
  - **File:** `tests/integration/combined/singleton-auto-allocation.test.js`

---

## Timeline & Milestones

### Day 1: Feature #1 Implementation
- **Morning (4 hours)**
  - Phase 1.1: Config schema ✓
  - Phase 1.2: State management ✓
  - Phase 1.3: Allocation logic ✓
- **Afternoon (2 hours)**
  - Phase 1.4: Cleanup integration ✓
  - Phase 1.5: CLI enhancement ✓
  - Phase 1.6: Testing (start) ⏳

### Day 1 Evening: Feature #1 Completion
- **Evening (2 hours)**
  - Phase 1.6: Testing (complete) ✓
  - Feature #1 verification and documentation ✓

### Day 2: Feature #2 Implementation
- **Morning (4 hours)**
  - Phase 2.1: Config schema ✓
  - Phase 2.2: Range analysis ✓
  - Phase 2.3: Config writer (start) ⏳
- **Afternoon (3 hours)**
  - Phase 2.3: Config writer (complete) ✓
  - Phase 2.4: Audit logging ✓
  - Phase 2.5: Auto-allocation logic (start) ⏳

### Day 2 Evening: Feature #2 Completion
- **Evening (3 hours)**
  - Phase 2.5: Auto-allocation logic (complete) ✓
  - Phase 2.6: CLI enhancement ✓
  - Phase 2.7: Testing (start) ⏳

### Day 3: Testing & Polish (if needed)
- **Morning (2 hours)**
  - Phase 2.7: Testing (complete) ✓
  - Cross-feature integration testing ✓
- **Afternoon (1 hour)**
  - Documentation updates
  - CURRENT_STATUS.md update
  - Feature backlog status update

---

## Risk Assessment & Mitigation

### High Risk Items

#### Risk 1: Config File Corruption During Auto-Allocation
**Probability:** Medium | **Impact:** High
**Mitigation:**
- Atomic writes via temp file + rename
- File locking prevents concurrent modifications
- Automatic backups before each modification
- Validation before writing
- Rollback command available

#### Risk 2: Race Conditions in Concurrent Auto-Allocation
**Probability:** Medium | **Impact:** Medium
**Mitigation:**
- File locking ensures sequential config updates
- Range analysis happens within lock
- Reload service types after config update
- Stress tests verify concurrent safety

#### Risk 3: Port Range Exhaustion
**Probability:** Low | **Impact:** Medium
**Mitigation:**
- Detect exhaustion and fail gracefully with clear message
- Configurable port boundaries (min/max)
- Smart placement finds gaps in existing ranges
- User can manually clean up unused service types

### Medium Risk Items

#### Risk 4: Singleton State Desync After Crash
**Probability:** Medium | **Impact:** Low
**Mitigation:**
- Singleton state persists to disk
- Cleanup on startup verifies singleton PIDs still running
- Stale singleton detection removes dead entries

#### Risk 5: Auto-Allocation Creates Suboptimal Port Layout
**Probability:** High | **Impact:** Low
**Mitigation:**
- Default "after" placement is safe and predictable
- "smart" placement groups similar services
- User can configure pattern rules for better organization
- Manual config editing still supported

---

## Rollback Plan

### If Feature #1 Has Issues
1. Revert config schema changes (remove `instance_behavior` field)
2. Remove singleton tracking from daemon state
3. Revert allocation logic changes
4. Keep custom flock-based scripts for RAG service
5. Git revert commits related to Feature #1

### If Feature #2 Has Issues
1. Set `auto_allocation.enabled: false` in config
2. Feature automatically disabled, no behavior change
3. Fix issues in next iteration
4. Re-enable when stable
5. Worst case: Git revert Feature #2 commits (Feature #1 unaffected)

### Emergency Rollback (Both Features)
1. Git tag before starting: `git tag pre-singleton-autoalloc`
2. Full rollback: `git reset --hard pre-singleton-autoalloc`
3. Restart daemon with previous version
4. Previous config and state files still compatible

---

## Documentation Requirements

### Files to Create/Update

#### Create New Documentation
- [ ] `docs/reference/03-development/singleton-services.md`
  - Explain single-instance configuration
  - List services configured as singleton
  - Troubleshooting singleton issues

- [ ] `docs/reference/03-development/auto-allocation.md`
  - How auto-allocation works
  - Configuration options
  - Pattern-based rules
  - Rollback procedures

#### Update Existing Documentation
- [ ] `README.md`
  - Add singleton service section
  - Add auto-allocation section
  - Update feature list

- [ ] `docs/reference/02-apis/allocation-api.md`
  - Document `existing: true` response field
  - Document `autoAllocated: true` response field
  - Update allocation endpoint examples

- [ ] `docs/reference/01-architecture/state-management.md`
  - Document singleton state structure
  - Document audit log format

- [ ] `CURRENT_STATUS.md`
  - Move features from "Completed" to Feature Backlog
  - Update with Feature #1 and #2 completion dates

- [ ] `FEATURE_BACKLOG.md`
  - Move Feature #1 and #2 to "Completed Features"
  - Add implementation dates

---

## Success Criteria Checklist

### Feature #1: Single-Instance Service Configuration
- [ ] Config supports `instance_behavior: "single"` field
- [ ] First allocation for singleton service succeeds
- [ ] Second allocation returns existing port (no new allocation)
- [ ] Cleanup releases singleton, allows new allocation
- [ ] Multi-instance services unaffected
- [ ] RAG service scenario: 5 Claude instances share 1 port
- [ ] flock script can be replaced with config change
- [ ] All tests pass (unit, integration, e2e)
- [ ] Documentation complete

### Feature #2: Smart Auto-Allocation
- [ ] Unknown service type triggers auto-allocation
- [ ] Port range automatically added to config
- [ ] Subsequent allocations use new service type
- [ ] No collisions with existing services
- [ ] Audit log captures all auto-allocations
- [ ] Rollback command works correctly
- [ ] CLI commands for management work
- [ ] Grafana scenario: zero config, port allocated
- [ ] Concurrent unknown services get unique ranges
- [ ] All tests pass (unit, integration, e2e, stress)
- [ ] Documentation complete

### Combined
- [ ] Both features work together (singleton + auto-allocated)
- [ ] No performance degradation (allocation <100ms)
- [ ] No breaking changes to existing functionality
- [ ] Ready for production use

---

## Post-Implementation Tasks

### After Feature #1 Completion
1. Update RAG service startup script to use Styxy singleton config
2. Remove flock-based protection logic
3. Test with 5 simultaneous Claude Code sessions
4. Document migration path for other services (ChromaDB, Ollama, etc.)

### After Feature #2 Completion
1. Enable auto-allocation in production config
2. Monitor audit log for auto-allocation events
3. Gather user feedback on placement strategies
4. Consider community-driven port convention database

### Future Enhancements (Not in Scope)
- Web UI for visualizing port allocations
- Export port map to documentation format
- Integration with Docker Compose port generation
- Kubernetes port allocation coordination
- Dynamic port optimization (defragmentation)

---

## Review & Sign-Off

### Pre-Implementation Review
- [ ] Architecture reviewed and approved
- [ ] Risk assessment reviewed
- [ ] Timeline realistic and achievable
- [ ] Dependencies identified and manageable

### Post-Implementation Review
- [ ] All tasks completed
- [ ] All tests passing
- [ ] Documentation complete
- [ ] CURRENT_STATUS.md updated
- [ ] Ready for production use

---

**Next Action:** Begin implementation with Phase 1.1 - Configuration Schema