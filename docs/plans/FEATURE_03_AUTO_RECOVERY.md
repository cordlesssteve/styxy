# Feature #3: Three-Layer Auto-Recovery System

**Status**: ACTIVE
**Created**: 2025-09-30
**Target Version**: v1.1.0
**Priority**: P1 - High (Production quality resilience)

## Problem Statement

Styxy currently handles normal operation well but lacks automatic recovery from common failure scenarios:

1. **Port Conflicts**: When allocated port becomes unavailable (already in use)
2. **Service Crashes**: When a service using an allocated port crashes unexpectedly
3. **Daemon Failures**: When the Styxy daemon itself crashes or restarts

**Current Behavior**:
- Port conflicts cause allocation failures with no automatic recovery
- Service crashes leave "zombie" allocations in state
- Daemon crashes lose in-memory state (though persisted state is recovered)

**User Impact**: Manual intervention required for common failure scenarios

## Solution: Three-Layer Auto-Recovery System

Implement progressive recovery layers that handle failures at different scopes:

```
┌─────────────────────────────────────────────┐
│ Layer 3: Full System Recovery              │
│ (Daemon crash, state corruption)           │
├─────────────────────────────────────────────┤
│ Layer 2: Service Health Monitoring         │
│ (Service crashes, health check failures)   │
├─────────────────────────────────────────────┤
│ Layer 1: Port Conflict Recovery            │
│ (Port already in use, binding failures)    │
└─────────────────────────────────────────────┘
```

## Architecture

### Layer 1: Port Conflict Recovery

**Scope**: Individual port allocation failures
**Detection**: Port binding check during allocation
**Recovery**: Automatic reallocation to next available port

**Implementation**:

```javascript
// src/daemon.js
async allocatePortWithRetry(serviceType, options = {}) {
  const maxRetries = options.retries || 3;
  const conflicts = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const port = await this.allocatePort(serviceType, options);

    // Check if port is actually available
    const isAvailable = await this.checkPortAvailable(port);

    if (isAvailable) {
      return { port, attempt, conflicts };
    }

    // Port conflict detected
    conflicts.push(port);
    this.logger.warn(`Port ${port} conflict detected, retry ${attempt}/${maxRetries}`);

    if (attempt < maxRetries) {
      // Mark conflicted port as unavailable temporarily
      await this.markPortConflicted(port);

      // Exponential backoff before retry
      await this.sleep(Math.pow(2, attempt) * 100);
    }
  }

  throw new Error(`Failed to allocate port after ${maxRetries} retries. Conflicts: ${conflicts.join(', ')}`);
}

async checkPortAvailable(port) {
  // Try to bind to port briefly
  const net = require('net');
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false); // Port in use
      } else {
        resolve(false); // Other error, assume unavailable
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(true); // Port available
    });

    server.listen(port, '127.0.0.1');
  });
}
```

**Configuration** (in `config/core-ports.json`):

```json
{
  "recovery": {
    "port_conflict": {
      "enabled": true,
      "max_retries": 3,
      "backoff_ms": 100,
      "backoff_multiplier": 2
    }
  }
}
```

**Success Criteria**:
- ✅ Detects port conflicts during allocation
- ✅ Automatically retries with next available port
- ✅ Exponential backoff between retries
- ✅ Logs all conflicts for audit trail
- ✅ Fails gracefully after max retries

---

### Layer 2: Service Health Monitoring

**Scope**: Service lifecycle and health
**Detection**: Periodic health checks + event-based detection
**Recovery**: Automatic cleanup of stale allocations, optional service restart

**Implementation**:

