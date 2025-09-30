# Styxy - Feature Backlog
**Created:** 2025-09-30
**Last Updated:** 2025-09-30
**Active Features:** 2

## Active Feature Requests

### 1. Single-Instance Service Configuration
**Status:** Proposed
**Priority:** Medium
**Category:** Port Management, Multi-Instance Coordination
**Requested:** 2025-09-30

**Problem Statement:**
Some services (e.g., RAG service, ChromaDB, embedding models) cannot support multiple instances due to:
- Port binding conflicts (only one process can bind a port)
- Database locking issues (ChromaDB corruption risk with concurrent access)
- Resource waste (multiple 500MB+ model loads)
- Race conditions on shared resources

Currently, protection requires custom flock-based shell scripts around each service.

**Proposed Solution:**
Extend Styxy's port configuration to include instance behavior metadata:

```javascript
{
  serviceTypes: {
    "ai": {
      range: [11400, 11499],
      instanceBehavior: "single",  // NEW: "single" | "multi" (default)
      description: "AI inference servers, LLMs"
    }
  }
}
```

**Behavior When `instanceBehavior: "single"`:**
1. First allocation request → allocate port normally, store as "singleton service"
2. Subsequent allocation requests for same service type:
   - Block new port allocation
   - Return existing port/service information
   - Log: "Service 'rag-service' already running on port 8002, reusing"
3. On service cleanup/release → allow new allocation

**Benefits:**
- Eliminates need for custom flock scripts per service
- Prevents conflicts at allocation level (fail-fast)
- Centralizes multi-instance behavior configuration
- Provides clear error messages: "Service only allows single instance, use existing port 8002"

**Implementation Scope:**
- API changes: `POST /allocate` checks instanceBehavior before allocation
- CLI changes: `styxy allocate --service-type ai --instance-id rag` respects singleton
- Config changes: Add `instanceBehavior` field to service type definitions
- State tracking: Track singleton services separately in daemon state
- Documentation: Update service type configuration docs

**Example Use Case:**
```bash
# User 1 (Claude instance 1)
styxy allocate --service-type ai --instance-id rag-service
# Allocated port 11400

# User 2 (Claude instance 2)
styxy allocate --service-type ai --instance-id rag-service
# Blocked: Service 'rag-service' (AI type) only allows single instance
# Existing instance running on port 11400 (process 12345)
# Use: styxy use --port 11400 (or configure client to connect to 11400)
```

**Related Systems:**
- RAG service startup script: ~/scripts/claude/rag-service-startup.sh
- Current protection: flock-based locking with health checks
- Future integration: Migrate flock logic into Styxy core

---

### 2. Smart Auto-Allocation for Unknown Services
**Status:** Proposed
**Priority:** High
**Category:** Port Management, Configuration Management, Intelligent Automation
**Requested:** 2025-09-30

**Problem Statement:**
When Styxy encounters a service it has never seen before (e.g., Grafana, Jaeger, new tool), current behavior is:
- Request fails: "Unknown service type 'grafana'"
- User must manually edit config to add new service type range
- Requires understanding of existing port ranges to avoid conflicts
- Interrupts workflow for configuration management

This creates friction when adopting new tools or expanding the development stack.

**Proposed Solution:**
Implement intelligent auto-allocation that:
1. Detects unknown service type during allocation request
2. Automatically reserves a configurable chunk of ports
3. Updates port configuration document with new service type
4. Allocates from newly created range
5. Logs action for user awareness

**Configuration Options:**
```javascript
{
  autoAllocation: {
    enabled: true,                    // Enable/disable auto-allocation
    defaultChunkSize: 10,             // Ports to reserve for new service types
    placement: "after",               // "before" | "after" | "smart"
    minPortNumber: 10000,             // Don't allocate below this
    maxPortNumber: 65000,             // Don't allocate above this
    preserveGaps: true,               // Leave gaps between service ranges
    gapSize: 10                       // Minimum gap between ranges
  }
}
```

