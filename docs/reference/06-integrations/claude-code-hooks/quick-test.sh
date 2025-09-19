#!/bin/bash

# Quick test to verify hook functionality
echo "Testing Cypress command detection..."

cmd="cypress run"
output=$(echo "$cmd" | ~/scripts/styxy-hooks/cypress-intercept.sh "Bash" "$cmd" 2>&1)

echo "Command: $cmd"
echo "Output: $output"
echo ""

if echo "$output" | grep -q 'permissionDecision.*allow'; then
    echo "✅ Permission decision: allow"
else
    echo "❌ Permission decision not found"
fi

if echo "$output" | grep -q "allocated via Styxy"; then
    echo "✅ Port allocated via Styxy"
else
    echo "❌ Styxy allocation not found"
fi

if echo "$output" | grep -q '"modifiedCommand"'; then
    echo "✅ Command modified"
    modified=$(echo "$output" | grep -o '"modifiedCommand":"[^"]*"' | cut -d'"' -f4)
    echo "   Modified to: $modified"
else
    echo "❌ Command not modified"
fi