#!/bin/bash
#
# Styxy Hooks Test Suite
# Comprehensive testing for Claude Code + Styxy integration
#

set -euo pipefail

# Configuration
STYXY_URL="${STYXY_URL:-http://localhost:9876}"
TEST_LOG_DIR="${HOME}/.claude/logs"
TEST_LOG_FILE="${TEST_LOG_DIR}/styxy-hooks-test.log"
SESSION_START_SCRIPT="${HOME}/scripts/styxy-hooks/session-start.sh"
CYPRESS_INTERCEPT_SCRIPT="${HOME}/scripts/styxy-hooks/cypress-intercept.sh"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Ensure test log directory exists
mkdir -p "${TEST_LOG_DIR}"

# Logging function
log_test() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [TEST] $*" | tee -a "${TEST_LOG_FILE}"
}

# Test result functions
test_pass() {
    ((TESTS_PASSED++))
    echo -e "${GREEN}✅ PASS${NC}: $1"
    log_test "PASS: $1"
}

test_fail() {
    ((TESTS_FAILED++))
    echo -e "${RED}❌ FAIL${NC}: $1"
    log_test "FAIL: $1"
    if [[ -n "${2:-}" ]]; then
        echo -e "${RED}   Error: ${2}${NC}"
        log_test "   Error: $2"
    fi
}

test_start() {
    ((TESTS_RUN++))
    echo -e "${BLUE}🔄 TEST ${TESTS_RUN}${NC}: $1"
    log_test "Starting test: $1"
}