```javascript
// src/utils/health-monitor.js
class HealthMonitor {
  constructor(daemon) {
    this.daemon = daemon;
    this.healthChecks = new Map(); // port -> { lastCheck, failures, pid }
    this.checkInterval = 30000; // 30 seconds
    this.maxFailures = 3;
  }

  async startMonitoring() {
    this.monitoringActive = true;
    this.monitoringTimer = setInterval(
      () => this.performHealthChecks(),
      this.checkInterval
    );
  }

  async performHealthChecks() {
    const allocations = await this.daemon.getAllAllocations();

    for (const allocation of allocations) {
      try {
        const healthy = await this.checkAllocation(allocation);

        if (!healthy) {
          await this.handleUnhealthyAllocation(allocation);
        } else {
          // Reset failure count on success
          this.healthChecks.set(allocation.port, {
            lastCheck: Date.now(),
            failures: 0,
            pid: allocation.pid
          });
        }
      } catch (error) {
        this.daemon.logger.error(`Health check failed for port ${allocation.port}:`, error);
      }
    }
  }

  async checkAllocation(allocation) {
    // Check 1: Process still running
    if (allocation.pid) {
      try {
        process.kill(allocation.pid, 0); // Signal 0 just checks existence
      } catch (err) {
        if (err.code === 'ESRCH') {
          this.daemon.logger.warn(`Process ${allocation.pid} for port ${allocation.port} not found`);
          return false;
        }
      }
    }

    // Check 2: Port still in use
    const portInUse = !(await this.daemon.checkPortAvailable(allocation.port));
    if (!portInUse) {
      this.daemon.logger.warn(`Port ${allocation.port} is no longer in use`);
      return false;
    }

    // Check 3: Service-specific health check (if configured)
    if (allocation.healthCheckUrl) {
      const healthy = await this.performHttpHealthCheck(allocation.healthCheckUrl);
      if (!healthy) {
        this.daemon.logger.warn(`Health check failed for ${allocation.healthCheckUrl}`);
        return false;
      }
    }

    return true;
  }

  async handleUnhealthyAllocation(allocation) {
    const check = this.healthChecks.get(allocation.port) || { failures: 0 };
    check.failures++;
    this.healthChecks.set(allocation.port, check);

    if (check.failures >= this.maxFailures) {
      this.daemon.logger.warn(
        `Allocation ${allocation.port} failed ${check.failures} health checks, releasing...`
      );

      // Release the stale allocation
      await this.daemon.releasePort(allocation.port);

      // Emit event for external monitoring
      this.daemon.emit('allocation:stale:released', allocation);

      // Clean up health check tracking
      this.healthChecks.delete(allocation.port);
    }
  }

  async performHttpHealthCheck(url, timeout = 5000) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeout)
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }
}
```

**Configuration**:

```json
{
  "recovery": {
    "health_monitoring": {
      "enabled": true,
      "check_interval_ms": 30000,
      "max_failures": 3,
      "cleanup_stale_allocations": true
    }
  }
}
```

**Success Criteria**:
- ✅ Periodic health checks for all allocations
- ✅ Detects dead processes (PID no longer exists)
- ✅ Detects abandoned ports (port not in use)
- ✅ Optional HTTP health checks for services
- ✅ Automatic cleanup after max failures
- ✅ Emits events for external monitoring

---

### Layer 3: Full System Recovery

**Scope**: Daemon-level failures and corruption
**Detection**: Daemon startup sequence
**Recovery**: State validation, corruption repair, orphan cleanup

**Implementation**:

