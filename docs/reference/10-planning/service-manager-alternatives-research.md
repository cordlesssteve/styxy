# Service Manager Alternatives - Comprehensive Research Report

**Status:** ACTIVE
**Created:** 2025-10-11
**Last Updated:** 2025-10-11
**Research Scope:** Development process/service managers for local environments
**Purpose:** Evaluate whether Styxy should expand to service lifecycle management or remain port-focused

---

## Executive Summary

This research evaluated existing service/process managers to determine if Styxy should integrate service lifecycle management or remain a focused port allocation tool. **Key Finding:** Process Compose is the market leader for non-containerized service orchestration, offering features nearly identical to our custom bash-based project-aware startup system.

### Strategic Recommendations

1. **Keep Styxy Focused** - Port allocation and registry only
2. **Adopt Process Compose** - Use as service runner for project-aware startup
3. **Maintain Orchestration Layer** - Keep bash scripts for project detection, tier sequencing, and Claude Code integration

---

## Research Context

### Current Implementation

We have a **three-tier project-aware startup system** built in bash:

- **Tier 0-1**: System services (ChromaDB, Styxy daemon) via systemd
- **Tier 2**: Global MCP services (MetaMCP, RAG) via Docker Compose
- **Tier 3**: Project-specific services (Kafka/Zookeeper for AutoGen, Neo4j for Topolop)

**Key Scripts:**
- `~/scripts/claude/project-aware-session-startup.sh` - Main orchestrator
- `~/scripts/claude/lightweight-session-startup.sh` - Tier 0-2 services
- Project configs: `.project-services.json` with service definitions

**Features:**
- ✅ Automatic project detection (JSON config or pattern matching)
- ✅ Health checks (HTTP/TCP)
- ✅ Dependency management (ordered startup)
- ✅ Idempotent (safe to run multiple times)
- ✅ Claude Code SessionStart hook integration
- ✅ Port tracking (via Styxy)
- ✅ Comprehensive logging

### Research Question

**Should Styxy expand to handle service lifecycle management, or should we use existing tools?**

**Considerations:**
- Avoid reinventing wheels
- Maintain separation of concerns
- Evaluate maturity vs. flexibility trade-offs
- Assess integration effort

---

## Market Analysis: Tool Categories

### Category 1: Procfile-Based Process Managers

Simple tools that run multiple processes from a `Procfile` configuration.

#### **Foreman** (Original, Ruby)
- **GitHub:** 6k+ stars
- **Age:** ~12 years
- **Status:** Mature but dated

**Procfile Example:**
```procfile
web: rails server -p $PORT
worker: sidekiq
redis: redis-server
```

**Pros:**
- ✅ Industry standard format
- ✅ Simple, easy to adopt
- ✅ Works across languages

**Cons:**
- ❌ No health checks
- ❌ No dependency management
- ❌ No auto-restart on failure
- ❌ Limited port management (sequential allocation)

**Port Management:**
```bash
# Assigns ports sequentially
web: $PORT (5000)
worker: $PORT (5100)
redis: $PORT (5200)
```

---

#### **Overmind** (Modern Foreman Alternative, Go)
- **GitHub:** 2.5k+ stars
- **Language:** Go
- **Status:** Active, well-maintained

**Key Innovation:** Uses **tmux** for process isolation

**Features:**
- ✅ `overmind connect web` - Attach to running process
- ✅ Restart individual processes without stopping others
- ✅ Automatic port allocation (base + step)
- ✅ Color-coded output

**Port Management:**
```bash
# Configurable base and step
overmind start -p 3000 -P 10
# web: PORT=3000
# api: PORT=3010
# worker: PORT=3020

# Or disable: OVERMIND_NO_PORT=1
```

**Environment Variables:**
```bash
OVERMIND_PROCESS_WEB_PORT=3000
OVERMIND_PROCESS_API_PORT=3010
```

**Cons:**
- ❌ No health checks
- ❌ No dependency ordering (all start in parallel)
- ❌ Requires tmux installed

**Use Case:** Best for interactive development with frequent debugging (Rails ecosystem loves this)

---

#### **Honcho** (Python Port of Foreman)
- **Language:** Python
- **Status:** Maintained
- **PyPI:** Latest 2.0.1

**Features:**
- ✅ Python-native (no Ruby dependency)
- ✅ Color-coded output
- ✅ Concurrent process execution

**Config:** Same Procfile format as Foreman

**Cons:** Same limitations (no health checks, no dependencies)

**Use Case:** Python projects that want Procfile simplicity

---

#### **Hivemind** (Lightweight Foreman, Go)
- **Language:** Go
- **Focus:** Minimal, shell-based

**Features:**
- ✅ Uses PTY for better log handling
- ✅ Preserves colors and TTY behavior
- ✅ No tmux dependency

**Cons:** Same Procfile limitations

**Use Case:** Lightweight alternative to Overmind without tmux

---

### Category 2: Modern TUI-Based Process Managers

Interactive tools with Terminal User Interfaces for better visibility and control.

#### **mprocs** (Rust, Interactive TUI)
- **GitHub:** 1.5k+ stars
- **Language:** Rust
- **Status:** Active (v0.7.1, 2024)

**mprocs.yaml Example:**
```yaml
procs:
  web:
    cmd: npm run dev
  api:
    cmd: python manage.py runserver
  worker:
    cmd: celery worker -A tasks
  redis:
    cmd: redis-server
```

**Features:**
- ✅ Beautiful TUI with process selection
- ✅ Per-process terminal (attach/detach like tmux)
- ✅ Fast (Rust performance)
- ✅ Cross-platform
- ✅ Can hide/show processes interactively

