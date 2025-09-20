#!/bin/bash
#
# Styxy Universal PreToolUse Hook - Multi-Tool Port Interception
# Detects and allocates ports for all common development tools
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
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [PreToolUse-Universal] $*" >> "${HOOK_LOG_FILE}"
}

# Get instance ID
get_instance_id() {
    if [[ -f "${INSTANCE_STATE_FILE}" ]]; then
        cat "${INSTANCE_STATE_FILE}"
    else
        echo "claude-code-universal"
    fi
}

# Tool Detection Functions
detect_dev_tools() {
    local args="$1"
    # Frontend development servers
    if echo "${args}" | grep -qE "\b(react-scripts|next|vite|ng serve|vue-cli-service|nuxt|svelte|parcel|webpack-dev-server|webpack serve)\b"; then
        echo "dev"
        return 0
    fi
    # NPM/Yarn dev scripts that typically start dev servers
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +(run +)?dev\b"; then
        echo "dev"
        return 0
    fi
    return 1
}

detect_api_tools() {
    local args="$1"
    # Backend API servers
    if echo "${args}" | grep -qE "\b(uvicorn|fastapi|django|flask|express|node server|nest start|deno run)\b"; then
        echo "api"
        return 0
    fi
    # Common backend start patterns
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +(run +)?(server|backend|api)\b"; then
        echo "api"
        return 0
    fi
    return 1
}

detect_test_tools() {
    local args="$1"
    # Testing frameworks and tools
    if echo "${args}" | grep -qE "\b(cypress|playwright|jest|vitest|karma|puppeteer)\b"; then
        echo "test"
        return 0
    fi
    # Test runner patterns
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +(run +)?(test|e2e|integration)\b"; then
        echo "test"
        return 0
    fi
    return 1
}

detect_storybook_tools() {
    local args="$1"
    # Storybook and component development
    if echo "${args}" | grep -qE "\b(storybook|bit start|styleguidist)\b"; then
        echo "storybook"
        return 0
    fi
    return 1
}

detect_database_tools() {
    local args="$1"
    # Database servers and emulators
    if echo "${args}" | grep -qE "\b(firebase emulators|mongod|postgres|mysqld|redis-server|couchdb)\b"; then
        echo "database"
        return 0
    fi
    return 1
}

detect_functions_tools() {
    local args="$1"
    # Serverless functions and emulators
    if echo "${args}" | grep -qE "\b(firebase.*functions|vercel dev|netlify dev|sam local|serverless offline)\b"; then
        echo "functions"
        return 0
    fi
    return 1
}

detect_ui_tools() {
    local args="$1"
    # UI and admin interfaces
    if echo "${args}" | grep -qE "\b(firebase.*ui|grafana-server|adminer)\b"; then
        echo "ui"
        return 0
    fi
    return 1
}

detect_docs_tools() {
    local args="$1"
    # Documentation servers
    if echo "${args}" | grep -qE "\b(docusaurus|gitbook|mkdocs|sphinx|vuepress|jekyll)\b"; then
        echo "docs"
        return 0
    fi
    # Doc serve patterns
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +(run +)?(docs|doc-serve|serve-docs)\b"; then
        echo "docs"
        return 0
    fi
    return 1
}

detect_proxy_tools() {
    local args="$1"
    # Proxy and tunnel tools
    if echo "${args}" | grep -qE "\b(browser-sync|proxy-server|ngrok|lt --port)\b"; then
        echo "proxy"
        return 0
    fi
    return 1
}

detect_monitoring_tools() {
    local args="$1"
    # Monitoring and metrics
    if echo "${args}" | grep -qE "\b(prometheus|grafana|jaeger)\b"; then
        echo "monitoring"
        return 0
    fi
    return 1
}

detect_auth_tools() {
    local args="$1"
    # Authentication services
    if echo "${args}" | grep -qE "\b(firebase.*auth|keycloak|oauth2-proxy|supabase)\b"; then
        echo "auth"
        return 0
    fi
    return 1
}

detect_build_tools() {
    local args="$1"
    # Build tools with servers
    if echo "${args}" | grep -qE "\b(rollup.*-w|esbuild.*--serve|turbo dev)\b"; then
        echo "build"
        return 0
    fi
    return 1
}

# Main tool detection function
detect_tool_type() {
    local args="$1"

    # Try each detection function in priority order
    local service_type

    # High priority tools (most common in development)
    if service_type=$(detect_dev_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_test_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_storybook_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_api_tools "${args}"); then echo "${service_type}"; return 0; fi

    # Medium priority tools
    if service_type=$(detect_database_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_functions_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_docs_tools "${args}"); then echo "${service_type}"; return 0; fi

    # Lower priority tools
    if service_type=$(detect_ui_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_proxy_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_monitoring_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_auth_tools "${args}"); then echo "${service_type}"; return 0; fi
    if service_type=$(detect_build_tools "${args}"); then echo "${service_type}"; return 0; fi

    # No match found
    return 1
}

