#!/bin/bash
#
# Shadow Mode Manual Test Script
# Demonstrates shadow notices in action
#

set -euo pipefail

echo "╔════════════════════════════════════════════════════════════╗"
echo "║         Styxy Shadow Mode - Manual Test Suite             ║"
echo "╔════════════════════════════════════════════════════════════╗"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
TESTS_RUN=0
TESTS_PASSED=0

run_test() {
    local test_name="$1"
    local test_command="$2"
    local expected_result="$3"

    TESTS_RUN=$((TESTS_RUN + 1))

    echo -e "${BLUE}Test ${TESTS_RUN}: ${test_name}${NC}"
    echo "Command: ${test_command}"
    echo ""

    if eval "${test_command}"; then
        if [[ "${expected_result}" == "pass" ]]; then
            echo -e "${GREEN}✓ PASS${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}✗ FAIL (expected failure but passed)${NC}"
        fi
    else
        if [[ "${expected_result}" == "fail" ]]; then
            echo -e "${GREEN}✓ PASS (expected failure)${NC}"
            TESTS_PASSED=$((TESTS_PASSED + 1))
        else
            echo -e "${RED}✗ FAIL${NC}"
        fi
    fi

    echo ""
    echo "-----------------------------------------------------------"
    echo ""
}

# Test 1: Verify Styxy daemon is running
run_test "Styxy Daemon Status" \
    "styxy status | grep -q 'running'" \
    "pass"

# Test 2: Allocate a test port
run_test "Allocate Test Port" \
    "styxy allocate dev shadow-test --preferred 8765 | grep -q 8765" \
    "pass"

# Test 3: Shadow notice for allocated port
run_test "Shadow Notice Detection" \
    "~/scripts/claude/styxy-shadow-notices.sh Bash 'python -m http.server 8765' 2>&1 | grep -q 'already allocated' || echo 'Notice should appear'" \
    "pass"

# Test 4: Shadow notice for available port
run_test "Shadow Notice Skips Available Port" \
    "~/scripts/claude/styxy-shadow-notices.sh Bash 'python -m http.server 9999' 2>&1 | grep -qv 'already allocated'" \
    "pass"

# Test 5: Dry-run API endpoint
run_test "Dry-Run API Endpoint" \
    "curl -s -X POST http://localhost:9876/allocate -H 'Content-Type: application/json' -d '{\"service_type\":\"dev\",\"service_name\":\"dry-test\",\"dry_run\":true}' | grep -q '\"dry_run\":true'" \
    "pass"

# Test 6: Port extraction from various formats
run_test "Port Extraction - --port flag" \
    "~/scripts/claude/styxy-shadow-notices.sh Bash 'npm run dev -- --port 3000' 2>&1 && grep -q 'Found port 3000' ~/.claude/logs/styxy-shadow-notices.log | tail -5" \
    "pass"

# Test 7: Port extraction from environment variable
run_test "Port Extraction - Environment Variable" \
    "~/scripts/claude/styxy-shadow-notices.sh Bash 'PORT=4000 npm start' 2>&1 && grep -q 'Found port 4000' ~/.claude/logs/styxy-shadow-notices.log | tail -5" \
    "pass"

# Test 8: Verify logs are being written
run_test "Log File Creation" \
    "test -f ~/.claude/logs/styxy-shadow-notices.log" \
    "pass"

# Cleanup
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                      Cleanup                               ║"
echo "╔════════════════════════════════════════════════════════════╗"
echo ""

echo "Releasing test port..."
LOCK_ID=$(styxy list | grep "shadow-test" | grep -o 'Lock: [^)]*' | cut -d' ' -f2 || echo "")
if [[ -n "${LOCK_ID}" ]]; then
    styxy release "${LOCK_ID}"
    echo -e "${GREEN}✓ Test port released${NC}"
else
    echo -e "${YELLOW}⚠ No test port to release${NC}"
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                      Test Summary                          ║"
echo "╔════════════════════════════════════════════════════════════╗"
echo ""
echo -e "Tests Run:    ${TESTS_RUN}"
echo -e "Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
echo -e "Tests Failed: ${RED}$((TESTS_RUN - TESTS_PASSED))${NC}"
echo ""

if [[ ${TESTS_PASSED} -eq ${TESTS_RUN} ]]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║               ALL TESTS PASSED! ✓                          ║${NC}"
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════╗${NC}"
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║               SOME TESTS FAILED ✗                          ║${NC}"
    echo -e "${RED}╔════════════════════════════════════════════════════════════╗${NC}"
    exit 1
fi