**TUI Screenshot (conceptual):**
```
┌─ mprocs ────────────────────────────────────┐
│ ▸ web    [RUNNING] npm run dev              │
│ ▸ api    [RUNNING] python manage.py runserver│
│ ▸ worker [STOPPED] celery worker            │
│ ▸ redis  [RUNNING] redis-server             │
├─────────────────────────────────────────────┤
│ [web output]                                │
│ > Compiled successfully!                    │
│ > Ready on http://localhost:3000            │
└─────────────────────────────────────────────┘
```

**Cons:**
- ❌ No health checks
- ❌ No dependency management
- ❌ No port allocation
- ❌ No auto-restart

**Use Case:** Best for developers who want great UX for parallel process management

---

#### **procmux** (Python, TUI)
- **PyPI:** Latest 0.36 (Feb 2025)
- **Language:** Python
- **Inspired by:** mprocs

**Features:**
- ✅ TUI for browsing processes
- ✅ Switchable terminals
- ✅ Project-based config files

**Config:** Similar YAML format to mprocs

**Use Case:** Python alternative to mprocs

---

### Category 3: Docker-Compose-Like Service Orchestrators

Tools that provide Docker Compose semantics without requiring containers.

#### **⭐ Process Compose** (Market Leader)
- **GitHub:** 1.9k stars, 85 forks
- **Language:** Go
- **Latest:** v1.75.2 (Sept 2025)
- **Releases:** 59 (active development)
- **License:** Apache 2.0

**This is the closest match to our current system.**

##### **Configuration Format**

**process-compose.yaml:**
```yaml
version: "0.5"

# Global environment (like docker-compose)
environment:
  - "GLOBAL_VAR=value"
  - "DATABASE_URL=postgres://localhost:5432"

# Dynamic environment from commands
env_cmds:
  HOSTNAME: "hostname"
  TIMESTAMP: "date +%s"

# Service definitions
processes:
  # Example 1: Simple process
  redis:
    command: "redis-server --port 6379"
    availability:
      restart: "always"  # on_failure, always, no

  # Example 2: With health checks
  postgres:
    command: "docker run --name db -p 5432:5432 postgres"
    readiness_probe:
      exec:
        command: "pg_isready -h localhost"
      initial_delay_seconds: 5
      period_seconds: 10
      timeout_seconds: 5
      success_threshold: 1
      failure_threshold: 3
    liveness_probe:
      exec:
        command: "pg_isready -h localhost"
      initial_delay_seconds: 15
      period_seconds: 30

  # Example 3: HTTP health check + dependencies
  web:
    command: "npm run dev"
    depends_on:
      postgres:
        condition: process_healthy
      redis:
        condition: process_started
    readiness_probe:
      http_get:
        host: "127.0.0.1"
        port: 3000
        scheme: "http"
        path: "/health"
      initial_delay_seconds: 10
      period_seconds: 5
    environment:
      - "PORT=3000"
      - "DATABASE_URL=${DATABASE_URL}"

  # Example 4: Process replicas with dynamic ports
  worker:
    command: "python worker.py --port 404{{.PC_REPLICA_NUM}}"
    replicas: 3  # Creates 3 instances
    readiness_probe:
      http_get:
        port: "404{{.PC_REPLICA_NUM}}"  # 4040, 4041, 4042
    environment:
      - "WORKER_ID={{.PC_REPLICA_NUM}}"

  # Example 5: Kafka with dependencies (AutoGen use case)
  zookeeper:
    command: "docker compose up -d zookeeper"
    working_dir: "/home/user/projects/autogen-local"
    readiness_probe:
      exec:
        command: "docker inspect autogen-zookeeper --format='{{.State.Health.Status}}' | grep healthy"
      initial_delay_seconds: 10
      period_seconds: 5
      timeout_seconds: 30
    availability:
      restart: "on_failure"
      max_restarts: 3

  kafka:
    command: "docker compose up -d kafka"
    working_dir: "/home/user/projects/autogen-local"
    depends_on:
      zookeeper:
        condition: process_healthy
    readiness_probe:
      exec:
        command: "docker inspect autogen-kafka --format='{{.State.Health.Status}}' | grep healthy"
      timeout_seconds: 60
    environment:
      - "KAFKA_PORT=9092"

  # Example 6: Optional service (won't block startup if fails)
  kafka-ui:
    command: "docker compose --profile dev up -d kafka-ui"
    working_dir: "/home/user/projects/autogen-local"
    depends_on:
      kafka:
        condition: process_healthy
    is_optional: true  # Failure won't block other services
    readiness_probe:
      http_get:
        port: 8080
        path: "/health"
```

##### **Key Features**

**1. Health Checks (Kubernetes-Style)**

Three probe types:

**Exec (Command-based):**
```yaml
readiness_probe:
  exec:
    command: "curl -f http://localhost:8000/health"
  initial_delay_seconds: 5
  period_seconds: 10
  timeout_seconds: 5
```

**HTTP:**
```yaml
readiness_probe:
  http_get:
    host: "127.0.0.1"
    port: 8080
    path: "/health"
    scheme: "http"
```

**TCP (Coming Soon):**
```yaml
readiness_probe:
  tcp_socket:
    host: "127.0.0.1"
    port: 6379
```

**Probe Semantics:**
- **Readiness**: Process is ready to receive traffic
- **Liveness**: Process is alive (restart if unhealthy)

**2. Dependency Management**

Five condition types:
- `process_started` - Process began execution
- `process_completed` - Process finished successfully
- `process_completed_successfully` - Alias for above
- `process_healthy` - Readiness probe passed
- `process_running` - Process is currently running

**Example:**
```yaml
depends_on:
  database:
    condition: process_healthy
  cache:
    condition: process_started
```

**3. Port Management (Replica-Based)**

```yaml
processes:
  api:
    command: "python app.py --port 300{{.PC_REPLICA_NUM}}"
    replicas: 5
    environment:
      - "PORT=300{{.PC_REPLICA_NUM}}"
```

Creates:
- api-0: PORT=3000
- api-1: PORT=3001
- api-2: PORT=3002
- api-3: PORT=3003
- api-4: PORT=3004

