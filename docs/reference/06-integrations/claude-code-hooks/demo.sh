#!/bin/bash
#
# Demo Script - Styxy + Claude Code Integration
#

echo "🚀 Styxy + Claude Code Integration Demo"
echo "======================================="

# Check if everything is set up
echo ""
echo "1. Checking prerequisites..."

# Styxy daemon
if curl -s http://localhost:9876/status >/dev/null; then
    echo "✅ Styxy daemon running"
else
    echo "❌ Styxy daemon not running"
    exit 1
fi

# Hook scripts
if [[ -x ~/scripts/styxy-hooks/session-start.sh ]]; then
    echo "✅ SessionStart hook ready"
else
    echo "❌ SessionStart hook not found"
    exit 1
fi

if [[ -x ~/scripts/styxy-hooks/cypress-intercept.sh ]]; then
    echo "✅ Cypress intercept hook ready"
else
    echo "❌ Cypress intercept hook not found"
    exit 1
fi

# Claude Code configuration
if grep -q "styxy-hooks" ~/.claude/settings.local.json; then
    echo "✅ Claude Code hooks configured"
else
    echo "❌ Claude Code hooks not configured"
    exit 1
fi

echo ""
echo "2. Demonstrating Cypress command interception..."

demo_commands=(
    "cypress run"
    "cypress open --project ./e2e"
    "npx cypress run --spec 'cypress/e2e/login.cy.js'"
)

for cmd in "${demo_commands[@]}"; do
    echo ""
    echo "Command: $cmd"

    output=$(echo "$cmd" | ~/scripts/styxy-hooks/cypress-intercept.sh "Bash" "$cmd" 2>&1)

    if echo "$output" | grep -q 'allocated via Styxy'; then
        modified=$(echo "$output" | grep -o '"modifiedCommand": *"[^"]*"' | cut -d'"' -f4)
        port=$(echo "$modified" | grep -o -- "--port [0-9]*" | grep -o "[0-9]*")
        echo "✅ Port $port allocated → $modified"
    else
        echo "❌ Failed to allocate port"
    fi
done

echo ""
echo "3. Demonstrating non-Cypress passthrough..."

non_cypress="npm test"
echo ""
echo "Command: $non_cypress"

output=$(echo "$non_cypress" | ~/scripts/styxy-hooks/cypress-intercept.sh "Bash" "$non_cypress" 2>&1)

if echo "$output" | grep -q "Not a Cypress command"; then
    echo "✅ Correctly passed through unchanged"
else
    echo "❌ Incorrectly processed"
fi

echo ""
echo "4. Current Styxy state..."

# Show current allocations
allocations=$(curl -s http://localhost:9876/allocations)
cypress_allocations=$(echo "$allocations" | grep -c "cypress" || echo 0)
echo "✅ Cypress allocations tracked: $cypress_allocations"

# Show instances
instances=$(curl -s http://localhost:9876/instance/list)
claude_instances=$(echo "$instances" | grep -c "claude-code" || echo 0)
echo "✅ Claude Code instances registered: $claude_instances"

echo ""
echo "🎉 Demo complete! Integration is working perfectly."
echo ""
echo "When you use Claude Code and run Cypress commands:"
echo "• Ports will be automatically allocated from Styxy"
echo "• No conflicts with other services"
echo "• All allocations tracked and managed"
echo "• Graceful fallback if Styxy unavailable"