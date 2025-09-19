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
STYXY_AUTH_TOKEN_FILE="${HOME}/.styxy/auth.token"

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
    local auth_token=""
    if [[ -f "${STYXY_AUTH_TOKEN_FILE}" ]]; then
        auth_token=$(cat "${STYXY_AUTH_TOKEN_FILE}")
    fi

    if [[ -n "${auth_token}" ]]; then
        response=$(curl -s --max-time 3 -H "Authorization: Bearer ${auth_token}" "${STYXY_URL}/status" 2>/dev/null)
    else
        response=$(curl -s --max-time 3 "${STYXY_URL}/status" 2>/dev/null)
    fi

    if [[ $? -eq 0 ]] && echo "${response}" | grep -q '"status":"running"'; then
        return 0
    fi
    return 1
}

# Start Styxy daemon if not running
start_styxy_daemon() {
    log "Starting Styxy daemon..."

    # Look for styxy binary in common locations
    local styxy_binary=""
    local script_dir="$(dirname "$0")"
    local search_paths=(
        "${script_dir}/../../../../bin/styxy"  # Relative to hook script location
        "${HOME}/projects/styxy/bin/styxy"    # Generic user home reference
        "$(which styxy 2>/dev/null)"          # System PATH
        "./bin/styxy"                         # Current directory
        "/usr/local/bin/styxy"                # System install location
    )

    for path in "${search_paths[@]}"; do
        if [[ -x "$path" ]]; then
            styxy_binary="$path"
            break
        fi
    done

    if [[ -z "$styxy_binary" ]]; then
        log "Could not find styxy binary in expected locations"
        return 1
    fi

    log "Found styxy binary at: $styxy_binary"

    # Start daemon in background using --detach flag
    if "$styxy_binary" daemon start --port 9876 --detach >/dev/null 2>&1; then
        # Wait a moment for daemon to initialize
        sleep 3

        # Verify daemon started successfully
        if check_styxy_daemon; then
            log "Styxy daemon started successfully"
            return 0
        else
            log "Styxy daemon failed to start properly"
            return 1
        fi
    else
        log "Failed to execute styxy daemon start command"
        return 1
    fi
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
    local auth_token=""
    if [[ -f "${STYXY_AUTH_TOKEN_FILE}" ]]; then
        auth_token=$(cat "${STYXY_AUTH_TOKEN_FILE}")
    fi

    log "Attempting instance registration..."
    if [[ -n "${auth_token}" ]]; then
        response=$(curl -s --max-time 10 -X POST "${STYXY_URL}/instance/register" \
                       -H "Content-Type: application/json" \
                       -H "Authorization: Bearer ${auth_token}" \
                       -d "${payload}" 2>&1)
    else
        response=$(curl -s --max-time 10 -X POST "${STYXY_URL}/instance/register" \
                       -H "Content-Type: application/json" \
                       -d "${payload}" 2>&1)
    fi

    if [[ $? -eq 0 ]]; then

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
        log "Failed to connect to Styxy daemon at ${STYXY_URL}, response: ${response}"
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

    # Get auth token for heartbeat
    local auth_token=""
    if [[ -f "${STYXY_AUTH_TOKEN_FILE}" ]]; then
        auth_token=$(cat "${STYXY_AUTH_TOKEN_FILE}")
    fi

    # Start new heartbeat process (fully detached)
    nohup bash -c "
        while true; do
            local auth_args=''
            if [[ -n '${auth_token}' ]]; then
                auth_args='-H Authorization: Bearer ${auth_token}'
            fi
            if ! curl -s --max-time 5 -X PUT '${STYXY_URL}/instance/${instance_id}/heartbeat' \
                      -H 'Content-Type: application/json' \
                      \${auth_args} \
                      -d '{}' >/dev/null 2>&1; then
                echo \"[$(date '+%Y-%m-%d %H:%M:%S')] [Heartbeat] Failed for instance ${instance_id}\" >> '${HOOK_LOG_FILE}'
            fi
            sleep 30
        done
    " >/dev/null 2>&1 &

    local heartbeat_pid=$!
    echo "${heartbeat_pid}" > "${heartbeat_pid_file}"
    log "Started heartbeat process with PID ${heartbeat_pid}"
}

# Main execution
main() {
    log "Starting Styxy integration setup"

    # Check if Styxy daemon is available, start if needed
    if ! check_styxy_daemon; then
        log "Styxy daemon not running, attempting to start..."

        if start_styxy_daemon; then
            log "Successfully started Styxy daemon"
        else
            log "Failed to start Styxy daemon - continuing without integration"
            echo "⚠️  Could not start Styxy daemon - port coordination disabled"
            return 0
        fi
    else
        log "Styxy daemon already running"
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