#!/bin/bash
# feature-coupon 断言：新功能存在且有测试、全部测试通过、既有测试文件未被改动
set -e

grep -q "applyCoupon" cart.mjs || { echo "cart.mjs 中没有 applyCoupon"; exit 1; }
[ -f coupon.test.mjs ] || { echo "coupon.test.mjs 不存在"; exit 1; }

npm test > /dev/null 2>&1 || { echo "npm test 未全部通过"; exit 1; }

EXPECTED="e7bb2a2d10c89088b4ef42184da5ed0c7b407df2f757470e3f68695895e4c54c"
ACTUAL=$(shasum -a 256 cart.test.mjs | cut -d' ' -f1)
[ "$ACTUAL" = "$EXPECTED" ] || { echo "cart.test.mjs 被改动（违反约束）"; exit 1; }

# 行为抽查：SAVE10 打折、未知 code 原价
RESULT=$(node -e "import('./cart.mjs').then(m => console.log(m.applyCoupon(200, 'SAVE10'), m.applyCoupon(200, 'NOPE')))")
[ "$RESULT" = "180 200" ] || { echo "applyCoupon 行为不正确: $RESULT"; exit 1; }

echo "feature-coupon OK"
