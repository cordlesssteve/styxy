# Development Documentation

This directory contains development setup, practices, and contribution guidelines.

## Development Setup

### Prerequisites
- Node.js 18+
- npm or yarn

### Local Development
```bash
# Clone and install
git clone https://github.com/username/styxy.git
cd styxy
npm install

# Test locally
./bin/styxy daemon start
./bin/styxy allocate --service dev --name test
```

### Project Structure
```
src/
├── daemon.js          # Core daemon implementation
├── index.js          # CLI entry point
├── commands/         # CLI command implementations
└── config/          # Configuration management

config/
└── core-ports.json  # CORE documentation integration
```

## Development Guidelines

- Follow existing code style and patterns
- Test all CLI commands before submitting changes
- Ensure CORE documentation compliance
- Update documentation for new features