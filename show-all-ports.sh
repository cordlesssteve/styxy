#!/bin/bash
#
# Show All Occupied Ports - Comprehensive Port Usage Display
# Combines Styxy-managed ports with system-level port scanning
#

set -euo pipefail

STYXY_URL="${STYXY_URL:-http://localhost:9876}"
STYXY_TOKEN_FILE="${HOME}/.styxy/auth.token"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Get API token
get_auth_token() {
    if [[ -f "${STYXY_TOKEN_FILE}" ]]; then
        cat "${STYXY_TOKEN_FILE}"
    else
        echo ""
    fi
}

# Check if Styxy daemon is available
check_styxy_daemon() {
    if curl -s --max-time 5 "${STYXY_URL}/status" > /dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# Get Styxy-managed ports
get_styxy_ports() {
    local auth_token
    auth_token=$(get_auth_token)

    if [[ -n "${auth_token}" ]]; then
        curl -s -H "Authorization: Bearer ${auth_token}" "${STYXY_URL}/allocations" | \
            jq -r '.allocations[] | "\(.port):\(.service_type):\(.service_name):\(.instance_id)"' 2>/dev/null || echo ""
    fi
}

# Get system-level port usage using multiple methods
get_system_ports() {
    {
        # Try ss first (modern Linux)
        ss -tuln 2>/dev/null | awk '/LISTEN/ {gsub(/.*:/, "", $5); gsub(/].*/, "", $5); print $5}' | sort -n | uniq
    } || {
        # Fall back to netstat
        netstat -tuln 2>/dev/null | awk '/LISTEN/ {gsub(/.*:/, "", $4); print $4}' | sort -n | uniq
    } || {
        # Fall back to lsof
        lsof -i -P -n 2>/dev/null | awk '/LISTEN/ {gsub(/.*:/, "", $9); gsub(/->.*/, "", $9); print $9}' | sort -n | uniq
    }
}

# Display port range summary
show_range_summary() {
    local styxy_ports="$1"

    echo -e "${BLUE}📊 Port Range Summary (CORE Documentation Standard v2.0)${NC}"
    echo -e "${BLUE}================================================================${NC}"

    # Define CORE ranges
    declare -A ranges=(
        ["dev"]="3000-3099"
        ["monitoring"]="3100-3199"
        ["ui"]="4000-4099"
        ["docs"]="4100-4199"
        ["hub"]="4400-4499"
        ["functions"]="5000-5099"
        ["storybook"]="6006-6029"
        ["api"]="8000-8099"
        ["database"]="8080-8099"
        ["proxy"]="8100-8199"
        ["build"]="8200-8299"
        ["auth"]="9099-9199"
        ["test"]="9200-9299"
    )

    for service_type in "${!ranges[@]}"; do
        local range="${ranges[$service_type]}"
        local count
        count=$(echo "${styxy_ports}" | grep -c "^[^:]*:${service_type}:" 2>/dev/null || echo "0")

        if [[ $count -gt 0 ]]; then
            echo -e "${GREEN}✅ ${service_type}${NC}: ${range} (${GREEN}${count} active${NC})"
        else
            echo -e "${YELLOW}⚪ ${service_type}${NC}: ${range} (${YELLOW}0 active${NC})"
        fi
    done
}

# Main display function
main() {
    echo -e "${CYAN}🔍 Comprehensive Port Usage Report${NC}"
    echo -e "${CYAN}===================================${NC}"
    echo ""

    # Check Styxy daemon status
    if check_styxy_daemon; then
        echo -e "${GREEN}✅ Styxy Daemon: Running${NC}"

        # Get Styxy-managed ports
        local styxy_ports
        styxy_ports=$(get_styxy_ports)

        if [[ -n "${styxy_ports}" ]]; then
            echo ""
            echo -e "${PURPLE}📋 Styxy-Managed Ports:${NC}"
            echo -e "${PURPLE}========================${NC}"

            echo "${styxy_ports}" | while IFS=':' read -r port service_type service_name instance_id; do
                echo -e "${GREEN}${port}${NC}: ${BLUE}${service_type}${NC} - ${YELLOW}${service_name}${NC} (${CYAN}${instance_id}${NC})"
            done | sort -n

            echo ""
            show_range_summary "${styxy_ports}"
        else
            echo -e "${YELLOW}⚠️  No Styxy-managed ports found${NC}"
        fi
    else
        echo -e "${RED}❌ Styxy Daemon: Not running or unreachable${NC}"
    fi

    echo ""
    echo -e "${CYAN}🖥️  System-Level Port Usage:${NC}"
    echo -e "${CYAN}=============================${NC}"

    # Get system ports
    local system_ports
    system_ports=$(get_system_ports)

    if [[ -n "${system_ports}" ]]; then
        echo "${system_ports}" | while read -r port; do
            if [[ -n "${port}" && "${port}" =~ ^[0-9]+$ ]]; then
                # Check if this port is managed by Styxy
                if [[ -n "${styxy_ports:-}" ]] && echo "${styxy_ports}" | grep -q "^${port}:"; then
                    echo -e "${GREEN}${port}${NC}: ${BLUE}(Styxy managed)${NC}"
                else
                    echo -e "${RED}${port}${NC}: ${YELLOW}(System process)${NC}"
                fi
            fi
        done | sort -n
    else
        echo -e "${YELLOW}⚠️  Unable to detect system ports${NC}"
    fi

    echo ""
    echo -e "${CYAN}📖 CORE Documentation Standard Integration:${NC}"
    echo -e "${CYAN}===========================================${NC}"
    echo -e "• ${GREEN}Source${NC}: ~/docs/CORE/PORT_REFERENCE_GUIDE.md v2.0"
    echo -e "• ${GREEN}Service Types${NC}: 13 predefined categories"
    echo -e "• ${GREEN}Compliance${NC}: Non-overlapping ranges, sequential allocation"
    echo -e "• ${GREEN}Multi-Instance${NC}: Up to 4+ concurrent instances per service type"
}

# Execute main function
main "$@"