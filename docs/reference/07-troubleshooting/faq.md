# Frequently Asked Questions (FAQ)

## General Questions

### What is Styxy?
Styxy is a development port coordination daemon that prevents port conflicts in multi-instance development environments. It provides intelligent port allocation, real-time coordination, and integrates with development tools like Claude Code.

### How does Styxy prevent port conflicts?
Styxy maintains a centralized registry of port allocations. When development tools request ports, Styxy either assigns from available ranges or returns already-allocated ports for the same service/instance combination.

### Is Styxy secure?
Yes, Styxy:
- Runs locally only (127.0.0.1)
- Supports API key authentication
- Sanitizes all inputs and logs
- Has comprehensive audit logging
- Follows security best practices

## Installation and Setup

### How do I install Styxy?
```bash
# Clone the repository
git clone https://github.com/cordlesssteve/styxy.git
cd styxy

# Install dependencies
npm install

# Start the daemon
./bin/styxy daemon start
```

### Do I need to configure anything?
No, Styxy works out of the box with sensible defaults based on CORE documentation standards. Configuration is automatically loaded for 13 different service types.

### How do I verify Styxy is working?
```bash
# Run health check
styxy doctor

# Test allocation
styxy allocate -s dev

# Check daemon status
styxy daemon status
```

## Usage Questions

### How do I allocate a port?
```bash
# Let Styxy choose the best port
styxy allocate -s dev

# Request specific port
styxy allocate -s dev -p 3000

# With service name
styxy allocate -s storybook -n my-component-library
```

### How do I release a port?
```bash
# Release specific allocation
styxy release <lock-id>

# Cleanup all stale allocations
styxy cleanup

# List allocations to find lock ID
styxy list
```

### What service types are available?
Run `styxy config show` to see all available service types. Common ones include:
- `dev` - General development servers
- `api` - API servers
- `test` - Test servers
- `storybook` - Storybook instances
- `docs` - Documentation servers
- `next` - Next.js applications
- `react` - React development servers
- `vue` - Vue.js applications
- `cypress` - Cypress testing

### Can I use Styxy with Docker?
Yes! Allocate ports before starting containers:
```bash
# Allocate port
PORT=$(styxy allocate -s api --json | jq -r '.port')

# Use in Docker
docker run -p $PORT:3000 my-app

# Remember to release when done
styxy release <lock-id>
```

## Claude Code Integration

### How does Styxy integrate with Claude Code?
Styxy uses PreToolUse hooks to intercept development tool commands and automatically allocate ports. This works transparently - just run your normal commands and Styxy handles port coordination.

### Which development tools are supported?
Styxy supports 32+ development tools including:
- **Frontend**: React, Next.js, Vue, Angular, Vite
- **Backend**: FastAPI, Django, Flask, Node.js
- **Testing**: Cypress, Playwright, Jest
- **Documentation**: Storybook, Docusaurus, MkDocs
- **Build Tools**: Webpack dev server, Vercel, Netlify

### How do I configure Claude Code hooks?
Hooks are automatically configured when you run the daemon. Check your `~/.claude/settings.json` for hook configuration.

### Can I disable Claude Code integration?
Yes, Styxy works independently. You can use CLI commands directly without Claude Code integration.

## Troubleshooting

### Styxy says "daemon not running" but I started it
1. Check if daemon is actually running: `ps aux | grep styxy`
2. Verify port 9876 is available: `lsof -i :9876`
3. Try different port: `styxy daemon start -p 8765`
4. Run health check: `styxy doctor`

### Port allocation fails with "range exhausted"
```bash
# Clean up stale allocations
styxy cleanup

# Check what's using ports
styxy scan -s 3000 -e 3100

# List current allocations
styxy list --service <service-type>

# Use different service type with available range
styxy allocate -s api  # instead of dev
```

### Enhanced error messages aren't showing
Make sure you're using the latest version of Styxy. Enhanced errors were added in the UX improvement update and provide actionable suggestions for common issues.

### How do I reset everything?
```bash
# Stop daemon
styxy daemon stop

# Remove all state (loses current allocations)
rm -rf ~/.styxy/daemon.state

# Restart fresh
styxy daemon start

# Verify clean state
styxy list
```