**Injected Variables:**
- `PC_REPLICA_NUM` - Replica number (0-indexed)
- `PC_PROC_NAME` - Process name
- `PC_PORT_NUM` - Automatically allocated port

**4. Recovery Policies**

```yaml
availability:
  restart: "always"  # always, on_failure, no, exit_on_end
  max_restarts: 5    # Limit restart attempts
  backoff_seconds: 2 # Delay between restarts
```

**5. Advanced Features**

**Namespaces:**
```yaml
# process-compose.yaml
processes:
  web:
    namespace: frontend
    command: "npm run dev"

  api:
    namespace: backend
    command: "python manage.py runserver"
```

**Recipe/Snippet Management:**
```bash
# Save common patterns
process-compose --recipe save myrecipe process-compose.yaml

# Reuse in other projects
process-compose --recipe load myrecipe
```

**Configuration Merging:**
```bash
# Combine multiple configs
process-compose -f base.yaml -f override.yaml
```

**Foreground Processes:**
```yaml
processes:
  interactive:
    command: "bash"
    is_foreground: true  # Attach stdin/stdout
```

**Shell Configuration:**
```yaml
shell:
  shell_command: "zsh"
  shell_argument: "-c"

processes:
  test:
    command: "echo $SHELL"  # Uses zsh
```

##### **Interfaces**

**1. TUI (Terminal UI)**

```bash
process-compose up
# Opens interactive TUI
```

Features:
- Process list with status indicators
- Live log streaming
- Restart/stop processes interactively
- Filter processes
- Theme customization

**2. CLI Mode**

```bash
process-compose up --detach  # Run in background
process-compose down          # Stop all
process-compose restart web   # Restart single process
process-compose logs web      # View logs
```

**3. REST API + Swagger**

```bash
process-compose up --api

# Swagger UI: http://localhost:8080/swagger
# API endpoints:
# GET  /processes              - List all
# GET  /processes/{name}       - Get status
# POST /processes/{name}/start - Start process
# POST /processes/{name}/stop  - Stop process
# GET  /processes/{name}/logs  - Stream logs
```

**API Example:**
```bash
# Start a process
curl -X POST http://localhost:8080/processes/web/start

# Get status
curl http://localhost:8080/processes/web
# Response:
{
  "name": "web",
  "status": "running",
  "pid": 12345,
  "is_ready": true,
  "restarts": 0
}
```

##### **Comparison to Our System**

| Feature | Our System | Process Compose |
|---------|-----------|-----------------|
| **Health Checks** | ✅ HTTP/TCP (curl) | ✅ HTTP/Exec (K8s-style) |
| **Dependencies** | ✅ Ordered startup | ✅ Condition-based |
| **Port Management** | ✅ Styxy registry | 🟡 Replica-based |
| **Auto-Recovery** | ✅ Systemd/Docker | ✅ Built-in policies |
| **Project Detection** | ✅ Pattern + JSON | ❌ Manual config |
| **Tier Sequencing** | ✅ 0→1→2→3 | ❌ Flat dependency graph |
| **Claude Hooks** | ✅ SessionStart | ❌ External integration |
| **Git Worktree Aware** | ✅ | ❌ |
| **Config Format** | JSON | YAML |
| **TUI** | ❌ | ✅ Rich TUI |
| **REST API** | ❌ | ✅ Full API |
| **Logging** | Bash/systemd | ✅ Built-in + rotation |
| **Single Binary** | ❌ Bash scripts | ✅ Go binary |

##### **Migration Path from Our System**

**AutoGen .project-services.json → process-compose.yaml:**

**Before (Our JSON):**
```json
{
  "services": [
    {
      "name": "zookeeper",
      "start_command": "docker compose up -d zookeeper",
      "health_check": "http://localhost:2181",
      "timeout_seconds": 30,
      "required": true
    },
    {
      "name": "kafka",
      "start_command": "docker compose up -d kafka",
      "dependencies": ["zookeeper"],
      "timeout_seconds": 60,
      "required": true
    }
  ]
}
```

**After (Process Compose YAML):**
```yaml
version: "0.5"

processes:
  zookeeper:
    command: "docker compose up -d zookeeper"
    working_dir: "/home/user/projects/autogen-local"
    readiness_probe:
      exec:
        command: "curl -sf http://localhost:2181"
      timeout_seconds: 30
    availability:
      restart: "always"

  kafka:
    command: "docker compose up -d kafka"
    working_dir: "/home/user/projects/autogen-local"
    depends_on:
      zookeeper:
        condition: process_healthy
    readiness_probe:
      exec:
        command: "docker inspect autogen-kafka --format='{{.State.Health.Status}}' | grep healthy"
      timeout_seconds: 60
```

**Integration with Our Bash Orchestrator:**
```bash
# project-aware-session-startup.sh (simplified)

detect_project_config() {
    if [ -f "$project_dir/process-compose.yaml" ]; then
        echo "process-compose:$project_dir/process-compose.yaml"
    elif [ -f "$project_dir/.project-services.json" ]; then
        echo "legacy:$project_dir/.project-services.json"
    fi
}

start_project_services() {
    local config_type=$1
    local config_file=$2

    case "$config_type" in
        process-compose)
            cd "$(dirname "$config_file")"
            process-compose up --detach
            ;;
        legacy)
            # Keep existing bash implementation
            start_services_from_json "$config_file"
            ;;
    esac
}
```

##### **Pros of Process Compose**

- ✅ **Mature and Maintained**: 59 releases, active development
- ✅ **Single Binary**: No dependencies (Go)
- ✅ **Feature Complete**: Health checks, dependencies, restarts, logging
- ✅ **Great UX**: TUI + CLI + REST API
- ✅ **Docker Compose Familiarity**: Similar syntax, easier adoption
- ✅ **Extensible**: Namespaces, recipes, config merging
- ✅ **Production Ready**: Used in real projects (devenv.sh uses it)

