# Compliance Documentation

This directory contains regulatory compliance and standards documentation.

## Documentation Standards

### Universal Project Documentation Standard v2.0
- **Status**: COMPLIANT ✅
- **Required Files**: CURRENT_STATUS.md, ACTIVE_PLAN.md ✅
- **Directory Structure**: docs/plans/, docs/progress/, docs/reference/ ✅
- **Status Headers**: All documents have proper status tracking ✅

### CORE Port Reference Guide v2.0
- **Status**: FULLY INTEGRATED ✅
- **Service Types**: 13 categories implemented ✅
- **Port Ranges**: Non-overlapping, sequential allocation ✅
- **Instance Templates**: 4 multi-instance patterns ✅
- **Compliance Validation**: Built-in via `styxy config validate` ✅

## Audit Trail

### Configuration Sources
- **Primary**: `config/core-ports.json` (CORE v2.0 integration)
- **User Overrides**: `~/.styxy/config.json` (optional)
- **Validation**: Real-time compliance checking

### Port Allocation Compliance
```bash
# Verify current compliance
styxy config validate

# Show compliance status
styxy config show

# Check instance template compliance
styxy config instances
```

## Standards Adherence

### Port Organization Principles
1. **1:1 Port Mapping**: Container and host ports identical
2. **Non-overlapping Ranges**: Each service type has dedicated ranges
3. **Multi-instance Support**: 4+ concurrent instances per service type
4. **Sequential Allocation**: Ports allocated sequentially within ranges

### Documentation Requirements
- ✅ Status-driven document management
- ✅ Clear plan evolution tracking
- ✅ Mandatory reading order for Claude Code
- ✅ Version control integration ready