# Styxy Port Interception - Known Limitations

**Last Updated:** 2025-09-30
**Applies To:** Universal PreToolUse Hook (`styxy-universal-intercept.sh`)

## Overview

Styxy's PreToolUse hook intercepts **bash commands executed by Claude Code** and automatically allocates ports for detected development tools. While this provides broad coverage for common workflows, there are inherent limitations in what can be intercepted at the command level.

---

## ✅ What IS Intercepted

### Languages & Frameworks

| Language | Tools Covered | Example Commands |
|----------|--------------|------------------|
| **JavaScript/Node** | npm, yarn, pnpm, next, vite, react-scripts | `npm run dev`, `next dev` |
| **Python** | uvicorn, fastapi, flask, django, http.server | `uvicorn main:app`, `python -m http.server 8000` |
| **Ruby** | rails, puma, unicorn, rackup | `rails server`, `puma -p 3000` |
| **Go** | go run | `go run main.go` |
| **PHP** | Built-in server | `php -S localhost:8000` |
| **Testing** | cypress, playwright, jest, vitest | `cypress run`, `playwright test` |
| **Docs** | docusaurus, mkdocs, vuepress | `npm run docs` |
| **Databases** | chroma, postgres, redis, firebase | `chroma run`, `firebase emulators:start` |

### Port Configuration Methods

✅ **Detected and Modified:**
- CLI flags: `--port`, `-p`, `--listen-port`, `--server-port`
- Environment variables: `PORT=`, `NODE_PORT=`, `FLASK_RUN_PORT=`, etc.
- Positional arguments: `python -m http.server 8000`
- Special formats: `php -S localhost:8000`

---

## ❌ What IS NOT Intercepted

### 🔴 Critical Gaps (High Impact)

#### 1. **Docker & Container Services**

**Not Detected:**
```bash
# Direct docker commands
docker run -p 8000:8000 chromadb/chroma

# Docker Compose
docker compose up
docker-compose up

# Port mappings in compose files
services:
  app:
    ports:
      - "3000:3000"
```

**Why:** Hook sees `docker compose up` but cannot parse YAML files or modify port mappings.

**Workaround:**
- Manually allocate ports before running containers
- Use Styxy CLI in your docker-compose.yml environment variables:
  ```yaml
  services:
    app:
      environment:
        - PORT=${STYXY_PORT}
  ```
- Run: `STYXY_PORT=$(styxy allocate --service api --json | jq -r '.port') docker compose up`

---

#### 2. **Already-Running Services**

**Not Detected:**
```bash
# Service started before Claude Code session
# OR
# Service started by systemd/supervisor/pm2
systemctl --user start my-app.service
pm2 start app.js
```

**Why:** No interception point - service already bound to port.