### Performance is slow
1. Run `styxy doctor` to check system health
2. Reduce port scan ranges in configuration
3. Clean up stale allocations: `styxy cleanup`
4. Restart daemon: `styxy daemon restart`

## Advanced Usage

### Can I run Styxy on a different port?
```bash
# Start daemon on custom port
styxy daemon start -p 8765

# Set environment variable for clients
export STYXY_DAEMON_PORT=8765
```

### How do I backup my allocations?
```bash
# Copy state file
cp ~/.styxy/daemon.state ~/.styxy/backup-$(date +%Y%m%d).state

# Or use JSON export
styxy list --json > allocations-backup.json
```

### Can I use Styxy in CI/CD?
Yes, use JSON output for scripting:
```bash
# Allocate port for testing
ALLOCATED=$(styxy allocate -s test --json)
PORT=$(echo $ALLOCATED | jq -r '.port')
LOCK_ID=$(echo $ALLOCATED | jq -r '.lock_id')

# Use port in tests
npm test -- --port $PORT

# Clean up
styxy release $LOCK_ID
```

### How do I monitor Styxy?
```bash
# Health checks
styxy doctor

# Metrics endpoint
curl http://127.0.0.1:9876/metrics

# Real-time monitoring
watch 'styxy list -v'

# Log monitoring
tail -f ~/.styxy/logs/daemon.log
```

### Can I extend Styxy with custom service types?
Currently, service types are defined by CORE documentation standards. Custom service types will be supported in future versions. For now, use existing types that match your port range needs.

## Integration Questions

### How do I integrate with my development workflow?
1. Start Styxy daemon: `styxy daemon start`
2. Use normal development commands - Styxy handles ports automatically
3. For manual control: `styxy allocate -s <service-type>`
4. Clean up when done: `styxy cleanup`

### Can I use Styxy with multiple projects?
Yes! Styxy supports instance-based allocation:
```bash
# Project A
styxy allocate -s dev --project /path/to/project-a

# Project B
styxy allocate -s dev --project /path/to/project-b

# Different instances get different ports automatically
```

### How do I handle team development?
Each developer runs their own Styxy daemon locally. Styxy coordinates ports per machine, not across the network. For team coordination, consider:
- Standardizing service type usage
- Sharing configuration templates
- Using instance names for clarity

### Can I integrate with my IDE?
Styxy works with any IDE that runs development commands. The Claude Code integration is one example. For other IDEs:
- Use terminal integration with Styxy CLI
- Create IDE tasks that include Styxy commands
- Use port environment variables from Styxy

## Performance and Limits

### How many ports can Styxy manage?
Styxy can manage thousands of ports. Practical limits are:
- Available port range (typically 3000-9999 for development)
- System resources (memory usage is minimal)
- Service type configurations

### Does Styxy affect performance?
Styxy has minimal performance impact:
- Port allocation: ~1-10ms
- Background scanning: Configurable intervals
- Memory usage: ~10-50MB
- CPU usage: Negligible when idle

### How long do allocations last?
Allocations persist until explicitly released or daemon restart. Styxy includes:
- Automatic cleanup of stale allocations
- Heartbeat monitoring for active instances
- Configurable timeout policies

## Contributing and Support

### How do I report bugs?
1. Run `styxy doctor` to collect diagnostic information
2. Check existing issues: https://github.com/cordlesssteve/styxy/issues
3. Create new issue with:
   - System information
   - Steps to reproduce
   - Expected vs actual behavior
   - Debug output

### Can I contribute features?
Yes! Styxy welcomes contributions:
- Check open issues for requested features
- Follow the development setup in README
- Run tests: `npm test`
- Submit pull requests

### Where can I get help?
1. **Self-help**: Run `styxy doctor` for immediate diagnostics
2. **Documentation**: Check enhanced troubleshooting guide
3. **Enhanced Errors**: Pay attention to actionable suggestions
4. **Community**: GitHub issues and discussions
5. **Professional**: Contact for enterprise support

### How do I stay updated?
- Watch the GitHub repository for releases
- Check changelog for new features
- Run `styxy --version` to check current version
- Enhanced error messages include help URLs for latest guidance

---

*For more detailed information, see the [Enhanced Troubleshooting Guide](./enhanced-troubleshooting-guide.md) and run `styxy doctor` for system-specific guidance.*