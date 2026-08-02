/**
 * TTY 端到端测试：用 node-pty 给 CLI 分配伪终端（isTTY 为真），
 * 后端用本地桩服务器模拟 OpenAI 兼容的 SSE 流式响应，覆盖：
 *   1. 等待响应期间显示 spinner、thinking 折叠、正文正常渲染
 *   2. 执行中输入自动排队并按 FIFO 顺序执行
 *   3. Esc 中断当前任务并丢弃排队输入
 *   4. 工具调用（bash）执行期间显示 spinner（-y 跳过权限确认）
 * 通过 tsx 直接跑 src/，无需先构建 dist。
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import * as pty from 'node-pty';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 桩服务器行为：首个 delta 之前的延迟（制造静默等待期） */
const behavior = { delayMs: 500 };

function sseChunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({
    id: 'chatcmpl-stub',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'stub-model',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`;
}

/** OpenAI 兼容桩服务器：普通输入回复 pong:<最后一条 user 消息>；
 *  输入 run-sleep 时返回 bash(sleep) 工具调用，工具结果回传后回复 TOOL-DONE */
function createStubApi(): Server {
  return createServer((req, res) => {
    res.on('error', () => {});
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404);
      res.end();
      return;
    }
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      void (async () => {
        const parsed = JSON.parse(body) as {
          messages: Array<{ role: string; content?: string }>;
        };
        const last = parsed.messages[parsed.messages.length - 1];
        const lastUser = [...parsed.messages].reverse().find((m) => m.role === 'user');
        const text = String(lastUser?.content ?? '');
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        const write = (s: string) => {
          if (!res.destroyed) res.write(s);
        };
        const finish = (reason: string) => {
          write(sseChunk({}, reason));
          write('data: [DONE]\n\n');
          res.end();
        };
        await sleep(behavior.delayMs);
        if (last?.role === 'tool') {
          // 工具结果回传后的第二轮：直接给最终答复
          write(sseChunk({ content: 'TOOL-DONE' }));
          finish('stop');
          return;
        }
        if (text === 'run-sleep') {
          // 第一轮：要求调用 bash 工具（单个 delta 携带完整 arguments）
          write(
            sseChunk({
              tool_calls: [
                {
                  index: 0,
                  id: 'call_sleep',
                  function: {
                    name: 'bash',
                    arguments: JSON.stringify({ command: 'sleep 2 && echo done' }),
                  },
                },
              ],
            }),
          );
          finish('tool_calls');
          return;
        }
        write(sseChunk({ reasoning_content: 'thinking about it' }));
        await sleep(50);
        write(sseChunk({ content: `pong:${text}` }));
        finish('stop');
      })();
    });
  });
}

/** 在伪终端里启动 CLI（tsx 跑 src），并把 PTY 输出累积成可等待的文本流 */
class PtyDriver {
  private out = '';
  private term: pty.IPty;

  constructor(env: Record<string, string>) {
    this.term = pty.spawn(
      join(projectRoot, 'node_modules', '.bin', 'tsx'),
      // -y：自动批准工具调用，桩服务器的 bash 调用不需要交互确认
      [join(projectRoot, 'src', 'cli.ts'), '-y'],
      { name: 'xterm-color', cols: 120, rows: 30, cwd: env.MOSS_HOME, env },
    );
    this.term.onData((d) => (this.out += d));
  }

  text(): string {
    return this.out;
  }

  /** 剥掉 ANSI 转义序列后的文本（chalk 分段着色会把同一行拆成多段，断言用纯文本更稳） */
  plain(): string {
    return this.out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  }

  write(s: string): void {
    this.term.write(s);
  }

  async waitFor(pattern: string | RegExp, timeoutMs = 20000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const plain = this.plain();
      const hit =
        typeof pattern === 'string' ? plain.includes(pattern) : pattern.test(plain);
      if (hit) return plain;
      await sleep(50);
    }
    throw new Error(`timeout waiting for ${String(pattern)}\n--- PTY output ---\n${this.out}`);
  }

  /** 先礼后兵：发 exit 优雅退出，超时强杀 */
  async close(): Promise<void> {
    const exited = new Promise<number>((r) => this.term.onExit(({ exitCode }) => r(exitCode)));
    this.term.write('exit\n');
    const result = await Promise.race([exited, sleep(3000).then(() => -1)]);
    if (result === -1) this.term.kill();
  }
}

describe('e2e (pty)', () => {
  let server: Server;
  let port: number;
  let mossHomeDir: string;
  let driver: PtyDriver;

  beforeAll(async () => {
    server = createStubApi();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    mossHomeDir = mkdtempSync(join(tmpdir(), 'moss-e2e-'));
  }, 30000);

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    rmSync(mossHomeDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    behavior.delayMs = 500;
    driver = new PtyDriver({
      ...process.env,
      MOSS_HOME: mossHomeDir,
      MOONSHOT_API_KEY: 'stub-key',
      BASE_URL: `http://127.0.0.1:${port}/v1`,
      MODEL: 'stub-model',
      MOSS_LOG_LEVEL: 'error',
    } as Record<string, string>);
    await driver.waitFor('> ');
  }, 30000);

  afterEach(async () => {
    await driver.close();
  }, 10000);

  it(
    '等待响应时显示 spinner，thinking 折叠，正文渲染',
    async () => {
      behavior.delayMs = 1500;
      driver.write('hello\n');
      // 静默等待期出现 spinner（旋转字符 + 提示文案）
      await driver.waitFor(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/);
      expect(driver.plain()).toContain('等待模型响应');
      await driver.waitFor('pong:hello');
      // thinking 折叠：摘要出现，但推理正文不逐字输出
      expect(driver.plain()).toContain('✨ thought for');
      expect(driver.plain()).not.toContain('thinking about it');
    },
    30000,
  );

  it(
    '执行中输入自动排队，并按 FIFO 顺序执行',
    async () => {
      behavior.delayMs = 800;
      driver.write('AAA\n');
      await sleep(300); // 确保 AAA 已开始执行
      driver.write('BBB\n');
      await driver.waitFor('已排队');
      await driver.waitFor('pong:BBB');
      const out = driver.plain();
      expect(out).toContain('执行排队输入');
      expect(out.indexOf('pong:AAA')).toBeLessThan(out.indexOf('pong:BBB'));
    },
    30000,
  );

  it(
    '工具（bash）执行期间显示 spinner',
    async () => {
      behavior.delayMs = 300;
      driver.write('run-sleep\n');
      // 工具调用行：名称 + 折叠为单行的命令摘要
      await driver.waitFor('● bash');
      expect(driver.plain()).toContain('sleep 2 && echo done');
      // 工具执行期间（sleep 2）出现执行中 spinner
      await driver.waitFor(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏][^\n]*bash 执行中/);
      // 工具结果与第二轮最终答复
      await driver.waitFor('TOOL-DONE');
      const out = driver.plain();
      expect(out).toContain('✓ done');
      expect(out.indexOf('● bash')).toBeLessThan(out.indexOf('bash 执行中'));
      expect(out.indexOf('bash 执行中')).toBeLessThan(out.indexOf('TOOL-DONE'));
    },
    30000,
  );

  it(
    'Esc 中断当前任务并丢弃排队输入',
    async () => {
      behavior.delayMs = 3000;
      driver.write('AAA\n');
      await sleep(300);
      driver.write('BBB\n');
      await driver.waitFor('已排队');
      driver.write('\x1b'); // Esc
      await driver.waitFor('已中断');
      await driver.waitFor('已丢弃 1 条排队输入');
      await driver.waitFor('> ');
      // 排队输入不会在中断后再执行
      await sleep(1500);
      expect(driver.plain()).not.toContain('pong:BBB');
    },
    30000,
  );
});