# Utility functions
check_styxy_daemon() {
    if curl -s --max-time 3 "${STYXY_URL}/status" >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

cleanup_test_allocations() {
    # Clean up any test allocations
    local allocations
    if allocations=$(curl -s "${STYXY_URL}/allocations" 2>/dev/null); then
        echo "$allocations" | grep -o '"lock_id":"[^"]*"' | cut -d'"' -f4 | while read -r lock_id; do
            if [[ -n "$lock_id" ]]; then
                curl -s -X DELETE "${STYXY_URL}/allocate/${lock_id}" >/dev/null 2>&1 || true
            fi
        done
    fi
}

# Test functions
test_prerequisites() {
    test_start "Prerequisites Check"

    local errors=()

    # Check if Styxy daemon is running
    if ! check_styxy_daemon; then
        errors+=("Styxy daemon not running at ${STYXY_URL}")
    fi

    # Check if hook scripts exist and are executable
    if [[ ! -x "$SESSION_START_SCRIPT" ]]; then
        errors+=("SessionStart script not executable: $SESSION_START_SCRIPT")
    fi

    if [[ ! -x "$CYPRESS_INTERCEPT_SCRIPT" ]]; then
        errors+=("Cypress intercept script not executable: $CYPRESS_INTERCEPT_SCRIPT")
    fi

    # Check Claude Code settings
    local settings_file="${HOME}/.claude/settings.local.json"
    if [[ ! -f "$settings_file" ]]; then
        errors+=("Claude Code settings file not found: $settings_file")
    elif ! grep -q "styxy-hooks" "$settings_file"; then
        errors+=("Styxy hooks not configured in Claude Code settings")
    fi

    if [[ ${#errors[@]} -eq 0 ]]; then
        test_pass "All prerequisites met"
        return 0
    else
        test_fail "Prerequisites not met" "$(printf '%s\n' "${errors[@]}")"
        return 1
    fi
}

test_session_start_hook() {
    test_start "SessionStart Hook Functionality"

    # Remove existing instance state for clean test
    rm -f "${HOME}/.claude/styxy-instance-state"

    # Run SessionStart hook
    local output
    if output=$("$SESSION_START_SCRIPT" 2>&1); then
        # Check if instance ID was created
        if [[ -f "${HOME}/.claude/styxy-instance-state" ]]; then
            local instance_id
            instance_id=$(cat "${HOME}/.claude/styxy-instance-state")

            # Verify instance is registered with Styxy
            local instances
            if instances=$(curl -s "${STYXY_URL}/instance/list" 2>/dev/null); then
                if echo "$instances" | grep -q "$instance_id"; then
                    test_pass "SessionStart hook registered instance: $instance_id"
                    return 0
                else
                    test_fail "Instance not found in Styxy registry" "$instance_id"
                    return 1
                fi
            else
                test_fail "Could not retrieve instance list from Styxy"
                return 1
            fi
        else
            test_fail "Instance state file not created"
            return 1
        fi
    else
        test_fail "SessionStart hook execution failed" "$output"
        return 1
    fi
}

test_cypress_command_detection() {
    test_start "Cypress Command Detection"

    local test_commands=(
        "cypress run"
        "cypress open"
        "cypress run --spec tests/example.spec.js"
        "npx cypress run"
        "npm run cypress:run"
    )

    local non_cypress_commands=(
        "npm test"
        "jest"
        "npm run build"
        "node index.js"
    )

    local all_passed=true

    # Test Cypress command detection
    for cmd in "${test_commands[@]}"; do
        local output
        if output=$(echo "$cmd" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "$cmd" 2>&1); then
            if echo "$output" | grep -q 'permissionDecision.*allow' &&
               echo "$output" | grep -q "allocated via Styxy"; then
                echo "  ✅ Detected: $cmd"
            else
                echo "  ❌ Failed to detect: $cmd"
                echo "    Output: $output"
                all_passed=false
            fi
        else
            echo "  ❌ Error processing: $cmd"
            all_passed=false
        fi
    done

    # Test non-Cypress command passthrough
    for cmd in "${non_cypress_commands[@]}"; do
        local output
        if output=$(echo "$cmd" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "$cmd" 2>&1); then
            if echo "$output" | grep -q "Not a Cypress command"; then
                echo "  ✅ Passed through: $cmd"
            else
                echo "  ❌ Incorrectly detected: $cmd"
                all_passed=false
            fi
        else
            echo "  ❌ Error processing: $cmd"
            all_passed=false
        fi
    done

    if $all_passed; then
        test_pass "Cypress command detection working correctly"
        return 0
    else
        test_fail "Cypress command detection has issues"
        return 1
    fi
}

test_port_allocation() {
    test_start "Port Allocation and Command Modification"

    local test_command="cypress run --spec tests/integration/auth.spec.js"
    local output

    if output=$(echo "$test_command" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "$test_command" 2>&1); then
        # Parse JSON output
        if echo "$output" | grep -q 'permissionDecision.*allow'; then
            # Extract allocated port from the response
            local modified_command
            modified_command=$(echo "$output" | grep -o '"modifiedCommand": *"[^"]*"' | cut -d'"' -f4)

            if [[ -n "$modified_command" ]] && echo "$modified_command" | grep -q -- "--port [0-9]*"; then
                local allocated_port
                allocated_port=$(echo "$modified_command" | grep -o -- "--port [0-9]*" | grep -o "[0-9]*")

                if [[ $allocated_port -ge 9200 && $allocated_port -le 9299 ]]; then
                    test_pass "Port allocation successful: $allocated_port (command: $modified_command)"
                    return 0
                else
                    test_fail "Port outside expected range" "Port: $allocated_port (expected: 9200-9299)"
                    return 1
                fi
            else
                test_fail "Command not properly modified" "Modified: $modified_command"
                return 1
            fi
        else
            test_fail "Hook did not return success" "$output"
            return 1
        fi
    else
        test_fail "Cypress intercept script execution failed" "$output"
        return 1
    fi
}

test_existing_port_handling() {
    test_start "Existing Port Specification Handling"

    local test_command="cypress run --port 8888 --spec tests/example.spec.js"
    local output

    if output=$(echo "$test_command" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "$test_command" 2>&1); then
        local modified_command
        modified_command=$(echo "$output" | grep -o '"modifiedCommand": *"[^"]*"' | cut -d'"' -f4)

        if echo "$modified_command" | grep -q -- "--port 8888"; then
            test_pass "Existing port specification preserved: 8888"
            return 0
        else
            test_fail "Existing port not preserved" "Modified: $modified_command"
            return 1
        fi
    else
        test_fail "Port handling test failed" "$output"
        return 1
    fi
}

test_styxy_integration() {
    test_start "Styxy Integration Verification"

    # Get initial allocation count
    local initial_allocations
    initial_allocations=$(curl -s "${STYXY_URL}/allocations" | grep -o '"port":[0-9]*' | wc -l)

    # Trigger a Cypress allocation
    local output
    output=$(echo "cypress run" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "cypress run" 2>&1)

    # Get new allocation count
    local new_allocations
    new_allocations=$(curl -s "${STYXY_URL}/allocations" | grep -o '"port":[0-9]*' | wc -l)

    if [[ $new_allocations -gt $initial_allocations ]]; then
        # Verify the allocation appears in Styxy
        local allocations_response
        allocations_response=$(curl -s "${STYXY_URL}/allocations")

        if echo "$allocations_response" | grep -q "cypress-e2e"; then
            test_pass "Allocation tracked in Styxy daemon"
            return 0
        else
            test_fail "Allocation not found in Styxy" "$allocations_response"
            return 1
        fi
    else
        test_fail "No new allocation created" "Before: $initial_allocations, After: $new_allocations"
        return 1
    fi
}

test_error_handling() {
    test_start "Error Handling and Fallback"

    # Test with Styxy daemon stopped
    local styxy_was_running=false
    if check_styxy_daemon; then
        styxy_was_running=true
        echo "  Temporarily stopping Styxy daemon for error test..."
        # Don't actually stop daemon in test - simulate by using wrong URL
        STYXY_URL_BACKUP="$STYXY_URL"
        export STYXY_URL="http://localhost:9999"  # Non-existent port
    fi

    local output
    if output=$(echo "cypress run" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "cypress run" 2>&1); then
        if echo "$output" | grep -q "Styxy allocation failed, using original command"; then
            test_pass "Graceful fallback when Styxy unavailable"
        else
            test_fail "Did not handle Styxy unavailability gracefully" "$output"
        fi
    else
        test_fail "Script failed when Styxy unavailable" "$output"
    fi

    # Restore Styxy URL
    if [[ -n "${STYXY_URL_BACKUP:-}" ]]; then
        export STYXY_URL="$STYXY_URL_BACKUP"
    fi
}

test_performance() {
    test_start "Performance Testing"

    local start_time end_time
    start_time=$(date +%s)

    # Run multiple allocations to test performance
    for i in {1..3}; do
        echo "cypress run --spec test${i}.spec.js" | "$CYPRESS_INTERCEPT_SCRIPT" "Bash" "cypress run --spec test${i}.spec.js" >/dev/null 2>&1
    done

    end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Check if duration is reasonable (< 10 seconds for 3 allocations)
    if [[ $duration -lt 10 ]]; then
        test_pass "Performance acceptable: ${duration}s for 3 allocations"
        return 0
    else
        test_fail "Performance too slow" "${duration}s for 3 allocations"
        return 1
    fi
}

# Main test execution
main() {
    echo -e "${BLUE}🚀 Starting Styxy Hooks Test Suite${NC}"
    echo "=========================================="
    log_test "Test suite started"

    # Run all tests
    test_prerequisites || exit 1
    test_session_start_hook
    test_cypress_command_detection
    test_port_allocation
    test_existing_port_handling
    test_styxy_integration
    test_error_handling
    test_performance

    # Cleanup
    echo -e "\n${YELLOW}🧹 Cleaning up test allocations...${NC}"
    cleanup_test_allocations

    # Summary
    echo -e "\n${BLUE}📊 Test Results${NC}"
    echo "==============================="
    echo -e "Tests Run:    ${BLUE}${TESTS_RUN}${NC}"
    echo -e "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
    echo -e "Tests Failed: ${RED}${TESTS_FAILED}${NC}"

    if [[ $TESTS_FAILED -eq 0 ]]; then
        echo -e "\n${GREEN}🎉 All tests passed!${NC}"
        log_test "All tests passed (${TESTS_PASSED}/${TESTS_RUN})"
        exit 0
    else
        echo -e "\n${RED}💥 Some tests failed!${NC}"
        log_test "Test failures: ${TESTS_FAILED}/${TESTS_RUN} failed"
        exit 1
    fi
}

# Run tests
main "$@"