##### **Cons vs. Our System**

- ❌ **No Automatic Project Detection**: Requires manual config per project
- ❌ **No Tier Sequencing**: Can't say "start Tier 0, then Tier 1, then Tier 2"
- ❌ **Port Management Limited**: Replica-based, not registry-based like Styxy
- 🟡 **YAML vs JSON**: Team preference (YAML is more readable)

##### **Process Compose Use Cases**

1. **Microservice Development**: Run 10+ services locally
2. **Non-Containerized Apps**: Native processes without Docker overhead
3. **Gradual Docker Migration**: Run some Docker, some native
4. **Integration Testing**: Spin up dependencies with health checks
5. **Developer Onboarding**: One command to start entire stack

---

### Category 4: Container Orchestration for Local Dev

Tools designed for Kubernetes/Docker development workflows.

#### **Docker Compose**
- **Standard:** Industry standard
- **Status:** Mature, widely adopted

**Features:**
- ✅ Health checks built-in
- ✅ Dependency management (`depends_on`)
- ✅ Port mapping
- ✅ Volumes, networks, secrets

**Example:**
```yaml
services:
  db:
    image: postgres
    healthcheck:
      test: ["CMD", "pg_isready"]
      interval: 10s

  web:
    build: .
    ports: ["3000:3000"]
    depends_on:
      db:
        condition: service_healthy
```

**Cons:**
- ❌ Requires containerization
- ❌ No dynamic port allocation
- ❌ Overhead for simple native processes

**Use Case:** Standard for containerized development

---

#### **Tilt** (Kubernetes-Native Development)
- **GitHub:** 7.5k+ stars
- **Language:** Go + Starlark (Python-like config)
- **Focus:** Microservices on K8s

**Tiltfile Example:**
```python
# Mix of Docker Compose and K8s
docker_compose('docker-compose.yml')

# Define K8s resources
k8s_yaml('k8s/deployment.yaml')

# Add dependencies
k8s_resource(
  'kafka',
  resource_deps=['zookeeper'],
  port_forwards='9092:9092'
)

# Live update (hot reload)
docker_build(
  'my-app',
  '.',
  live_update=[
    sync('./src', '/app/src'),
    run('npm install', trigger='./package.json')
  ]
)
```

**Features:**
- ✅ Full orchestration (K8s + Docker Compose)
- ✅ Hot reload / live updates
- ✅ Dependency DAG
- ✅ Web UI
- ✅ Multi-service coordination

**Cons:**
- ❌ Heavy (requires K8s cluster or Docker Desktop)
- ❌ Steep learning curve (Starlark + K8s)
- ❌ Overkill for simple projects

**Use Case:** Large microservice architectures, K8s-first teams

---

#### **Skaffold** (Google, K8s-Native)
- **Maintainer:** Google
- **Focus:** CI/CD + local dev for K8s

**Features:**
- ✅ Automated build → push → deploy cycle
- ✅ File watching for auto-rebuild
- ✅ Integration with Helm, Kustomize

**skaffold.yaml:**
```yaml
apiVersion: skaffold/v4beta6
kind: Config
build:
  artifacts:
  - image: my-app
    sync:
      manual:
      - src: 'src/**/*.js'
        dest: /app/src
deploy:
  kubectl:
    manifests:
    - k8s/*.yaml
```

**Cons:**
- ❌ K8s-only (no native processes)
- ❌ Complex for simple use cases

**Use Case:** Teams already using Kubernetes for deployment

---

#### **DevSpace** (K8s Development Tool)
- **Focus:** Interactive K8s development
- **GUI:** Optional web interface

**Features:**
- ✅ Port forwarding
- ✅ Log streaming
- ✅ Remote debugging
- ✅ Hot reload

**Cons:**
- ❌ K8s-centric
- ❌ Requires cluster setup

---

### Category 5: Production Process Supervisors

Tools designed for production server management (less suited for dev).

#### **supervisord** (Python)
- **Age:** ~15 years
- **Status:** Battle-tested, production-grade

**supervisord.conf:**
```ini
[program:kafka]
command=docker compose up kafka
autostart=true
autorestart=true
stdout_logfile=/var/log/kafka.log
stderr_logfile=/var/log/kafka.err
```

**Pros:**
- ✅ Production-ready
- ✅ Auto-restart policies
- ✅ Web UI for monitoring

**Cons:**
- ❌ No health checks
- ❌ No dependency management
- ❌ INI config format (dated)
- ❌ Designed for long-running daemons, not dev iteration

**Use Case:** Production servers, not development

---

#### **systemd** (Linux System Manager)
- **Platform:** Linux (built-in)
- **Scope:** System-level services

**Features:**
- ✅ Dependency management (`After=`, `Requires=`)
- ✅ Socket activation
- ✅ Resource limits (cgroups)

**Example:**
```ini
[Unit]
Description=Styxy Daemon
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/styxy daemon
Restart=always

[Install]
WantedBy=multi-user.target
```

**Cons:**
- ❌ No port allocation
- ❌ System-level (requires root for system services)
- ❌ Not project-aware

**Use Case:** We already use this for Tier 0-1 services

---

## Detailed Comparison Matrix

### Feature Comparison Table