```javascript
// src/utils/system-recovery.js
class SystemRecovery {
  constructor(daemon) {
    this.daemon = daemon;
  }

  async performRecoveryOnStartup() {
    this.daemon.logger.info('Performing system recovery checks...');

    const steps = [
      { name: 'Validate state file', fn: () => this.validateStateFile() },
      { name: 'Validate config file', fn: () => this.validateConfigFile() },
      { name: 'Clean orphaned allocations', fn: () => this.cleanOrphanedAllocations() },
      { name: 'Verify singleton integrity', fn: () => this.verifySingletonIntegrity() },
      { name: 'Rebuild indices', fn: () => this.rebuildIndices() },
    ];

    const results = {
      success: [],
      failed: [],
      warnings: []
    };

    for (const step of steps) {
      try {
        const result = await step.fn();
        results.success.push({ step: step.name, result });
        this.daemon.logger.info(`✅ ${step.name}: OK`);
      } catch (error) {
        results.failed.push({ step: step.name, error: error.message });
        this.daemon.logger.error(`❌ ${step.name}: FAILED`, error);

        // Attempt automatic repair
        await this.attemptRepair(step.name, error);
      }
    }

    return results;
  }

  async validateStateFile() {
    const statePath = this.daemon.statePath;

    if (!fs.existsSync(statePath)) {
      this.daemon.logger.warn('State file not found, will create new');
      return { created: true };
    }

    try {
      const stateData = JSON.parse(fs.readFileSync(statePath, 'utf8'));

      // Validate structure
      if (!stateData.allocations || !Array.isArray(stateData.allocations)) {
        throw new Error('Invalid state structure: missing allocations array');
      }

      if (!stateData.singletonServices || typeof stateData.singletonServices !== 'object') {
        throw new Error('Invalid state structure: missing singletonServices object');
      }

      return { valid: true, allocationCount: stateData.allocations.length };
    } catch (error) {
      throw new Error(`State file corrupted: ${error.message}`);
    }
  }

  async validateConfigFile() {
    const config = this.daemon.loadConfig();

    // Check for required fields
    const required = ['service_types'];
    for (const field of required) {
      if (!config[field]) {
        throw new Error(`Missing required config field: ${field}`);
      }
    }

    return { valid: true };
  }

  async cleanOrphanedAllocations() {
    const allocations = await this.daemon.getAllAllocations();
    let cleanedCount = 0;

    for (const allocation of allocations) {
      // Check if process is still running
      if (allocation.pid) {
        try {
          process.kill(allocation.pid, 0);
        } catch (err) {
          if (err.code === 'ESRCH') {
            this.daemon.logger.warn(`Cleaning orphaned allocation: port ${allocation.port}, dead PID ${allocation.pid}`);
            await this.daemon.releasePort(allocation.port);
            cleanedCount++;
          }
        }
      }

      // Check if port is actually in use
      const available = await this.daemon.checkPortAvailable(allocation.port);
      if (available) {
        this.daemon.logger.warn(`Cleaning orphaned allocation: port ${allocation.port}, port not in use`);
        await this.daemon.releasePort(allocation.port);
        cleanedCount++;
      }
    }

    return { cleaned: cleanedCount };
  }

  async verifySingletonIntegrity() {
    // Ensure singleton services have at most one allocation
    const singletonTypes = this.daemon.getSingletonServiceTypes();
    const allocations = await this.daemon.getAllAllocations();

    const singletonAllocations = {};
    let fixed = 0;

    for (const allocation of allocations) {
      if (singletonTypes.includes(allocation.serviceType)) {
        if (!singletonAllocations[allocation.serviceType]) {
          singletonAllocations[allocation.serviceType] = allocation;
        } else {
          // Duplicate singleton allocation - keep the newer one
          const existing = singletonAllocations[allocation.serviceType];
          const toRemove = allocation.createdAt > existing.createdAt ? existing : allocation;

          this.daemon.logger.warn(`Removing duplicate singleton allocation for ${allocation.serviceType}: port ${toRemove.port}`);
          await this.daemon.releasePort(toRemove.port);
          fixed++;

          if (toRemove === existing) {
            singletonAllocations[allocation.serviceType] = allocation;
          }
        }
      }
    }

    return { fixed };
  }

  async rebuildIndices() {
    // Rebuild any in-memory indices from state
    await this.daemon.rebuildAllocationIndex();
    return { rebuilt: true };
  }

  async attemptRepair(stepName, error) {
    switch (stepName) {
      case 'Validate state file':
        // Create backup and initialize new state
        if (fs.existsSync(this.daemon.statePath)) {
          const backup = `${this.daemon.statePath}.corrupt.${Date.now()}`;
          fs.copyFileSync(this.daemon.statePath, backup);
          this.daemon.logger.warn(`Backed up corrupted state to ${backup}`);
        }
        await this.daemon.initializeState();
        this.daemon.logger.info('Initialized new state file');
        break;

      case 'Validate config file':
        this.daemon.logger.error('Config file invalid - manual intervention required');
        throw error; // Can't auto-repair config

      default:
        this.daemon.logger.warn(`No auto-repair available for: ${stepName}`);
    }
  }
}
```

**Configuration**:

```json
{
  "recovery": {
    "system_recovery": {
      "enabled": true,
      "run_on_startup": true,
      "backup_corrupted_state": true,
      "max_recovery_attempts": 3
    }
  }
}
```

**Success Criteria**:
- ✅ Validates state file on startup
- ✅ Detects and repairs corrupted state
- ✅ Cleans orphaned allocations automatically
- ✅ Ensures singleton integrity
- ✅ Rebuilds indices after recovery
- ✅ Creates backups before repairs

---

## Implementation Plan

### Phase 1: Port Conflict Recovery (Estimated: 4 hours)

**Tasks**:
1. Add `checkPortAvailable()` method to `src/daemon.js`
2. Implement `allocatePortWithRetry()` wrapper
3. Add conflict tracking and logging
4. Add recovery configuration to `config/core-ports.json`
5. Update CLI to show retry attempts
6. Write unit tests for conflict detection
7. Write integration tests for retry logic

