# Styxy Test Suite

This directory contains the comprehensive test suite for Styxy, organized into three layers:

## Test Structure

### Unit Tests (`tests/unit/`)
- **Daemon Tests**: Core StyxyDaemon class functionality
- **Utils Tests**: Port scanner and utility functions
- **Command Tests**: Individual CLI command logic

### Integration Tests (`tests/integration/`)
- **API Tests**: HTTP REST API endpoints with real Express server
- **Daemon Lifecycle**: Start/stop/restart scenarios
- **Port Workflows**: Complete allocation/release flows

### End-to-End Tests (`tests/e2e/`)
- **CLI Tests**: Full CLI commands against running daemon
- **Scenarios**: Multi-instance coordination and complex workflows

## Running Tests

```bash
# Run all tests
npm test

# Run specific test layers
npm run test:unit
npm run test:integration
npm run test:e2e

# Run with coverage
npm run test:coverage

# Watch mode for development
npm run test:watch
```

## Test Helpers

### TestDaemonHelper
- Manages isolated daemon instances for testing
- Handles temporary directories and cleanup
- Provides daemon lifecycle management

### TestCliHelper
- Executes CLI commands programmatically
- Captures stdout/stderr and exit codes
- Provides convenient methods for each command

### TestPortHelper
- Finds available ports for testing
- Creates temporary test servers
- Manages port allocation conflicts

## Configuration

Tests use isolated configurations with:
- Dynamic port assignment to avoid conflicts
- Temporary directories for state persistence
- Reduced logging and faster timeouts
- High port ranges (10000+) to avoid system conflicts

## Key Features Tested

- ✅ Port allocation and release
- ✅ Service type separation and ranges
- ✅ Concurrent allocation handling
- ✅ State persistence across restarts
- ✅ CLI command validation and output
- ✅ Multi-instance coordination
- ✅ Cleanup and error handling
- ✅ System vs Styxy port detection

The test suite ensures bulletproof reliability for Styxy's core mission of eliminating port conflicts in development environments.