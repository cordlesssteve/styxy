#!/bin/bash

echo "Testing port allocation logic..."

test_command="cypress run --spec tests/integration/auth.spec.js"
echo "Command: $test_command"

echo "Running hook..."
output=$(echo "$test_command" | ~/scripts/styxy-hooks/cypress-intercept.sh "Bash" "$test_command" 2>&1)

echo "Raw output:"
echo "$output"
echo ""

echo "Checking permissionDecision..."
if echo "$output" | grep -q 'permissionDecision.*allow'; then
    echo "✅ Found permission decision"
else
    echo "❌ No permission decision"
fi

echo "Extracting modified command..."
modified_command=$(echo "$output" | grep -o '"modifiedCommand": *"[^"]*"' | cut -d'"' -f4)
echo "Modified command: '$modified_command'"

echo "Checking for port..."
if echo "$modified_command" | grep -q -- "--port [0-9]*"; then
    echo "✅ Found port argument"
    allocated_port=$(echo "$modified_command" | grep -o -- "--port [0-9]*" | grep -o "[0-9]*")
    echo "Allocated port: $allocated_port"

    if [[ $allocated_port -ge 9200 && $allocated_port -le 9299 ]]; then
        echo "✅ Port in expected range"
    else
        echo "❌ Port outside range: $allocated_port"
    fi
else
    echo "❌ No port argument found"
fi