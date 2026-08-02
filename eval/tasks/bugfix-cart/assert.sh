#!/bin/bash
# bugfix-cart 断言：测试全部通过，且测试文件未被改动
set -e

npm test > /dev/null 2>&1 || { echo "npm test 未全部通过"; exit 1; }

EXPECTED="e7bb2a2d10c89088b4ef42184da5ed0c7b407df2f757470e3f68695895e4c54c"
ACTUAL=$(shasum -a 256 cart.test.mjs | cut -d' ' -f1)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "cart.test.mjs 被改动（违反只改实现的约束）"; exit 1; }

echo "bugfix-cart OK"