**Workaround:**
- Stop and restart service within Claude Code session
- Configure services to read port from Styxy at startup
- Use Styxy singleton services (Feature #1) when implemented

---

#### 3. **Wrapper Scripts & Indirect Launches**

**Not Detected:**
```bash
# Claude sees this:
./start-dev.sh

# Script actually contains:
#!/bin/bash
export PORT=3000
npm run dev
```

**Why:** Hook only sees the wrapper script name, not its contents.

**Workaround:**
- Add Styxy calls inside wrapper scripts:
  ```bash
  #!/bin/bash
  PORT=$(styxy allocate --service dev --json | jq -r '.port')
  export PORT
  npm run dev
  ```

---

#### 4. **Make/Task Runner Targets**

**Not Detected:**
```bash
# Claude sees:
make dev

# Makefile contains:
dev:
    uvicorn main:app --port 8000
```

**Why:** Hook sees `make dev` but cannot parse Makefiles.

**Workaround:**
- Pass port as Make variable:
  ```bash
  PORT=$(styxy allocate --service api --json | jq -r '.port') make dev PORT=$PORT
  ```
- Or update Makefile to call Styxy:
  ```makefile
  dev:
      $(eval PORT := $(shell styxy allocate --service api --json | jq -r '.port'))
      uvicorn main:app --port $(PORT)
  ```

---

#### 5. **Config File-Based Ports**

**Not Detected:**
```bash
# These read ports from config files:
next dev              # reads next.config.js
vite                  # reads vite.config.js
webpack serve         # reads webpack.config.js
```

**Why:** Tools use default behavior from config files, no CLI port argument.

**Workaround:**
- Add explicit port flag:
  ```bash
  next dev -p $(styxy allocate --service dev --json | jq -r '.port')
  ```
- Or modify config file to read from environment:
  ```javascript
  // next.config.js
  module.exports = {
    server: {
      port: process.env.PORT || 3000
    }
  }
  ```

---

### 🟡 Medium Gaps

#### 6. **Non-Bash Subprocess Execution**

**Not Detected:**
```bash
# Python subprocess
python -c "import subprocess; subprocess.run(['uvicorn', 'main:app'])"

# Node child_process
node -e "require('child_process').spawn('next', ['dev'])"
```

**Why:** Hook only intercepts `Bash(*)` tool calls, not language-specific subprocess APIs.

**Impact:** Rare in typical Claude Code workflows.

---

#### 7. **Unsupported Languages**

**Not Currently Detected:**

| Language | Missing Tools | Typical Ports |
|----------|--------------|---------------|
| .NET | `dotnet run` | 5000-5001 |
| Java | `mvn spring-boot:run`, `gradle bootRun` | 8080 |
| Rust | `cargo run` | 8080 |
| Elixir | `mix phx.server` | 4000 |
| Scala | `sbt run` | 9000 |

**Workaround:**
- Add detection patterns to `styxy-universal-intercept.sh`
- Or use explicit Styxy CLI:
  ```bash
  PORT=$(styxy allocate --service api --json | jq -r '.port') dotnet run
  ```

---

#### 8. **Multi-Service Commands**

**Partially Detected:**
```bash
# Firebase starts MULTIPLE services on different ports
firebase emulators:start
# auth: 9099, functions: 5001, ui: 4000, hub: 4400
```

**Issue:** Hook detects "firebase emulators" and allocates **one port**, but Firebase needs multiple ports.

**Workaround:**
- Use Firebase's port configuration file
- Or allocate ports individually:
  ```bash
  AUTH_PORT=$(styxy allocate --service auth --json | jq -r '.port')
  FUNCTIONS_PORT=$(styxy allocate --service functions --json | jq -r '.port')
  firebase emulators:start --only auth --port $AUTH_PORT
  ```

---

### 🟢 Low Impact Gaps

#### 9. **Port Ranges**

**Not Detected:**
```bash
selenium-standalone start --port 4444-4544
```

**Impact:** Rare use case, primarily testing infrastructure.

---

#### 10. **Dynamic Port Allocation**

**Cannot Coordinate:**
```bash
# Tool picks random available port
pytest --live-server-port=0  # 0 = OS-assigned random port
```

**Why:** Application bypasses explicit port selection.

**Impact:** Testing edge case, doesn't cause conflicts if truly random.

---

#### 11. **Custom Binaries**

**Not Detected:**
```bash
./my-custom-server
./proprietary-tool --start
```

**Why:** Unknown tools with no recognizable patterns.

**Workaround:**
- Add pattern to detection functions if tool is used regularly
- Or wrap in script that calls Styxy first

---

## 📊 Gap Severity Summary

| Category | Severity | Frequency | Recommended Action |
|----------|----------|-----------|-------------------|
| Docker/Compose | 🔴 Critical | High | Manual integration required |
| Already-running services | 🔴 Critical | High | Restart in session or use systemd integration |
| Wrapper scripts | 🔴 Critical | Very High | Document pattern, add Styxy to scripts |
| Make/task runners | 🔴 Critical | High | Document workaround |
| Config file ports | 🔴 Critical | Medium | Use explicit port flags |
| Non-bash subprocesses | 🟡 Medium | Low | Acceptable limitation |
| Unsupported languages | 🟡 Medium | Medium | Add as needed |
| Multi-service commands | 🟡 Medium | Low | Document Firebase-specific handling |
| Port ranges | 🟢 Low | Very Low | No action needed |
| Dynamic ports | 🟢 Low | Very Low | No action needed |
| Custom binaries | 🟢 Low | Low | Case-by-case basis |

---

## 🎯 Future Solutions

### Short Term (Can Implement Now)

1. **Add more language detections** as users request them
2. **Document common wrapper patterns** and provide templates
3. **Create Docker Compose integration guide**

### Medium Term (Requires Development)

1. **Styxy systemd integration** - manage already-running services
2. **Config file parser** - detect and modify ports in common config formats
3. **Docker plugin/wrapper** - intercept docker commands specially

### Long Term (Research Projects)

1. **LD_PRELOAD interception** (Feature #4 in backlog)
   - OS-level syscall interception
   - Handles ALL gaps including Docker, wrappers, subprocesses
   - Requires C/C++ development
   - Platform-specific (Linux/macOS/Windows)

2. **Container runtime integration**
   - Native Docker/Podman hooks
   - Automatic port mapping coordination

---

## 💡 Best Practices

### For Users

1. **Prefer explicit port flags** over environment variables when possible
2. **Add Styxy calls to wrapper scripts** you control
3. **Document port allocation** in project README for team consistency
4. **Use Styxy CLI directly** for unsupported tools
5. **Restart services within Claude session** rather than relying on background services

### For Tool Authors

If you're developing tools that need port coordination:

1. **Support `--port` flag** as standard CLI argument
2. **Read `PORT` environment variable** as fallback
3. **Provide config file override** for programmatic port assignment
4. **Document port configuration** prominently

---

## 🔍 Troubleshooting

### "My tool isn't being intercepted"

1. Check if tool is in supported list (see "What IS Intercepted")
2. Verify command syntax matches detection patterns
3. Check hook logs: `tail -f ~/.claude/logs/styxy-hooks.log`
4. File issue with command example for potential addition

### "Port allocation happened but tool ignored it"

1. Tool may be reading port from config file - add explicit `--port` flag
2. Tool may be using different flag name - check tool documentation
3. Environment variable may be set elsewhere - check env with `env | grep PORT`

### "Docker containers still conflicting"

Docker is a known limitation. Use workarounds documented above or manually coordinate ports before running containers.

---

## 📝 Contributing

To add support for a new tool:

1. Add detection function to `styxy-universal-intercept.sh`
2. Add tool-specific port argument handling to `modify_command_with_port()`
3. Test with example commands
4. Update this document's "What IS Intercepted" section
5. Submit PR with examples

---

## 📚 Related Documentation

- [FEATURE_BACKLOG.md](../FEATURE_BACKLOG.md) - Planned improvements including LD_PRELOAD research
- [IANA_PORT_REGISTRY.md](./references/IANA_PORT_REGISTRY.md) - Port allocation standards
- [README.md](../README.md) - Styxy overview and architecture
