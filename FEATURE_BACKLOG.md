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

### 3. IANA Partnership & Open Source Promotion
**Status:** Proposed
**Priority:** Low
**Category:** Community, Standards Compliance, Marketing
**Requested:** 2025-09-30

**Problem Statement:**
Port management is a universal developer problem, but most solutions are ad-hoc or enterprise-focused. Styxy provides a lightweight, standards-compliant approach to development port coordination that aligns with IANA port registry principles.

**Opportunity:**
IANA maintains the authoritative port registry (https://www.iana.org/assignments/service-names-port-numbers/) and could potentially promote tools that help developers follow port allocation best practices.

**Proposed Action:**
Reach out to IANA to:
1. Validate Styxy's alignment with IANA port allocation principles
2. Explore potential listing/mention in IANA developer resources
3. Request feedback on port management best practices
4. Investigate partnership opportunities for promoting standards-compliant development tools

**Benefits:**
- Credibility boost from IANA association
- Potential exposure to wider developer audience
- Validation of Styxy's standards-compliant approach
- Contribution to better port management practices ecosystem

**Implementation Steps:**
1. Research IANA contact channels and submission processes
2. Prepare documentation highlighting IANA compliance
3. Draft partnership/promotion proposal
4. Submit inquiry and await response
5. Follow up on feedback and recommendations

**References:**
- IANA Port Registry: https://www.iana.org/assignments/service-names-port-numbers/service-names-port-numbers.xhtml
- RFC 6335: IANA Port Number Registry Procedures
- Styxy IANA compliance: `docs/references/IANA_PORT_REGISTRY.md`

---

### 4. LD_PRELOAD System Call Interception (Research Branch)
**Status:** Research
**Priority:** Low
**Category:** Advanced Interception, OS-Level Integration, Proof of Concept
**Requested:** 2025-09-30

**Problem Statement:**
Current Styxy integration requires explicit coordination:
- PreToolUse hooks only intercept commands Claude Code executes
- Applications must explicitly request ports via CLI or MCP
- Manual shell scripts need to call Styxy allocate before running services
- No coverage for binaries or tools that don't expose port configuration

This creates gaps where port conflicts can still occur if tools are launched outside Styxy's awareness.

**Proposed Solution:**
Create a research branch exploring OS-level port interception using `LD_PRELOAD` to intercept socket system calls (`socket()`, `bind()`, `listen()`) before they reach the kernel.

**How LD_PRELOAD Interception Works:**

```c
// libstyxy-intercept.so - Shared library loaded before libc

#include <sys/socket.h>
#include <netinet/in.h>
#include <dlfcn.h>
#include <stdio.h>

// Store original bind() function
static int (*original_bind)(int, const struct sockaddr *, socklen_t) = NULL;

// Our intercepted bind() function
int bind(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
    // Lazy-load original bind on first call
    if (!original_bind) {
        original_bind = dlsym(RTLD_NEXT, "bind");
    }

    // Only intercept TCP/UDP sockets with port numbers
    if (addr->sa_family == AF_INET || addr->sa_family == AF_INET6) {
        struct sockaddr_in *addr_in = (struct sockaddr_in *)addr;
        uint16_t requested_port = ntohs(addr_in->sin_port);

        // Contact Styxy daemon via HTTP API
        uint16_t allocated_port = styxy_allocate_port(
            requested_port,
            detect_service_type(),
            getpid()
        );

        // Transparently rewrite port in socket address structure
        addr_in->sin_port = htons(allocated_port);

        fprintf(stderr, "[Styxy] Allocated port %d (requested %d)\n",
                allocated_port, requested_port);
    }

    // Call original bind() with potentially modified port
    return original_bind(sockfd, addr, addrlen);
}
```

**Usage:**
```bash
# Preload interceptor before any command
LD_PRELOAD=/usr/lib/libstyxy-intercept.so chroma run
# Application thinks it's binding to default port 8000
# Actually binds to Styxy-allocated port (e.g., 8023)

# System-wide (add to shell profile)
export LD_PRELOAD=/usr/lib/libstyxy-intercept.so

# Selective (wrap specific commands)
alias chroma='LD_PRELOAD=/usr/lib/libstyxy-intercept.so chroma'
```

**Benefits:**
- ✅ **100% transparent** - applications unaware of redirection
- ✅ **Works with any binary** - even closed-source tools
- ✅ **No application modification** required
- ✅ **Handles default ports** automatically
- ✅ **Works with static binaries** (with limitations)
- ✅ **Catches forgotten port conflicts** - ultimate safety net

**Challenges & Research Areas:**

1. **Platform Support:**
   - Linux/Unix: Native support via `LD_PRELOAD`
   - macOS: Uses `DYLD_INSERT_LIBRARIES` (more restricted)
   - Windows: Requires DLL injection (completely different approach)
   - **Recommendation:** Start with Linux-only POC

2. **Performance Overhead:**
   - Every socket syscall goes through interceptor
   - Need benchmarking: allocate port once, cache decision
   - Optimize hot path for non-TCP/UDP sockets

3. **Daemon Communication:**
   - Interceptor must contact Styxy daemon via HTTP
   - Handle daemon unavailable (fallback to requested port?)
   - Timeout handling (can't block indefinitely)
   - Connection pooling to reduce overhead

4. **Security Implications:**
   - LD_PRELOAD disabled for setuid binaries (security feature)
   - Container environments may block LD_PRELOAD
   - SELinux/AppArmor compatibility
   - Code signing implications on macOS

5. **Service Type Detection:**
   - Inspect `/proc/self/cmdline` to identify process
   - Pattern matching to infer service type
   - Fallback to generic allocation if unknown

6. **Error Handling:**
   - What if Styxy daemon is down?
   - What if all ports exhausted?
   - Graceful degradation strategies

7. **Debugging Complexity:**
   - Intercepted applications harder to debug
   - Need comprehensive logging
   - Toggle mechanism to disable interception

**Implementation Roadmap:**

**Phase 1: Proof of Concept (Linux only)**
1. Create minimal `libstyxy-intercept.c` intercepting `bind()`
2. Implement basic HTTP client to contact Styxy daemon
3. Test with simple Python HTTP server
4. Benchmark overhead

**Phase 2: Robust Implementation**
1. Add error handling and fallback strategies
2. Implement service type auto-detection
3. Add connection pooling and caching
4. Comprehensive logging

**Phase 3: Cross-Platform (if feasible)**
1. macOS support via `DYLD_INSERT_LIBRARIES`
2. Investigate Windows DLL injection
3. Container-aware implementation

**Phase 4: Integration**
1. Package as installable library (.deb, .rpm)
2. Shell integration scripts
3. Documentation and examples
4. Security audit

**Success Criteria:**
- ✅ Intercepts `bind()` calls without application awareness
- ✅ Successfully allocates ports from Styxy daemon
- ✅ < 5ms overhead for port allocation
- ✅ Graceful fallback when daemon unavailable
- ✅ Works with common tools (chroma, uvicorn, node servers)

**Risks:**
- ⚠️ Platform fragmentation (Linux vs macOS vs Windows)
- ⚠️ Container/security environment incompatibilities
- ⚠️ Debugging complexity for users
- ⚠️ Maintenance burden for C/C++ codebase
- ⚠️ Potential for subtle bugs in syscall interception

**Alternative Approaches to Consider:**
1. **Kernel module** (more invasive but more powerful)
2. **eBPF** (modern Linux, less invasive than kernel module)
3. **ptrace-based** (debugging API, higher overhead)
4. **FUSE-based /proc manipulation** (creative but fragile)

**References:**
- LD_PRELOAD tutorial: https://rafalcieslak.wordpress.com/2013/04/02/dynamic-linker-tricks-using-ld_preload-to-cheat-inject-features-and-investigate-programs/
- dlsym documentation: https://man7.org/linux/man-pages/man3/dlsym.3.html
- Socket syscalls: https://man7.org/linux/man-pages/man2/socket.2.html
- eBPF as alternative: https://ebpf.io/

**Recommendation:**
Create experimental branch `research/ld-preload-interception` for:
- Learning and documentation
- Proof of concept implementation
- Performance benchmarking
- Feasibility assessment

**DO NOT merge to main** until:
- Security implications fully understood
- Cross-platform strategy defined
- Performance overhead acceptable
- Maintenance burden assessed

This is a **research project** to explore the limits of transparent port coordination, not a production feature for immediate deployment.

---

## Completed Features
(Move features here when implemented)

---

## Archived/Rejected Features
(Move declined features here with rationale)