# Development Guide

Development setup, contribution guidelines, and testing procedures for Styxy.

## Prerequisites

- **Node.js**: 18+ (tested with v20.19.3)
- **Operating System**: Linux, macOS, or Windows with WSL
- **System Tools**: `lsof`, `netstat`, or `ss` for port detection

## Quick Setup

```bash
# Clone repository
git clone https://github.com/cordlesssteve/styxy.git
cd styxy

# Install dependencies
npm install

# Run tests to verify setup
npm test

# Start daemon for development
node src/daemon.js --daemon --port 9876
```

## Project Structure

```
styxy/
├── src/                    # Source code
│   ├── daemon.js          # Main daemon implementation
│   ├── index.js           # CLI entry point
│   ├── commands/          # CLI command implementations
│   └── utils/             # Utilities (port-scanner, daemon-client)
├── bin/                   # Executable scripts
│   └── styxy              # Main CLI binary
├── tests/                 # Test suite
│   ├── unit/              # Unit tests
│   ├── integration/       # Integration tests
│   ├── e2e/               # End-to-end tests
│   └── helpers/           # Test utilities
├── docs/                  # Documentation
└── package.json           # Dependencies and scripts
```

## Testing Architecture

Styxy uses **Jest** with a comprehensive 3-level testing strategy:

### Test Levels

1. **Unit Tests** (34 tests): Test individual components in isolation
2. **Integration Tests** (14 tests): Test API endpoints with real daemon
3. **E2E Tests** (26 tests): Test complete CLI workflows and scenarios

### Running Tests

```bash
# Run all tests
npm test

# Run specific test levels
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm test -- --coverage

# Run specific test file
npm test -- tests/unit/daemon/daemon.test.js

# Run tests matching pattern
npm test -- --testNamePattern="allocation"
```

## Development Guidelines

### Code Style
- **Consistent indentation**: 2 spaces
- **Error handling**: Always handle async errors properly
- **Comments**: Minimal - code should be self-documenting
- **JSON support**: All CLI commands must support `--json` flag

### Testing Requirements
- ✅ All tests must pass: `npm test`
- ✅ New features must have tests (unit + integration + e2e)
- ✅ Bug fixes must include regression tests
- ✅ CLI commands must handle both text and JSON output

### Architecture Principles
1. **Single Source of Truth**: Daemon holds all state
2. **Zero Race Conditions**: Atomic operations only
3. **Cross-Platform**: Use Node.js abstractions
4. **Graceful Degradation**: Handle system tool failures