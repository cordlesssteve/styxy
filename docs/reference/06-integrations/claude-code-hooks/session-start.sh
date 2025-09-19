#!/bin/bash
#
# Styxy SessionStart Hook
# Registers Claude Code instance with Styxy daemon and sets up environment
#

set -euo pipefail

# Configuration
STYXY_URL="${STYXY_URL:-http://localhost:9876}"
HOOK_LOG_DIR="${HOME}/.claude/logs"
HOOK_LOG_FILE="${HOOK_LOG_DIR}/styxy-hooks.log"
INSTANCE_STATE_FILE="${HOME}/.claude/styxy-instance-state"

# Ensure log directory exists
mkdir -p "${HOOK_LOG_DIR}"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [SessionStart] $*" | tee -a "${HOOK_LOG_FILE}"
}

# Generate unique instance ID
generate_instance_id() {
    echo "claude-code-$(date +%s)-$$"
}

# Check if Styxy daemon is running
check_styxy_daemon() {
    local response
    if response=$(curl -s --max-time 3 "${STYXY_URL}/status" 2>/dev/null); then
        if echo "${response}" | grep -q '"status":"running"'; then
            return 0
        fi
    fi
    return 1
}

# Register instance with Styxy daemon
register_instance() {
    local instance_id="$1"
    local project_path="${CLAUDE_PROJECT_DIR:-$(pwd)}"

    local payload
    payload=$(cat <<EOF
{
  "instance_id": "${instance_id}",
  "working_directory": "${project_path}",
  "metadata": {
    "agent": "claude-code",
    "session_start": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "pid": $$,
    "features": ["cypress-integration"]
  }
}
EOF
)

    local response
    if response=$(curl -s --max-time 10 -X POST "${STYXY_URL}/instance/register" \
                       -H "Content-Type: application/json" \
                       -d "${payload}" 2>/dev/null); then

        if echo "${response}" | grep -q '"success":true'; then
            log "Instance ${instance_id} registered successfully"
            echo "${instance_id}" > "${INSTANCE_STATE_FILE}"
            export STYXY_INSTANCE_ID="${instance_id}"
            return 0
        else
            log "Registration failed: ${response}"
            return 1
        fi
    else
        log "Failed to connect to Styxy daemon at ${STYXY_URL}"
        return 1
    fi
}

# Start heartbeat process in background
start_heartbeat() {
    local instance_id="$1"

    # Check if heartbeat already running
    local heartbeat_pid_file="${HOME}/.claude/styxy-heartbeat.pid"
    if [[ -f "${heartbeat_pid_file}" ]]; then
        local existing_pid
        existing_pid=$(cat "${heartbeat_pid_file}")
        if kill -0 "${existing_pid}" 2>/dev/null; then
            log "Heartbeat already running with PID ${existing_pid}"
            return 0
        fi
    fi

    # Start new heartbeat process
    (
        while true; do
            if ! curl -s --max-time 5 -X PUT "${STYXY_URL}/instance/${instance_id}/heartbeat" \
                      -H "Content-Type: application/json" \
                      -d "{}" >/dev/null 2>&1; then
                log "Heartbeat failed for instance ${instance_id}"
            fi
            sleep 30
        done
    ) &

    local heartbeat_pid=$!
    echo "${heartbeat_pid}" > "${heartbeat_pid_file}"
    log "Started heartbeat process with PID ${heartbeat_pid}"
}

# Main execution
main() {
    log "Starting Styxy integration setup"

    # Check if Styxy daemon is available
    if ! check_styxy_daemon; then
        log "Styxy daemon not available at ${STYXY_URL} - continuing without integration"
        echo "⚠️  Styxy daemon not available - port coordination disabled"
        return 0
    fi

    # Generate or reuse instance ID
    local instance_id
    if [[ -f "${INSTANCE_STATE_FILE}" ]]; then
        instance_id=$(cat "${INSTANCE_STATE_FILE}")
        log "Reusing existing instance ID: ${instance_id}"
    else
        instance_id=$(generate_instance_id)
        log "Generated new instance ID: ${instance_id}"
    fi

    # Register with Styxy
    if register_instance "${instance_id}"; then
        start_heartbeat "${instance_id}"
        log "Styxy integration setup complete"
        echo "✅ Styxy port coordination active (Instance: ${instance_id})"
    else
        log "Failed to register with Styxy daemon"
        echo "⚠️  Failed to register with Styxy - port coordination disabled"
    fi
}

# Execute main function
main "$@"