| Tool | Language | Stars | Health Checks | Dependencies | Port Mgmt | TUI | API | Config | Single Binary | Active |
|------|----------|-------|---------------|--------------|-----------|-----|-----|--------|---------------|--------|
| **Process Compose** | Go | 1.9k | ✅ HTTP/Exec | ✅ Conditions | 🟡 Replica | ✅ Rich | ✅ REST | YAML | ✅ | ✅ |
| **mprocs** | Rust | 1.5k | ❌ | ❌ | ❌ | ✅ Rich | ❌ | YAML | ✅ | ✅ |
| **Overmind** | Go | 2.5k | ❌ | ❌ | 🟡 Auto-inc | ✅ tmux | ❌ | Procfile | ✅ | ✅ |
| **Foreman** | Ruby | 6k | ❌ | ❌ | 🟡 Auto-inc | ❌ | ❌ | Procfile | ❌ | 🟡 |
| **Honcho** | Python | 2k | ❌ | ❌ | 🟡 Auto-inc | ❌ | ❌ | Procfile | ❌ | ✅ |
| **Tilt** | Go | 7.5k | ✅ K8s | ✅ Full DAG | ✅ K8s | ✅ Web | ✅ REST | Starlark | ✅ | ✅ |
| **Docker Compose** | Go | 33k+ | ✅ Built-in | ✅ Ordering | ✅ Mapping | ❌ | ❌ | YAML | ✅ | ✅ |
| **supervisord** | Python | 8k | ❌ | ❌ | ❌ | 🟡 Web | ✅ XML-RPC | INI | ❌ | 🟡 |
| **Our System** | Bash | N/A | ✅ HTTP/TCP | ✅ Ordered | ✅ Styxy | ❌ | ❌ | JSON | ❌ | ✅ |

**Legend:**
- ✅ Full support
- 🟡 Partial/limited support
- ❌ Not supported

### Capability Matrix

| Capability | Process Compose | mprocs | Overmind | Docker Compose | Our System |
|------------|----------------|---------|----------|----------------|------------|
| **Non-containerized processes** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **HTTP health checks** | ✅ | ❌ | ❌ | ✅ | ✅ |
| **Exec health checks** | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Conditional dependencies** | ✅ | ❌ | ❌ | 🟡 | ✅ |
| **Auto-restart policies** | ✅ | ❌ | 🟡 | ✅ | ✅ |
| **Port allocation** | 🟡 Replica | ❌ | 🟡 Sequential | ✅ Static | ✅ Registry |
| **Interactive TUI** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **REST API** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Process replicas** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Live log streaming** | ✅ | ✅ | ✅ | ✅ | 🟡 |
| **Per-process env vars** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Config merging** | ✅ | ❌ | ❌ | ✅ | ❌ |
| **Namespaces** | ✅ | ❌ | ❌ | ✅ | 🟡 |
| **Graceful shutdown** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Signal forwarding** | ✅ | ✅ | ✅ | ✅ | 🟡 |

---

## Port Management Deep Dive

### Process Compose Approach (Replica-Based)

**Strategy:** Auto-increment based on replica number

```yaml
processes:
  api:
    command: "uvicorn app:main --port 300{{.PC_REPLICA_NUM}}"
    replicas: 3
```

**Result:**
- api-0: Port 3000
- api-1: Port 3001
- api-2: Port 3002

**Pros:**
- ✅ Predictable port assignment
- ✅ Easy to scale (just increment replicas)
- ✅ Template syntax clear

**Cons:**
- ❌ No cross-project coordination
- ❌ No persistent registry
- ❌ Must manually avoid conflicts

---

### Overmind Approach (Sequential Auto-Increment)

**Strategy:** Base port + step increment

```bash
overmind start -p 5000 -P 100
```

**Procfile:**
```
web: rails server -p $PORT
api: node server.js --port $PORT
worker: python worker.py --port $PORT
```

**Result:**
- web: PORT=5000
- api: PORT=5100
- worker: PORT=5200

**Environment:**
```bash
$PORT  # Current process port
$OVERMIND_PROCESS_WEB_PORT=5000
$OVERMIND_PROCESS_API_PORT=5100
```

**Pros:**
- ✅ Zero configuration
- ✅ Works for most cases

**Cons:**
- ❌ Must restart all to change ports
- ❌ No persistence
- ❌ Can conflict across sessions

---

### Styxy Approach (Persistent Registry)

**Strategy:** SQLite registry with allocation API

```bash
# Allocate port for service
styxy allocate kafka --project autogen
# Returns: 9092

# List allocations
styxy list
# Output:
# kafka: 9092 (autogen)
# zookeeper: 2181 (autogen)
# neo4j: 7474 (topolop)
```

**Database Schema:**
```sql
CREATE TABLE allocations (
  service TEXT,
  port INTEGER,
  project TEXT,
  timestamp INTEGER
);
```

**Pros:**
- ✅ Cross-project coordination
- ✅ Persistent (survives reboots)
- ✅ Query API ("what's using port 8000?")
- ✅ Can enforce ranges per project

**Cons:**
- ❌ Requires daemon running
- ❌ Not built into process manager

---

### Hybrid Approach (Recommended)

**Architecture:**
```
Process Compose (service lifecycle)
    ↓ (queries for port)
Styxy (port registry)
    ↓ (returns allocated port)
Process Compose (injects $PORT)
    ↓
Service starts with correct port
```

**Example Integration:**

**Pre-start script:**
```bash
#!/bin/bash
# get-port.sh
SERVICE=$1
PROJECT=$2

# Query Styxy for port
PORT=$(styxy allocate "$SERVICE" --project "$PROJECT")
echo "PORT=$PORT"
```

**process-compose.yaml:**
```yaml
processes:
  kafka:
    command: |
      source <(./scripts/get-port.sh kafka autogen) && \
      docker compose up -d kafka
    environment:
      - "KAFKA_PORT=${PORT}"
```

**Benefits:**
- ✅ Process Compose handles lifecycle
- ✅ Styxy handles port registry
- ✅ Best of both worlds

---

## Strategic Analysis

### What Makes Our System Unique

