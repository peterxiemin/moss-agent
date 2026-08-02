#!/usr/bin/env node
/**
 * 任务级评测运行器：对 eval/tasks/ 下的每个任务，
 * 在独立临时目录中复制 fixture → 用真实 API 跑 agent(-y 全自动) → 执行 assert.sh 断言。
 *
 * 用法：npm run eval [任务名过滤子串]
 * 需要仓库根目录的 .env（MOONSHOT_API_KEY 等），runner 会注入子进程环境。
 */
import { spawn } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TASKS_DIR = join(REPO, 'eval', 'tasks');
const AGENT_TIMEOUT_MS = 6 * 60 * 1000;

/** 与 src/config.ts 相同的极简 .env 解析（注入子进程环境） */
function loadEnv() {
  const env = { ...process.env };
  const path = join(REPO, '.env');
  if (!existsSync(path)) return env;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[m[1]] === undefined) env[m[1]] = value;
  }
  return env;
}

function run(cmd, args, opts, timeoutMs) {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;
    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      resolvePromise({ code, signal, out });
    });
  });
}

async function runTask(name, env) {
  const taskDir = join(TASKS_DIR, name);
  const prompt = readFileSync(join(taskDir, 'prompt.txt'), 'utf-8').trim();
  const workdir = mkdtempSync(join(tmpdir(), `moss-eval-${name}-`));
  const fixture = join(taskDir, 'fixture');
  if (existsSync(fixture)) cpSync(fixture, workdir, { recursive: true });

  const started = Date.now();
  const agent = await run(
    join(REPO, 'node_modules', '.bin', 'tsx'),
    [join(REPO, 'src', 'cli.ts'), '-y', prompt],
    { cwd: workdir, env },
    AGENT_TIMEOUT_MS,
  );
  const durationSec = ((Date.now() - started) / 1000).toFixed(0);
  writeFileSync(join(workdir, 'agent.log'), agent.out);

  if (agent.code !== 0) {
    return { name, ok: false, durationSec, workdir, reason: `agent 退出码 ${agent.code}${agent.signal ? ` (signal ${agent.signal})` : ''}` };
  }

  const assert = await run('bash', [join(taskDir, 'assert.sh')], { cwd: workdir, env });
  writeFileSync(join(workdir, 'assert.log'), assert.out);
  return {
    name,
    ok: assert.code === 0,
    durationSec,
    workdir,
    reason: assert.code === 0 ? '' : `断言失败（见 ${join(workdir, 'assert.log')}）`,
  };
}

const filter = process.argv[2];
const env = loadEnv();
if (!env.MOONSHOT_API_KEY) {
  console.error('Error: 需要 MOONSHOT_API_KEY（.env 或环境变量）');
  process.exit(1);
}

const tasks = readdirSync(TASKS_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory() && (!filter || e.name.includes(filter)))
  .map((e) => e.name)
  .sort();

if (!tasks.length) {
  console.error(`没有匹配的任务（${TASKS_DIR}）`);
  process.exit(1);
}

console.log(`moss eval · ${tasks.length} 个任务\n`);
let failed = 0;
for (const name of tasks) {
  process.stdout.write(`▶ ${name} ... `);
  const r = await runTask(name, env);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} (${r.durationSec}s)`);
  if (!r.ok) {
    failed++;
    console.log(`  ${r.reason}`);
  }
  console.log(`  工作目录: ${r.workdir}`);
}
console.log(`\n${tasks.length - failed}/${tasks.length} 通过`);
process.exit(failed ? 1 : 0);
