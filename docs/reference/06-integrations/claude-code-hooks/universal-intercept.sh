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
    # Python HTTP servers (SimpleHTTPServer, http.server)
    if echo "${args}" | grep -qE "\bpython[0-9]?\b.*\b(-m *(SimpleHTTPServer|http\.server)|SimpleHTTPServer|http\.server)\b"; then
        echo "api"
        return 0
    fi
    # Common backend start patterns
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +(run +)?(server|backend|api)\b"; then
        echo "api"
        return 0
    fi
    # Generic npm run patterns that likely start servers (demo, start, serve, etc.)
    if echo "${args}" | grep -qE "\b(npm|yarn|pnpm) +run +(demo|start|serve|launch|run)\b"; then
        echo "api"
        return 0
    fi
    # Alternative package managers (bun, deno)
    if echo "${args}" | grep -qE "\b(bun|deno)\s+(run|task)\s+(dev|start|serve|demo|launch)\b"; then
        echo "api"
        return 0
    fi
    # npx/pnpx/bunx static servers
    if echo "${args}" | grep -qE "\b(npx|pnpx|bunx)\s+(http-server|serve|live-server|json-server)\b"; then
        echo "api"
        return 0
    fi
    # Direct static file servers
    if echo "${args}" | grep -qE "\b(serve|live-server)\s+(dist|build|public|out|\.|[a-zA-Z0-9_-]+)"; then
        echo "api"
        return 0
    fi
    # PHP Laravel
    if echo "${args}" | grep -qE "\bphp\s+artisan\s+serve\b"; then
        echo "api"
        return 0
    fi
    # Ruby on Rails
    if echo "${args}" | grep -qE "\b(rails|bundle exec rails)\s+(server|s)\b"; then
        echo "api"
        return 0
    fi
    # Direct executable servers (./server, bin/server, etc.)
    if echo "${args}" | grep -qE "\b(\./)?(bin/)?(server|backend|api)(\s|$)"; then
        echo "api"
        return 0
    fi
    # Docker containers with port mapping
    if echo "${args}" | grep -qE "\b(docker|podman)\s+(run|start).*(-p|--publish)"; then
        echo "api"
        return 0
    fi
    # Docker Compose
    if echo "${args}" | grep -qE "\b(docker-compose|docker compose)\s+(up|start)\b"; then
        echo "api"
        return 0
    fi
    # Monorepo tools (nx, turbo, lerna)
    if echo "${args}" | grep -qE "\b(nx|turbo)\s+(serve|run)\b"; then
        echo "api"
        return 0
    fi
    if echo "${args}" | grep -qE "\blerna\s+run\s+(dev|start|serve)\b"; then
        echo "api"
        return 0
    fi
    # Static site generators - Jekyll
    if echo "${args}" | grep -qE "\b(jekyll|bundle exec jekyll)\s+serve\b"; then
        echo "api"
        return 0
    fi
    # Static site generators - Hugo
    if echo "${args}" | grep -qE "\bhugo\s+(server|serve)\b"; then
        echo "api"
        return 0
    fi
    # Elm reactor
    if echo "${args}" | grep -qE "\belm\s+reactor\b"; then
        echo "api"
        return 0
    fi
    # Parcel bundler (auto-starts dev server)
    if echo "${args}" | grep -qE "\bparcel\s+(index\.html|src/|dist/|\.|\S+\.html)"; then
        echo "api"
        return 0
    fi
    # Django management command
    if echo "${args}" | grep -qE "\bpython[0-9]?\s+manage\.py\s+runserver\b"; then
        echo "api"
        return 0
    fi
    # Mobile dev - Expo
    if echo "${args}" | grep -qE "\bexpo\s+start\b"; then
        echo "api"
        return 0
    fi
    # Mobile dev - React Native
    if echo "${args}" | grep -qE "\breact-native\s+start\b"; then
        echo "api"
        return 0
    fi
    # Mobile dev - Metro bundler
    if echo "${args}" | grep -qE "\bmetro\s+start\b"; then
        echo "api"
        return 0
    fi
    # CMS - Strapi
    if echo "${args}" | grep -qE "\bstrapi\s+(develop|start)\b"; then
        echo "api"
        return 0
    fi
    # CMS - Sanity
    if echo "${args}" | grep -qE "\bsanity\s+start\b"; then
        echo "api"
        return 0
    fi
    # CMS - Keystone
    if echo "${args}" | grep -qE "\bkeystone\s+dev\b"; then
        echo "api"
        return 0
    fi
    # CMS - Ghost
    if echo "${args}" | grep -qE "\bghost\s+start\b"; then
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
    # MongoDB with port flag
    if echo "${args}" | grep -qE "\bmongod\b.*--port"; then
        echo "database"
        return 0
    fi
    # PostgreSQL variations
    if echo "${args}" | grep -qE "\b(postgres|postgresql)\b.*(-p|--port)"; then
        echo "database"
        return 0
    fi
    # MySQL variations
    if echo "${args}" | grep -qE "\b(mysql|mysqld)\b"; then
        echo "database"
        return 0
    fi
    # Redis
    if echo "${args}" | grep -qE "\bredis-server\b"; then
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
    # Ngrok (tunnel tool)
    if echo "${args}" | grep -qE "\bngrok\s+(http|tcp|tls)\s+[0-9]+"; then
        echo "proxy"
        return 0
    fi
    # Localtunnel
    if echo "${args}" | grep -qE "\blt\s+--port\s+[0-9]+"; then
        echo "proxy"
        return 0
    fi
    # Cloudflare tunnel
    if echo "${args}" | grep -qE "\bcloudflared\s+tunnel\b"; then
        echo "proxy"
        return 0
    fi
    # Tailscale serve
    if echo "${args}" | grep -qE "\btailscale\s+serve\b"; then
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