| Feature | Our System | Process Compose | Verdict |
|---------|-----------|----------------|---------|
| **Auto-detect projects** | ✅ JSON + patterns | ❌ Manual | **Keep** |
| **Tier-based startup** | ✅ 0→1→2→3 | ❌ Flat | **Keep** |
| **Claude Code hooks** | ✅ SessionStart | ❌ External | **Keep** |
| **Git worktree aware** | ✅ Multi-instance | ❌ Single | **Keep** |
| **Styxy integration** | ✅ Port registry | ❌ | **Keep** |
| **Health checks** | ✅ Basic | ✅ Advanced | **Upgrade** |
| **TUI** | ❌ | ✅ Rich | **Adopt** |
| **REST API** | ❌ | ✅ | **Adopt** |
| **Config format** | JSON | YAML | **Preference** |

**Conclusion:** Our orchestration layer is valuable; service execution layer should use Process Compose.

---

### Should Styxy Own Service Management?

#### Arguments FOR Integration

**1. Unified Mental Model**
- One tool: `styxy start kafka --project autogen`
- Single source of truth (ports + PIDs + health)

**2. Port Intelligence**
- Auto-assign: "Kafka needs a port, ChromaDB is on 8000, assign 8001"
- Cross-project reuse: "Kafka already running for autogen, reuse it"

**3. State Management**
```sql
-- Single database tracks everything
SELECT * FROM services;
-- service | port | pid | health | project
-- kafka   | 9092 | 123 | healthy | autogen
-- neo4j   | 7474 | 456 | healthy | topolop
```

**4. Simpler Hook Integration**
```bash
# SessionStart hook becomes one line
styxy session-start --project $(pwd)
```

#### Arguments AGAINST Integration

**1. Scope Creep**
- Styxy: port allocation (narrow, focused)
- Service manager: lifecycle, logs, health, restarts (broad, complex)
- Violates Unix philosophy

**2. Single Point of Failure**
- If Styxy crashes, all service management breaks
- Current bash scripts: stateless, resilient

**3. Rewrite Effort**
- Process Compose already exists and works
- Estimated: 2-4 weeks to build equivalent in Styxy
- Maintenance burden increases

**4. Coupling**
- Services now depend on Styxy daemon
- Harder to debug manually
- Less flexible for edge cases

---

### Recommended Architecture

#### **Hybrid: Separation of Concerns**

```
┌─────────────────────────────────────────────────┐
│ project-aware-session-startup.sh (Bash)        │
│ - Project detection (JSON/patterns)             │
│ - Tier sequencing (0→1→2→3)                     │
│ - Claude Code hook integration                  │
│ - Worktree awareness                            │
└─────────────────┬───────────────────────────────┘
                  │
                  ├─► Tier 0-1: systemd services
                  │   (ChromaDB, Styxy daemon)
                  │
                  ├─► Tier 2: Docker Compose
                  │   (MetaMCP, PostgreSQL)
                  │
                  └─► Tier 3: Process Compose
                      (Project services: Kafka, Neo4j)
                      │
                      └─► Queries Styxy for ports
                          (Port registry integration)
```

#### **Component Responsibilities**

| Component | Responsibility | Why |
|-----------|---------------|-----|
| **Bash Orchestrator** | Project detection, tier sequencing, Claude hooks | Unique value, hard to replace |
| **Styxy** | Port allocation registry | Already built, focused scope |
| **Process Compose** | Service lifecycle, health, logging | Mature, feature-complete |
| **systemd** | System services (Tier 0-1) | Standard Linux approach |
| **Docker Compose** | Container services (Tier 2) | Industry standard |

#### **Migration Path**

**Phase 1: Proof of Concept (1 week)**
1. Install Process Compose binary
2. Convert one project (autogen) to process-compose.yaml
3. Test integration with bash orchestrator
4. Evaluate UX improvements (TUI, logs)

**Phase 2: Integration (1 week)**
1. Create Styxy → Process Compose port injection script
2. Update project detection to support both JSON and YAML
3. Migrate 2-3 projects to new format
4. Document migration guide

**Phase 3: Full Migration (2 weeks)**
1. Convert all projects to process-compose.yaml
2. Deprecate .project-services.json (but keep backward compat)
3. Add TUI shortcuts to docs
4. Create video walkthrough

**Phase 4: Optimization (ongoing)**
1. Explore Process Compose REST API for monitoring
2. Build Styxy plugin for Process Compose (if needed)
3. Contribute upstream features (if gaps exist)

---

## Example Configurations

### AutoGen Project (Current JSON → Process Compose YAML)

**Current: .project-services.json**
```json
{
  "project_name": "autogen-local",
  "services": [
    {
      "name": "zookeeper",
      "tier": 3,
      "start_command": "cd ~/projects/autogen-local && docker compose up -d zookeeper",
      "health_check": "http://localhost:2181",
      "port": 2181,
      "timeout_seconds": 30,
      "required": true
    },
    {
      "name": "kafka",
      "tier": 3,
      "start_command": "cd ~/projects/autogen-local && docker compose up -d kafka",
      "health_check": "",
      "port": 9092,
      "timeout_seconds": 60,
      "required": true,
      "dependencies": ["zookeeper"]
    },
    {
      "name": "kafka-ui",
      "tier": 3,
      "start_command": "cd ~/projects/autogen-local && docker compose --profile dev up -d kafka-ui",
      "health_check": "http://localhost:8080",
      "port": 8080,
      "timeout_seconds": 20,
      "required": false,
      "optional": true,
      "dependencies": ["kafka"]
    }
  ]
}
```