# Extract existing port from command (universal patterns)
extract_existing_port() {
    local args="$1"
    local port=""

    # Try various port parameter patterns
    if echo "${args}" | grep -qE -- "--port[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*--port[= ]([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE -- "-p[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*-p[= ]([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE -- "--listen-port[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*--listen-port[= ]([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE -- "--server-port[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*--server-port[= ]([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE -- "--dev-port[= ][0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*--dev-port[= ]([0-9]+).*/\1/p')
    # Special cases for specific tools
    elif echo "${args}" | grep -qE "manage.py runserver [0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*runserver ([0-9]+).*/\1/p')
    elif echo "${args}" | grep -qE "serve.*[0-9]+"; then
        port=$(echo "${args}" | sed -nE 's/.*serve.*?([0-9]+).*/\1/p')
    fi

    echo "${port}"
}

# Generate service name based on tool type and command
generate_service_name() {
    local service_type="$1"
    local args="$2"

    case "${service_type}" in
        "dev")
            if echo "${args}" | grep -q "react"; then echo "react-dev"
            elif echo "${args}" | grep -q "next"; then echo "nextjs-dev"
            elif echo "${args}" | grep -q "vite"; then echo "vite-dev"
            elif echo "${args}" | grep -q "angular\|ng serve"; then echo "angular-dev"
            elif echo "${args}" | grep -q "vue"; then echo "vue-dev"
            else echo "frontend-dev"; fi
            ;;
        "api")
            if echo "${args}" | grep -q "fastapi\|uvicorn"; then echo "fastapi-server"
            elif echo "${args}" | grep -q "django"; then echo "django-server"
            elif echo "${args}" | grep -q "flask"; then echo "flask-server"
            elif echo "${args}" | grep -q "express\|node"; then echo "express-server"
            else echo "api-server"; fi
            ;;
        "test")
            if echo "${args}" | grep -q "cypress"; then echo "cypress-e2e"
            elif echo "${args}" | grep -q "playwright"; then echo "playwright-e2e"
            elif echo "${args}" | grep -q "jest"; then echo "jest-tests"
            elif echo "${args}" | grep -q "vitest"; then echo "vitest-tests"
            else echo "test-runner"; fi
            ;;
        "storybook")
            echo "component-dev"
            ;;
        *)
            echo "${service_type}-service"
            ;;
    esac
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
    local service_type="$1"
    local service_name="$2"
    local preferred_port="$3"
    local instance_id="$4"
    local project_path="${CLAUDE_PROJECT_DIR:-$(pwd)}"
    local auth_token
    auth_token=$(get_auth_token)

    local payload
    if [[ -n "${preferred_port}" ]]; then
        payload=$(cat <<EOF
{
  "service_type": "${service_type}",
  "service_name": "${service_name}",
  "preferred_port": ${preferred_port},
  "instance_id": "${instance_id}",
  "project_path": "${project_path}"
}
EOF
)
    else
        payload=$(cat <<EOF
{
  "service_type": "${service_type}",
  "service_name": "${service_name}",
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
                log "Allocated port ${allocated_port} for ${service_type} service (${service_name}) - lock: ${lock_id}"
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

# Modify command with allocated port (universal approach)
modify_command_with_port() {
    local original_args="$1"
    local new_port="$2"
    local service_type="$3"

    # Remove existing port arguments (various patterns)
    local modified_args
    modified_args=$(echo "${original_args}" | \
        sed -E 's/--port[= ][0-9]+//g' | \
        sed -E 's/-p[= ][0-9]+//g' | \
        sed -E 's/--listen-port[= ][0-9]+//g' | \
        sed -E 's/--server-port[= ][0-9]+//g' | \
        sed -E 's/--dev-port[= ][0-9]+//g')

    # Add appropriate port argument based on tool type
    case "${service_type}" in
        "dev")
            if echo "${original_args}" | grep -q "next"; then
                modified_args="${modified_args} -p ${new_port}"
            elif echo "${original_args}" | grep -q "ng serve"; then
                modified_args="${modified_args} --port ${new_port}"
            elif echo "${original_args}" | grep -q "django.*runserver"; then
                modified_args="${modified_args} ${new_port}"
            else
                modified_args="${modified_args} --port ${new_port}"
            fi
            ;;
        "api")
            if echo "${original_args}" | grep -q "uvicorn"; then
                modified_args="${modified_args} --port ${new_port}"
            elif echo "${original_args}" | grep -q "django.*runserver"; then
                modified_args="${modified_args} ${new_port}"
            else
                modified_args="${modified_args} --port ${new_port}"
            fi
            ;;
        *)
            modified_args="${modified_args} --port ${new_port}"
            ;;
    esac

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
    log "Universal intercepting tool use: ${TOOL_NAME} with args: ${TOOL_ARGS}"

    # Detect tool type
    local service_type
    if ! service_type=$(detect_tool_type "${TOOL_ARGS}"); then
        log "No port-using tool detected, allowing execution"
        create_hook_output "allow" "No port-using development tool detected" ""
        return 0
    fi

    log "Detected ${service_type} tool, attempting port allocation"

    # Get instance ID and generate service name
    local instance_id
    instance_id=$(get_instance_id)
    local service_name
    service_name=$(generate_service_name "${service_type}" "${TOOL_ARGS}")

    # Extract any existing port specification
    local existing_port
    existing_port=$(extract_existing_port "${TOOL_ARGS}")

    # Allocate port from Styxy
    local allocation_result
    if allocation_result=$(allocate_port "${service_type}" "${service_name}" "${existing_port}" "${instance_id}"); then
        local allocated_port="${allocation_result%%:*}"
        local lock_id="${allocation_result##*:}"

        # Modify command with allocated port
        local modified_command
        modified_command=$(modify_command_with_port "${TOOL_ARGS}" "${allocated_port}" "${service_type}")

        log "Successfully modified ${service_type} command with port ${allocated_port}"
        create_hook_output "allow" "Port ${allocated_port} allocated via Styxy for ${service_type} service (lock: ${lock_id})" "${modified_command}"

        # Store lock ID for potential cleanup
        echo "${lock_id}" >> "${HOME}/.claude/styxy-active-locks"

    else
        log "Failed to allocate port, allowing original command"
        create_hook_output "allow" "Styxy allocation failed, using original command" ""
    fi
}

# Execute main function
main "$@"