**Files to Create/Modify**:
- `src/daemon.js` - Add conflict recovery methods
- `config/core-ports.json` - Add recovery config
- `tests/unit/daemon/conflict-recovery.test.js` - New test file
- `tests/integration/api/conflict-retry.test.js` - New test file

### Phase 2: Service Health Monitoring (Estimated: 6 hours)

**Tasks**:
1. Create `src/utils/health-monitor.js` class
2. Integrate with daemon startup
3. Implement periodic health checks
4. Add process existence checks
5. Add port availability checks
6. Add optional HTTP health checks
7. Implement stale allocation cleanup
8. Add health monitoring configuration
9. Write comprehensive tests

**Files to Create/Modify**:
- `src/utils/health-monitor.js` - New health monitoring class
- `src/daemon.js` - Integrate health monitoring
- `config/core-ports.json` - Add health monitoring config
- `tests/unit/utils/health-monitor.test.js` - New test file
- `tests/integration/monitoring/stale-cleanup.test.js` - New test file

### Phase 3: Full System Recovery (Estimated: 8 hours)

**Tasks**:
1. Create `src/utils/system-recovery.js` class
2. Implement state file validation
3. Implement config file validation
4. Implement orphan cleanup
5. Implement singleton integrity checks
6. Add index rebuilding
7. Add automatic repair mechanisms
8. Integrate with daemon startup
9. Add recovery configuration
10. Write comprehensive tests

**Files to Create/Modify**:
- `src/utils/system-recovery.js` - New system recovery class
- `src/daemon.js` - Integrate system recovery
- `config/core-ports.json` - Add system recovery config
- `tests/unit/utils/system-recovery.test.js` - New test file
- `tests/integration/recovery/full-recovery.test.js` - New test file
- `tests/e2e/scenarios/daemon-crash-recovery.test.js` - New test file

---

## Testing Strategy

### Unit Tests

**Layer 1: Port Conflict Recovery**
- `checkPortAvailable()` correctly detects conflicts
- `allocatePortWithRetry()` retries on conflict
- Exponential backoff delays work correctly
- Conflict tracking logs properly

**Layer 2: Health Monitoring**
- Health check detects dead processes
- Health check detects abandoned ports
- HTTP health checks work correctly
- Failure counting works
- Stale cleanup triggers after max failures

**Layer 3: System Recovery**
- State file validation detects corruption
- Config file validation detects issues
- Orphan cleanup removes dead allocations
- Singleton integrity repairs duplicates
- Index rebuilding works correctly

### Integration Tests

**End-to-End Scenarios**:
1. **Port Conflict Recovery**: Simulate port conflict, verify automatic retry
2. **Service Crash Recovery**: Kill service process, verify health monitor cleans up
3. **Daemon Crash Recovery**: Corrupt state file, verify recovery on startup
4. **Complete Recovery Flow**: Combine all three layers in realistic scenario

### Performance Tests

- Health monitoring doesn't impact allocation performance
- Recovery doesn't block normal operations
- Startup recovery completes within acceptable time (<5s)

---

## Success Metrics

**Reliability**:
- 99.9% success rate for port allocation (including retries)
- < 5 minute detection time for stale allocations
- < 10 second startup recovery time

**Observability**:
- All recovery events logged with context
- Metrics exposed for monitoring
- Clear error messages for manual intervention

**User Experience**:
- Transparent automatic recovery (users don't need to intervene)
- Clear feedback when manual intervention required
- No breaking changes to existing API

---

## Risk Assessment

**Low Risk**:
- Port conflict recovery (isolated, well-tested pattern)
- Health monitoring (read-only checks, safe cleanup)

**Medium Risk**:
- System recovery automatic repairs (could corrupt state if buggy)
- Mitigation: Create backups before any repair, extensive testing

**High Risk**:
- None identified

---

## Rollout Plan

1. **Phase 1 Only**: Deploy port conflict recovery, monitor for issues
2. **Phase 2**: Add health monitoring with conservative settings (longer intervals, higher failure thresholds)
3. **Phase 3**: Enable system recovery after validating Phase 1 & 2 in production

**Rollback Plan**: All layers can be disabled via configuration without code changes

---

## Related Documents

- **Implementation**: `ACTIVE_PLAN.md`
- **Backlog**: `FEATURE_BACKLOG.md`
- **Architecture**: `docs/reference/01-architecture/system-design.md`
- **Testing**: `docs/reference/03-development/testing-strategy.md`

---

**Created**: 2025-09-30
**Last Updated**: 2025-09-30
**Status**: ACTIVE - Ready for implementation