**Migrated: process-compose.yaml**
```yaml
version: "0.5"

# Shared working directory
log_location: "/home/cordlesssteve/.claude/logs/autogen-services.log"

processes:
  zookeeper:
    command: "docker compose up -d zookeeper"
    working_dir: "/home/cordlesssteve/projects/Utility/MULTI-AGENT/autogen-local"

    # Health check (exec because Docker healthcheck)
    readiness_probe:
      exec:
        command: |
          docker inspect autogen-zookeeper \
            --format='{{.State.Health.Status}}' | grep -q healthy
      initial_delay_seconds: 5
      period_seconds: 5
      timeout_seconds: 30
      failure_threshold: 6

    # Auto-restart on failure
    availability:
      restart: "on_failure"
      max_restarts: 3

    # Environment
    environment:
      - "ZOOKEEPER_PORT=2181"

  kafka:
    command: "docker compose up -d kafka"
    working_dir: "/home/cordlesssteve/projects/Utility/MULTI-AGENT/autogen-local"

    # Wait for Zookeeper to be healthy
    depends_on:
      zookeeper:
        condition: process_healthy

    # Kafka health check
    readiness_probe:
      exec:
        command: |
          docker inspect autogen-kafka \
            --format='{{.State.Health.Status}}' | grep -q healthy
      initial_delay_seconds: 10
      period_seconds: 5
      timeout_seconds: 60
      failure_threshold: 12

    availability:
      restart: "on_failure"
      max_restarts: 3

    environment:
      - "KAFKA_PORT=9092"

  kafka-ui:
    command: "docker compose --profile dev up -d kafka-ui"
    working_dir: "/home/cordlesssteve/projects/Utility/MULTI-AGENT/autogen-local"

    # Wait for Kafka
    depends_on:
      kafka:
        condition: process_healthy

    # HTTP health check
    readiness_probe:
      http_get:
        host: "127.0.0.1"
        port: 8080
        path: "/"
        scheme: "http"
      initial_delay_seconds: 10
      period_seconds: 5
      timeout_seconds: 20

    # Optional - won't block startup if fails
    is_optional: true

    availability:
      restart: "no"  # Don't restart dev tool
```

**Bash Integration (Updated):**
```bash
# project-aware-session-startup.sh (updated snippet)

start_project_services() {
    local project_dir=$1

    # Check for Process Compose config
    if [ -f "$project_dir/process-compose.yaml" ]; then
        log "🚀 Starting services via Process Compose"
        cd "$project_dir"

        # Start in detached mode (no TUI)
        process-compose up --detach --log-file ~/.claude/logs/process-compose.log

        log "✅ Process Compose services started"
        log "   View TUI: cd $project_dir && process-compose attach"
        log "   View logs: process-compose logs -f"

        return 0
    fi

    # Fallback to legacy JSON format
    if [ -f "$project_dir/.project-services.json" ]; then
        log "⚠️  Using legacy JSON format (consider migrating to process-compose.yaml)"
        start_services_from_json "$project_dir/.project-services.json"
        return 0
    fi

    log "ℹ️  No service configuration found"
}
```

---

### Topolop Project (With Styxy Integration)

**process-compose.yaml:**
```yaml
version: "0.5"

# Pre-startup scripts
env_cmds:
  # Query Styxy for Neo4j port
  NEO4J_HTTP_PORT: "styxy allocate neo4j-http --project topolop"
  NEO4J_BOLT_PORT: "styxy allocate neo4j-bolt --project topolop"

processes:
  neo4j:
    command: |
      docker run --name imthemap-neo4j \
        -p ${NEO4J_HTTP_PORT}:7474 \
        -p ${NEO4J_BOLT_PORT}:7687 \
        -e NEO4J_AUTH=neo4j/password \
        -d neo4j:latest

    readiness_probe:
      http_get:
        host: "127.0.0.1"
        port: "{{.NEO4J_HTTP_PORT}}"
        path: "/"
      initial_delay_seconds: 10
      period_seconds: 5
      timeout_seconds: 30

    availability:
      restart: "always"

    environment:
      - "NEO4J_HTTP_PORT=${NEO4J_HTTP_PORT}"
      - "NEO4J_BOLT_PORT=${NEO4J_BOLT_PORT}"

  topolop-indexer:
    command: "npm run index"
    working_dir: "/home/cordlesssteve/projects/topolop"

    depends_on:
      neo4j:
        condition: process_healthy

    # Run once and exit
    availability:
      restart: "no"
```

**Result:**
- Neo4j ports allocated by Styxy
- Process Compose uses allocated ports
- Registry tracks usage across projects

---

## Recommendations

### **Primary Recommendation: Hybrid Architecture**

✅ **Adopt Process Compose** for service lifecycle management

✅ **Keep Bash orchestration** for project detection and tier sequencing

✅ **Keep Styxy focused** on port allocation only

### **Implementation Plan**

**Week 1: Evaluation**
- Install Process Compose binary
- Convert AutoGen project to YAML
- Test TUI, health checks, dependency ordering
- Document pros/cons of actual usage

**Week 2: Integration**
- Build Styxy → Process Compose port injection
- Update bash orchestrator to support both configs
- Create migration guide (JSON → YAML)

**Week 3: Migration**
- Convert 3-5 projects to process-compose.yaml
- Update documentation (PROJECT_AWARE_STARTUP_GUIDE.md)
- Create screencast demo

**Week 4: Optimization**
- Explore REST API for monitoring
- Add shortcuts to sr (script runner)
- Gather feedback, iterate

### **Why This Approach Wins**

1. **Don't Reinvent:** Process Compose is mature, tested, feature-complete
2. **Keep Unique Value:** Project detection, tier sequencing, Claude hooks are our differentiators
3. **Best Tools for Each Job:** Bash (orchestration), Styxy (ports), Process Compose (services)
4. **Low Risk:** Incremental migration, backward compatible
5. **Better UX:** Gain TUI, REST API, better logging

### **What Styxy Should NOT Do**

❌ **Don't build service lifecycle management**
- Process Compose already does this better
- Would take 2-4 weeks to build equivalent
- Ongoing maintenance burden

❌ **Don't expand scope beyond ports**
- Styxy is great at one thing: port allocation
- Keep it focused, reliable, simple

### **What Styxy COULD Do (Future)**

🟡 **Optional: Process Compose Plugin**
- If gaps exist, build lightweight plugin
- Export port allocations in format Process Compose can read
- Example: `styxy export-env autogen > .env`