**Placement Strategies:**
- **"after"**: Append after last existing range (safest, default)
- **"before"**: Prepend before first existing range
- **"smart"**: Find optimal gap in existing ranges based on:
  - Service category similarity (group monitoring tools together)
  - Port number conventions (databases near 5432, web near 8080)
  - Available contiguous space

**Behavior Flow:**
```bash
# User tries to allocate unknown service
styxy allocate --service-type grafana --instance-id main

# Styxy detects unknown service type
# Auto-allocates ports 10100-10109 (after last range at 10099)
# Updates ~/docs/CORE/PORT_MANAGEMENT.md with:
#   grafana: 10100-10109 (auto-allocated 2025-09-30)
# Allocates port 10100 for this instance
# Logs: "Auto-allocated range 10100-10109 for new service type 'grafana'"

# Returns:
{
  "port": 10100,
  "lockId": "grafana-main-abc123",
  "autoAllocated": true,
  "newRange": [10100, 10109],
  "message": "New service type 'grafana' auto-configured"
}
```

**Safety Features:**
1. **Collision Detection**: Verify no existing services using proposed range
2. **Range Validation**: Ensure new range fits within min/max boundaries
3. **Atomic Updates**: Use file locking when updating config document
4. **Audit Trail**: Log all auto-allocations with timestamp and user
5. **Rollback**: Provide `styxy config undo-auto` to revert auto-allocations
6. **Confirmation Mode**: Optional `requireConfirmation: true` to prompt user first

**Per-Service Overrides:**
Allow users to pre-configure auto-allocation behavior for specific services:
```javascript
{
  autoAllocationRules: {
    "monitoring-*": {           // Pattern matching for service types
      chunkSize: 20,            // Monitoring tools get more ports
      placement: "smart",       // Group with other monitoring tools
      preferredRangeStart: 9000 // Try to allocate near port 9000
    },
    "database-*": {
      chunkSize: 5,             // Databases typically need fewer ports
      preferredRangeStart: 5400 // Near PostgreSQL convention
    }
  }
}
```

**Benefits:**
- Zero-friction adoption of new development tools
- Automatic configuration management reduces manual overhead
- Prevents port conflicts through intelligent gap analysis
- Maintains audit trail of configuration evolution
- Enables rapid experimentation with new services

**Implementation Scope:**
- Config system: Add autoAllocation configuration section
- Port allocation logic: Detect unknown services, find safe ranges
- Document updates: Atomic write to PORT_MANAGEMENT.md
- Placement algorithms: Implement "after", "before", "smart" strategies
- Collision detection: Verify proposed range against OS-level port usage
- CLI enhancements: `styxy config auto-allocation` management commands
- Audit logging: Track all auto-allocation events
- Documentation: User guide for auto-allocation configuration

**Example Use Cases:**

**Use Case 1: Developer Trying New Tool**
```bash
# Developer wants to try Jaeger for tracing
docker run -d jaeger-all-in-one

# In startup script, allocate port:
styxy allocate --service-type jaeger --instance-id dev
# ✅ Auto-allocated range 10110-10119, using port 10110
# Config automatically updated, no manual intervention needed
```

**Use Case 2: Team Standardization**
```bash
# Team lead pre-configures rules for monitoring tools
styxy config set auto-allocation-rule "monitoring-*" \
  --chunk-size 20 \
  --preferred-range 9000

# Any monitoring tool (Grafana, Prometheus, Jaeger, etc.)
# automatically gets 20 ports allocated near 9000 range
```

**Use Case 3: Safe Experimentation**
```bash
# Enable confirmation mode for auto-allocation
styxy config set auto-allocation.require-confirmation true

# Next unknown service prompts:
styxy allocate --service-type newservice --instance-id test
# ⚠️  Unknown service type 'newservice'
# 📝 Propose auto-allocation: ports 10120-10129
# 💡 Placement: after existing ranges (safe)
# ❓ Proceed? [y/N/customize]:
```

**Related Systems:**
- Port configuration: ~/docs/CORE/PORT_MANAGEMENT.md
- Service type detection: Could integrate with process name detection
- Future enhancement: Learn common port conventions from community standards

---

## Completed Features
(Move features here when implemented)

---

## Archived/Rejected Features
(Move declined features here with rationale)