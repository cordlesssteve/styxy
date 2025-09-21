#!/bin/bash
# Comprehensive test cleanup utility for Styxy

echo "🧹 Styxy Test Cleanup Utility"
echo "=============================="

# 1. Kill any hanging test processes
echo "🔪 Killing hanging test processes..."
pkill -f "stress.*test|conflict.*test|test.*conflict|simple.*test" 2>/dev/null || true
pkill -f "port.*conflict|api.*stress" 2>/dev/null || true

# 2. Run comprehensive cleanup via API
echo "🔄 Running comprehensive API cleanup..."
cd "$(dirname "$0")/.." || exit 1

if node scripts/api-stress-test.js --comprehensive-cleanup 2>/dev/null; then
    echo "✅ API cleanup completed successfully"
else
    echo "⚠️  API cleanup had issues, trying force cleanup..."

    # 3. Fallback: Force daemon cleanup
    if ~/projects/Utility/styxy/bin/styxy cleanup --force 2>/dev/null; then
        echo "✅ Force cleanup completed"
    else
        echo "❌ Force cleanup failed, daemon may need restart"
        echo "💡 Try: ~/projects/Utility/styxy/bin/styxy daemon restart"
    fi
fi

# 4. Check final state
echo ""
echo "📊 Final Status Check:"
RUNNING_TESTS=$(ps aux | grep -E "stress|conflict|test.*js" | grep -v grep | wc -l)
echo "   Test processes running: $RUNNING_TESTS"

if command -v timeout >/dev/null 2>&1; then
    ALLOCATIONS=$(timeout 10s ~/projects/Utility/styxy/bin/styxy list 2>/dev/null | grep -E "test|stress|conflict" | wc -l || echo "?")
    echo "   Test allocations remaining: $ALLOCATIONS"
else
    echo "   Test allocations: (check manually with 'styxy list')"
fi

if [ "$RUNNING_TESTS" -eq 0 ]; then
    echo "🎉 Cleanup complete - no test processes running!"
else
    echo "⚠️  Warning: $RUNNING_TESTS test processes still running"
fi

echo ""
echo "💡 Usage for future tests:"
echo "   Run stress test: node scripts/api-stress-test.js"
echo "   Quick cleanup:   ./scripts/cleanup-tests.sh"
echo "   Manual cleanup:  node scripts/api-stress-test.js --comprehensive-cleanup"