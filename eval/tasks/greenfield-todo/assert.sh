#!/bin/bash
# greenfield-todo 断言：产物存在、测试通过、CLI 实际可用、持久化正确
set -e

[ -f todo.mjs ] || { echo "todo.mjs 不存在"; exit 1; }
[ -f test.mjs ] || { echo "test.mjs 不存在"; exit 1; }

node --test > /dev/null 2>&1 || { echo "node --test 未全部通过"; exit 1; }

node todo.mjs add "eval-check-item" > /dev/null
node todo.mjs list | grep -q "eval-check-item" || { echo "add/list 不工作"; exit 1; }

node todo.mjs done 1 > /dev/null
grep -q '"done": *true' todos.json || { echo "done/持久化不工作"; exit 1; }

echo "greenfield-todo OK"