# LAYER 2: package.json Parsing
# Analyzes npm/yarn/pnpm scripts by reading package.json
analyze_npm_script_from_package_json() {
    local full_command="$1"

    # Extract script name from npm/yarn/pnpm command
    local script_name
    script_name=$(echo "$full_command" | sed -nE 's/.*(npm|yarn|pnpm) +run +([a-zA-Z0-9:_-]+).*/\2/p')

    if [[ -z "$script_name" ]]; then
        return 1
    fi

    log "Layer 2: Analyzing npm script '$script_name' via package.json"

    # Find package.json (try current dir, then parent dirs)
    local package_json=""
    local search_dir="${PWD}"

    # Try up to 3 parent directories
    for i in {1..3}; do
        if [[ -f "${search_dir}/package.json" ]]; then
            package_json="${search_dir}/package.json"
            break
        fi
        search_dir=$(dirname "$search_dir")
    done

    if [[ -z "$package_json" ]]; then
        log "Layer 2: No package.json found, skipping parsing"
        return 1
    fi

    # Check if jq is available
    if ! command -v jq &> /dev/null; then
        log "Layer 2: jq not available, skipping parsing"
        return 1
    fi

    # Extract script command from package.json
    local script_command
    script_command=$(jq -r ".scripts[\"${script_name}\"] // empty" "$package_json" 2>/dev/null)

    if [[ -z "$script_command" ]]; then
        log "Layer 2: Script '$script_name' not found in package.json"
        return 1
    fi

    log "Layer 2: Script '$script_name' expands to: $script_command"

    # Recursively detect on the EXPANDED command
    local service_type
    if service_type=$(detect_tool_type "$script_command"); then
        log "Layer 2: Detected service type: $service_type"
        echo "$service_type"
        return 0
    fi

    log "Layer 2: No service type detected in expanded command"
    return 1
}

# Extract port number from command string
extract_port_from_command() {
    local command="$1"
    local port=""

    # Try various port parameter patterns
    # --port 8000, --port=8000, -p 8000, -p=8000
    if echo "$command" | grep -qE -- "--(port|server-port|dev-port)[= ][0-9]+"; then
        port=$(echo "$command" | sed -nE 's/.*--(port|server-port|dev-port)[= ]([0-9]+).*/\2/p' | head -1)
    elif echo "$command" | grep -qE -- "-p[= ][0-9]+"; then
        port=$(echo "$command" | sed -nE 's/.*-p[= ]([0-9]+).*/\2/p' | head -1)
    # PORT=8000 (environment variable)
    elif echo "$command" | grep -qE "PORT=[0-9]+"; then
        port=$(echo "$command" | sed -nE 's/.*PORT=([0-9]+).*/\1/p' | head -1)
    # Python http.server: python -m http.server 8000
    elif echo "$command" | grep -qE "http\.server +[0-9]+"; then
        port=$(echo "$command" | sed -nE 's/.*http\.server +([0-9]+).*/\1/p' | head -1)
    # Django runserver: python manage.py runserver 8000
    elif echo "$command" | grep -qE "runserver +[0-9]+"; then
        port=$(echo "$command" | sed -nE 's/.*runserver +([0-9]+).*/\1/p' | head -1)
    fi

    echo "$port"
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

    # LAYER 1: Try standard pattern matching (fast path)
    local service_type
    if service_type=$(detect_tool_type "${TOOL_ARGS}"); then
        log "Layer 1: Detected ${service_type} tool via pattern matching"
    else
        # LAYER 2: If Layer 1 failed and this is an npm/yarn/pnpm command, try package.json parsing
        if echo "${TOOL_ARGS}" | grep -qE "\b(npm|yarn|pnpm) +run\b"; then
            log "Layer 1: No match found, attempting Layer 2 (package.json parsing)"
            if service_type=$(analyze_npm_script_from_package_json "${TOOL_ARGS}"); then
                log "Layer 2: Successfully detected ${service_type} tool via package.json parsing"
            else
                log "Layer 2: No port-using tool detected, allowing execution"
                create_hook_output "allow" "No port-using development tool detected (checked both pattern matching and package.json)" ""
                return 0
            fi
        else
            log "No port-using tool detected, allowing execution"
            create_hook_output "allow" "No port-using development tool detected" ""
            return 0
        fi
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

    # If no port found and we used Layer 2, try extracting from expanded command
    if [[ -z "$existing_port" ]] && echo "${TOOL_ARGS}" | grep -qE "\b(npm|yarn|pnpm) +run\b"; then
        local script_name
        script_name=$(echo "${TOOL_ARGS}" | sed -nE 's/.*(npm|yarn|pnpm) +run +([a-zA-Z0-9:_-]+).*/\2/p')
        if [[ -n "$script_name" ]]; then
            local package_json="${PWD}/package.json"
            if [[ -f "$package_json" ]] && command -v jq &> /dev/null; then
                local script_command
                script_command=$(jq -r ".scripts[\"${script_name}\"] // empty" "$package_json" 2>/dev/null)
                if [[ -n "$script_command" ]]; then
                    existing_port=$(extract_port_from_command "$script_command")
                    if [[ -n "$existing_port" ]]; then
                        log "Layer 2: Extracted port $existing_port from expanded command"
                    fi
                fi
            fi
        fi
    fi

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