#!/bin/bash
#
# Styxy PreToolUse Hook - Cypress Interception
# Intercepts Cypress commands and allocates ports via Styxy daemon
#

set -euo pipefail

# Configuration
STYXY_URL="${STYXY_URL:-http://localhost:9876}"
STYXY_CONFIG_DIR="${HOME}/.styxy"
STYXY_TOKEN_FILE="${STYXY_CONFIG_DIR}/auth.token"
HOOK_LOG_DIR="${HOME}/.claude/logs"
HOOK_LOG_FILE="${HOOK_LOG_DIR}/styxy-hooks.log"
INSTANCE_STATE_FILE="${HOME}/.claude/styxy-instance-state"

# Tool execution information from Claude Code hook environment
TOOL_NAME="${1:-unknown}"
TOOL_ARGS="${2:-}"

# Ensure log directory exists
mkdir -p "${HOOK_LOG_DIR}"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [PreToolUse-Cypress] $*" >> "${HOOK_LOG_FILE}"
}

# Get instance ID
get_instance_id() {
    if [[ -f "${INSTANCE_STATE_FILE}" ]]; then
        cat "${INSTANCE_STATE_FILE}"
    else
        echo "claude-code-unknown"
    fi
}

# Check if command contains Cypress
is_cypress_command() {
    local args="$1"
    if echo "${args}" | grep -qE "\bcypress\b"; then
        return 0
    fi
    return 1
}

# Extract existing port from command
extract_existing_port() {
    local args="$1"
    local port=""

    # Check for various Cypress port patterns
    if echo "${args}" | grep -qE -- "--port[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*--port[= ]([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE -- "-p[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*-p[= ]([0-9]+).*/\1/p')
    fi

    echo "${port}"
}

# Get API token for authentication
get_auth_token() {
    if [[ -f "${STYXY_TOKEN_FILE}" ]]; then
        cat "${STYXY_TOKEN_FILE}"
    else
        echo ""
    fi
}

# Allocate port from Styxy
allocate_port() {
    local preferred_port="$1"
    local instance_id="$2"
    local project_path="${CLAUDE_PROJECT_DIR:-$(pwd)}"
    local auth_token
    auth_token=$(get_auth_token)

    local payload
    if [[ -n "${preferred_port}" ]]; then
        payload=$(cat <<EOF
{
  "service_type": "test",
  "service_name": "cypress-e2e",
  "preferred_port": ${preferred_port},
  "instance_id": "${instance_id}",
  "project_path": "${project_path}"
}
EOF
)
    else
        payload=$(cat <<EOF
{
  "service_type": "test",
  "service_name": "cypress-e2e",
  "instance_id": "${instance_id}",
  "project_path": "${project_path}"
}
EOF
)
    fi

    local response
    local curl_headers=("-H" "Content-Type: application/json")
    if [[ -n "${auth_token}" ]]; then
        curl_headers+=("-H" "Authorization: Bearer ${auth_token}")
    fi

    if response=$(curl -s --max-time 10 -X POST "${STYXY_URL}/allocate" \
                       "${curl_headers[@]}" \
                       -d "${payload}" 2>/dev/null); then

        if echo "${response}" | grep -q '"success":true'; then
            local allocated_port
            allocated_port=$(echo "${response}" | grep -o '"port":[0-9]*' | grep -o '[0-9]*')
            local lock_id
            lock_id=$(echo "${response}" | grep -o '"lock_id":"[^"]*"' | cut -d'"' -f4)

            if [[ -n "${allocated_port}" && -n "${lock_id}" ]]; then
                log "Allocated port ${allocated_port} for Cypress (lock: ${lock_id})"
                echo "${allocated_port}:${lock_id}"
                return 0
            else
                log "Failed to parse allocation response: port='${allocated_port}' lock='${lock_id}' response='${response}'"
            fi
        fi
    fi

    log "Failed to allocate port from Styxy: ${response}"
    return 1
}

# Modify command with allocated port
modify_command_with_port() {
    local original_args="$1"
    local new_port="$2"

    # Remove existing port arguments
    local modified_args
    modified_args=$(echo "${original_args}" | sed -E 's/--port[= ][0-9]+//g' | sed -E 's/-p[= ][0-9]+//g')

    # Add new port argument
    modified_args="${modified_args} --port ${new_port}"

    # Clean up extra spaces
    echo "${modified_args}" | tr -s ' ' | sed 's/^ *//;s/ *$//'
}

# Create hook output for Claude Code
create_hook_output() {
    local permission="$1"
    local reason="$2"
    local modified_command="$3"

    cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "${permission}",
    "permissionDecisionReason": "${reason}"
  },
  "modifiedCommand": "${modified_command}",
  "continue": true
}
EOF
}

# Main execution
main() {
    log "Intercepting tool use: ${TOOL_NAME} with args: ${TOOL_ARGS}"

    # Check if this is a Cypress command
    if ! is_cypress_command "${TOOL_ARGS}"; then
        log "Not a Cypress command, allowing execution"
        create_hook_output "allow" "Not a Cypress command" ""
        return 0
    fi

    log "Detected Cypress command, attempting port allocation"

    # Get instance ID
    local instance_id
    instance_id=$(get_instance_id)

    # Extract any existing port specification
    local existing_port
    existing_port=$(extract_existing_port "${TOOL_ARGS}")

    # Allocate port from Styxy
    local allocation_result
    if allocation_result=$(allocate_port "${existing_port}" "${instance_id}"); then
        local allocated_port="${allocation_result%%:*}"
        local lock_id="${allocation_result##*:}"

        # Modify command with allocated port
        local modified_command
        modified_command=$(modify_command_with_port "${TOOL_ARGS}" "${allocated_port}")

        log "Successfully modified Cypress command with port ${allocated_port}"
        create_hook_output "allow" "Port ${allocated_port} allocated via Styxy (lock: ${lock_id})" "${modified_command}"

        # Store lock ID for potential cleanup
        echo "${lock_id}" >> "${HOME}/.claude/styxy-active-locks"

    else
        log "Failed to allocate port, allowing original command"
        create_hook_output "allow" "Styxy allocation failed, using original command" ""
    fi
}

# Execute main function
main "$@"