🟡 **Optional: Monitoring Integration**
- Query Process Compose REST API
- Show port + service health in one view
- `styxy status --with-services`

---

## Appendix: Tool Installation & Quick Start

### Process Compose Installation

**macOS (Homebrew):**
```bash
brew install f1bonacc1/tap/process-compose
```

**Linux (Binary):**
```bash
# Download latest release
wget https://github.com/F1bonacc1/process-compose/releases/download/v1.75.2/process-compose_Linux_x86_64.tar.gz

# Extract
tar -xzf process-compose_Linux_x86_64.tar.gz

# Move to PATH
sudo mv process-compose /usr/local/bin/

# Verify
process-compose version
```

**Go Install:**
```bash
go install github.com/f1bonacc1/process-compose@latest
```

### Quick Start

**1. Create config:**
```yaml
# process-compose.yaml
version: "0.5"

processes:
  redis:
    command: "redis-server --port 6379"

  web:
    command: "npm run dev"
    depends_on:
      redis:
        condition: process_started
    readiness_probe:
      http_get:
        port: 3000
```

**2. Start services:**
```bash
# Interactive TUI
process-compose up

# Detached mode
process-compose up --detach

# Attach to running session
process-compose attach
```

**3. Manage services:**
```bash
# View logs
process-compose logs web -f

# Restart service
process-compose restart web

# Stop all
process-compose down
```

**4. REST API:**
```bash
# Start with API
process-compose up --api

# Query status
curl http://localhost:8080/processes

# Start process
curl -X POST http://localhost:8080/processes/web/start
```

### mprocs Installation

**Cargo (Rust):**
```bash
cargo install mprocs
```

**Homebrew:**
```bash
brew install mprocs
```

**Usage:**
```bash
# Create config
cat > mprocs.yaml <<EOF
procs:
  web: npm run dev
  api: python manage.py runserver
EOF

# Run
mprocs
```

### Overmind Installation

**Homebrew:**
```bash
brew install overmind tmux
```

**Usage:**
```bash
# Create Procfile
cat > Procfile <<EOF
web: rails server -p $PORT
worker: sidekiq
EOF

# Start
overmind start

# Connect to process
overmind connect web
```

---

## Appendix: Decision Matrix

### Scoring Criteria (1-5 scale)

| Criteria | Weight | Process Compose | mprocs | Overmind | Keep Bash |
|----------|--------|----------------|---------|----------|-----------|
| **Features** |  |  |  |  |  |
| Health checks | 5 | 5 | 1 | 1 | 4 |
| Dependencies | 5 | 5 | 1 | 1 | 5 |
| Port management | 4 | 3 | 1 | 3 | 5 |
| Auto-recovery | 4 | 5 | 1 | 2 | 4 |
| **Usability** |  |  |  |  |  |
| TUI/UX | 3 | 5 | 5 | 4 | 1 |
| Learning curve | 3 | 4 | 5 | 4 | 5 |
| Documentation | 3 | 5 | 4 | 4 | 3 |
| **Integration** |  |  |  |  |  |
| Claude hooks | 5 | 3 | 2 | 2 | 5 |
| Styxy compat | 4 | 4 | 2 | 2 | 5 |
| Project detection | 5 | 1 | 1 | 1 | 5 |
| **Maintenance** |  |  |  |  |  |
| Maturity | 4 | 5 | 4 | 5 | 3 |
| Single binary | 2 | 5 | 5 | 5 | 1 |
| Community | 3 | 4 | 3 | 4 | 1 |

**Weighted Scores:**
- Process Compose: **4.2/5** (Best for service management)
- mprocs: **2.8/5** (Great UX, limited features)
- Overmind: **2.9/5** (Good for Rails, limited features)
- Keep Bash: **4.1/5** (Unique value, but lacks polish)

**Recommendation:** Hybrid (Bash orchestration + Process Compose execution) = **4.6/5**

---

## Conclusion

### Key Findings

1. **Process Compose is the market leader** for non-containerized service orchestration
2. **Our bash system has unique value** in project detection and tier sequencing
3. **Styxy should remain focused** on port allocation, not service lifecycle
4. **Hybrid architecture** leverages best tools for each layer

### Next Actions

1. ✅ **Document findings** (this report)
2. ⏳ **Install Process Compose** and test with AutoGen project
3. ⏳ **Evaluate integration effort** with bash orchestrator
4. ⏳ **Decide: migrate or keep current system**

### Decision Point

**Question:** Should we migrate to Process Compose?

**Answer:** **Yes, but gradually**
- Start with one project (AutoGen)
- Keep backward compatibility with JSON
- Preserve our orchestration layer
- Adopt incrementally based on team feedback

---

## References

### Documentation
- [Process Compose Official Docs](https://f1bonacc1.github.io/process-compose/)
- [Process Compose GitHub](https://github.com/F1bonacc1/process-compose)
- [Overmind GitHub](https://github.com/DarthSim/overmind)
- [mprocs GitHub](https://github.com/pvolok/mprocs)
- [Tilt Documentation](https://docs.tilt.dev/)

### Related Internal Docs
- `~/docs/PROJECT_AWARE_STARTUP_GUIDE.md` - Current system guide
- `~/scripts/claude/project-aware-session-startup.sh` - Main orchestrator
- `~/projects/autogen-local/.project-services.json` - Example config

### Community Resources
- [Process Compose vs Docker Compose Discussion](https://lobste.rs/s/2ekwvd/)
- [Overmind: Better Foreman (HN Discussion)](https://news.ycombinator.com/item?id=36925412)
- [Local Development with process-compose](https://shippingbytes.com/2024/06/10/local-development-with-process-compose/)

---

**Report Status:** ACTIVE
**Next Review:** After POC testing (target: 2025-10-18)
**Stakeholders:** CordlessSteve (owner), Future team members
**Related Decisions:** ADR-001 (if we create ADR for this)
