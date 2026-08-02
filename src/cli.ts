#!/usr/bin/env node
import { Command } from 'commander';
import readline from 'node:readline';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { Agent, InterruptedError } from './agent.js';
import { loadConfig } from './config.js';
import { attachMainReadline, dispatchLine } from './input.js';
import { log, logFilePath, setLogLevel } from './logger.js';
import { InputQueue } from './queue.js';
import { mossHome, SessionStore } from './session.js';
import { select } from './select.js';
import { ui } from './ui.js';

// 兜底：未捕获异常也落日志，部署后能看到崩溃原因
process.on('uncaughtException', (err) => {
  log.error('uncaughtException', err);
  console.error(err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  log.error('unhandledRejection', reason instanceof Error ? reason : String(reason));
});

const program = new Command();

program
  .name('moss')
  .description('A simplified Claude Code-like coding agent, powered by Kimi K2.7 Code')
  .version('0.2.0')
  .argument('[prompt]', '任务描述；不提供则进入交互模式')
  .option('-m, --model <model>', '模型 ID 或 ~/.moss/config.json 中的配置名', undefined)
  .option('-y, --yes', '自动批准所有写操作和命令（谨慎使用）', false)
  .option('--max-turns <n>', '单轮任务的最大 agent 循环次数', (v) => parseInt(v, 10))
  .option('-c, --continue', '继续当前目录下最近的一次会话', false)
  .option('-r, --resume <id>', '恢复指定 id 的会话（/sessions 查看 id）', undefined)
  .option('--log-level <level>', '文件日志级别 debug|info|warn|error|none（默认 debug，也可用 MOSS_LOG_LEVEL）', undefined)
  .action(
    async (
      prompt: string | undefined,
      options: {
        model?: string;
        yes: boolean;
        maxTurns?: number;
        continue: boolean;
        resume?: string;
        logLevel?: string;
      },
    ) => {
      if (options.logLevel) setLogLevel(options.logLevel);
      const config = loadConfig({
        yes: options.yes,
        model: options.model,
        maxTurns: options.maxTurns,
      });

      // 会话：新建或恢复
      let session: SessionStore;
      let restored: ChatCompletionMessageParam[] | undefined;
      if (options.resume) {
        const found = SessionStore.find(options.resume);
        if (!found) {
          ui.error(`找不到 id 以 "${options.resume}" 开头的会话，用 /sessions 或 ls ${mossHome()}/sessions 查看`);
          process.exit(1);
        }
        session = found.store;
        restored = found.messages;
      } else if (options.continue) {
        const found = SessionStore.latest(process.cwd());
        if (found) {
          session = found.store;
          restored = found.messages;
        } else {
          ui.info('当前目录没有历史会话，开始新会话。');
          session = SessionStore.create(process.cwd(), config.model);
        }
      } else {
        session = SessionStore.create(process.cwd(), config.model);
      }
      const agent = new Agent(config, { session, messages: restored });

      log.info('moss 启动', {
        version: '0.2.0',
        model: config.model,
        baseURL: config.baseURL,
        session: session.meta.id,
        cwd: process.cwd(),
        pid: process.pid,
        promptProvided: Boolean(prompt),
        restored: restored?.length ?? 0,
      });
      ui.info(
        `moss v0.2.0 · model: ${config.model}` +
          (config.profileName ? `（配置：${config.profileName}）` : '') +
          ` · session: ${session.meta.id}`,
      );
      ui.info(`log: ${logFilePath()}`);
      if (config.autoYes) ui.warn('⚠ 自动批准模式已开启 (-y)');
      if (restored) ui.info(`已恢复 ${restored.length} 条历史消息`);
      ui.info('');

      if (prompt) {
        try {
          await agent.runTurn(prompt);
        } catch (err) {
          log.error('任务失败', err instanceof Error ? err : String(err));
          ui.error(`\n出错了: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
        return;
      }
      await repl(agent);
    },
  );

/** 运行一轮任务，期间按 Esc 可中断（仅 TTY 下生效）；返回是否被用户中断 */
async function runInterruptible(agent: Agent, input: string): Promise<boolean> {
  const controller = new AbortController();
  const tty = process.stdin.isTTY;
  // 终端 raw 模式下 Esc 是一个单独的字节 0x1b；Ctrl+C（0x03）在 raw 模式下不产生 SIGINT，手动处理
  const onData = (buf: Buffer) => {
    if (buf.length === 1 && buf[0] === 0x1b) controller.abort();
    else if (buf[0] === 0x03) process.exit(130);
  };
  if (tty) {
    process.stdin.on('data', onData);
    process.stdin.resume();
  }
  try {
    await agent.runTurn(input, controller.signal);
    return false;
  } catch (err) {
    if (err instanceof InterruptedError) {
      log.info('用户中断（Esc）');
      ui.warn('\n⏹ 已中断（Esc）。');
      return true;
    }
    throw err;
  } finally {
    if (tty) process.stdin.off('data', onData);
  }
}

const SLASH_HELP = `可用命令：
  /help            显示本帮助
  /clear           清空对话历史
  /compact         立即压缩上下文
  /model [名称]    切换模型（无参数时弹出列表选择；可给 config.json 配置名或模型 ID）
  /cost            查看 token 用量
  /sessions        列出最近会话（moss -r <id> 可恢复）
  /exit            退出`;

/** 处理 slash 命令；返回 true 表示输入已被当作命令处理 */
async function handleSlash(
  input: string,
  agent: Agent,
  rl: readline.Interface,
): Promise<boolean> {
  if (!input.startsWith('/')) return false;
  const [cmd, ...rest] = input.split(/\s+/);
  switch (cmd) {
    case '/help':
      ui.info(SLASH_HELP);
      break;
    case '/clear':
      agent.clearHistory();
      ui.info('对话历史已清空。');
      break;
    case '/compact':
      await agent.compactNow();
      break;
    case '/model': {
      const name = rest.join(' ').trim();
      if (name) {
        const r = agent.setModel(name);
        ui.info(
          r.profileName
            ? `已切换到配置 ${r.profileName}（模型 ${r.model}）`
            : `模型已切换为 ${r.model}`,
        );
      } else {
        const profiles = agent.listProfiles();
        if (profiles.length === 0) {
          ui.info(`当前模型：${agent.getModel()}`);
          ui.info('未配置 ~/.moss/config.json；用 /model <模型ID> 直接切换');
          break;
        }
        const current = agent.getProfileName();
        rl.pause();
        const idx = await select(
          `切换模型（当前：${agent.getModel()}）`,
          profiles.map((p) => ({
            label: p.name + (p.name === current ? ' ●' : ''),
            hint: p.model,
          })),
        );
        rl.resume();
        if (idx === null) {
          ui.info('已取消');
          break;
        }
        const r = agent.setModel(profiles[idx].name);
        ui.info(`已切换到配置 ${r.profileName}（模型 ${r.model}）`);
      }
      break;
    }
    case '/cost': {
      const u = agent.getUsage();
      ui.info(
        `API 累计：prompt ${u.promptTokens} / completion ${u.completionTokens} tokens；当前上下文估算约 ${u.contextTokens} tokens。`,
      );
      break;
    }
    case '/sessions': {
      const sessions = SessionStore.list().slice(0, 10);
      if (sessions.length === 0) {
        ui.info('暂无历史会话。');
      } else {
        for (const s of sessions) {
          ui.info(`  ${s.id}  ${s.createdAt.slice(0, 16).replace('T', ' ')}  ${s.cwd}`);
        }
        ui.info('提示：moss -r <id> 恢复对应会话，moss -c 继续当前目录最近一次会话');
      }
      break;
    }
    default:
      ui.warn(`未知命令 ${cmd}，输入 /help 查看可用命令。`);
  }
  return true;
}

const HISTORY_LIMIT = 200;

function historyFile(): string {
  return join(mossHome(), 'repl_history');
}

function loadHistory(): string[] {
  try {
    return readFileSync(historyFile(), 'utf-8').split('\n').filter(Boolean).slice(-HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function appendHistory(input: string): void {
  try {
    mkdirSync(mossHome(), { recursive: true, mode: 0o700 });
    appendFileSync(historyFile(), input + '\n', { mode: 0o600 });
  } catch {
    // 历史写入失败不影响使用
  }
}

/** 交互式 REPL */
async function repl(agent: Agent): Promise<void> {
  ui.info('交互模式。输入任务后回车；执行中输入会排队，按 Esc 可中断；/help 查看命令；exit 退出。\n');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> ',
    historySize: HISTORY_LIMIT,
  });
  // readline 的 history 数组是"最新在前"，预加载时需要反转（history 不在公开类型中，手动断言）
  (rl as unknown as { history: string[] }).history.push(...loadHistory().reverse());

  // 任务/命令执行中的输入进入队列，当前输入结束后按序执行，避免并发 runTurn 污染共享消息序
  const inputQueue = new InputQueue();

  const truncate = (s: string): string => (s.length > 60 ? s.slice(0, 60) + '…' : s);

  /** 执行一条输入（slash 命令或任务）；返回是否被 Esc 中断 */
  const runOne = async (input: string): Promise<boolean> => {
    appendHistory(input);
    if (input.startsWith('/')) {
      try {
        await handleSlash(input, agent, rl);
      } catch (err) {
        log.error(`slash 命令失败：${input}`, err instanceof Error ? err : String(err));
        ui.error(`\n命令出错: ${err instanceof Error ? err.message : String(err)}`);
      }
      return false;
    }
    rl.pause();
    ui.rule();
    let interrupted = false;
    try {
      interrupted = await runInterruptible(agent, input);
    } catch (err) {
      log.error('任务失败', err instanceof Error ? err : String(err));
      ui.error(`\n出错了: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log();
    rl.resume();
    return interrupted;
  };

  // 主循环挂到全局唯一 stdin 分发器，line 事件统一走 dispatchLine
  attachMainReadline((line) => {
    void (async () => {
      const input = line.trim();
      if (input === 'exit' || input === 'quit' || input === '/exit' || input === '/quit') {
        rl.close();
        return;
      }
      if (inputQueue.busy) {
        if (input) {
          const n = inputQueue.enqueue(input);
          ui.info(`\n⏵ 已排队（第 ${n} 条）：${truncate(input)}`);
        }
        return;
      }
      if (!input) {
        rl.prompt();
        return;
      }
      await inputQueue.run(input, runOne, {
        onNext: (next, remaining) =>
          ui.info(`▶ 执行排队输入（剩余 ${remaining} 条）：${truncate(next)}`),
        onDrop: (dropped) => ui.info(`已丢弃 ${dropped} 条排队输入。`),
      });
      rl.prompt();
    })();
  });

  rl.on('line', (line) => dispatchLine(line));

  rl.on('close', () => {
    log.info('退出');
    ui.info('\nbye 👋');
    process.exit(0);
  });

  rl.prompt();
}

program.parse();
