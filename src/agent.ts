import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions.js';
import { Config, resolveProfile } from './config.js';
import { buildSystemPrompt } from './prompt.js';
import { createTools, toOpenAITools } from './tools/index.js';
import { Tool, ToolContext, ToolError } from './tools/types.js';
import { TodoList } from './tools/todo.js';
import {
  askConfirmation,
  buildPermissionDetail,
  printDiff,
} from './permissions.js';
import {
  compactMessages,
  estimateMessagesTokens,
  truncateToolResult,
} from './context.js';
import { defaultIsRetryable, isAbortError, withRetry } from './retry.js';
import { log } from './logger.js';
import { renderMarkdown } from './markdown.js';
import { SessionStore } from './session.js';
import { ui } from './ui.js';

interface StreamAccum {
  content: string;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
}

/** 用户按下 Esc 主动中断当前轮次 */
export class InterruptedError extends Error {
  constructor() {
    super('interrupted by user');
    this.name = 'InterruptedError';
  }
}

/** 判断一批 tool_calls 是否全部是非 mutating 工具（可并行执行）；未知工具按 mutating 处理 */
export function canRunInParallel(
  calls: ChatCompletionMessageToolCall[],
  tools: Tool[],
): boolean {
  return calls.every((call) => {
    const tool = tools.find((t) => t.name === call.function.name);
    return tool !== undefined && !tool.mutating;
  });
}

export class Agent {
  private client: OpenAI;
  private messages: ChatCompletionMessageParam[];
  private tools: Tool[];
  private todoList = new TodoList();
  private session?: SessionStore;
  private usage = { promptTokens: 0, completionTokens: 0 };
  /** 本会话内已选择 "一律允许" 的工具名集合 */
  private sessionApprovedTools = new Set<string>();

  constructor(
    private config: Config,
    opts: { session?: SessionStore; messages?: ChatCompletionMessageParam[] } = {},
  ) {
    this.client = this.createClient();
    this.tools = createTools(this.todoList);
    this.session = opts.session;
    if (opts.messages) {
      this.messages = opts.messages;
    } else {
      this.messages = [{ role: 'system', content: buildSystemPrompt(process.cwd()) }];
      // 新会话：system prompt 也落盘，保证会话文件可独立回放
      this.logMessage(this.messages[0]);
    }
  }

  /** 处理一轮用户输入，跑完整 agent loop 直到模型不再调用工具 */
  async runTurn(userInput: string, signal?: AbortSignal): Promise<void> {
    this.pushMessage({ role: 'user', content: userInput });
    // 用户输入可能含私密信息；日志只记录长度，不落原文。
    log.info('新一轮任务', { inputLength: userInput.length });

    for (let turn = 0; turn < this.config.maxTurns; turn++) {
      if (signal?.aborted) throw new InterruptedError();
      let acc: StreamAccum;
      try {
        acc = await this.streamCompletion(signal);
      } catch (err) {
        if (signal?.aborted || isAbortError(err)) throw new InterruptedError();
        throw err;
      }

      // 正文整段缓冲渲染 Markdown（thinking 已在流式期间实时展示）
      if (acc.content) {
        process.stdout.write(renderMarkdown(acc.content));
      }

      if (acc.toolCalls.size === 0) {
        this.pushMessage({ role: 'assistant', content: acc.content });
        log.info('任务完成');
        return;
      }

      // 把带 tool_calls 的 assistant 消息入列
      const toolCalls: ChatCompletionMessageToolCall[] = [...acc.toolCalls.values()].map(
        (t) => ({
          id: t.id,
          type: 'function' as const,
          function: { name: t.name, arguments: t.arguments },
        }),
      );
      this.pushMessage({
        role: 'assistant',
        content: acc.content || null,
        tool_calls: toolCalls,
      });

      // 全部是非 mutating 工具时并行执行（结果仍按原始顺序入列），否则串行逐个确认
      if (canRunInParallel(toolCalls, this.tools) && !signal?.aborted) {
        const results = await Promise.all(toolCalls.map((call) => this.executeTool(call)));
        for (let i = 0; i < toolCalls.length; i++) {
          this.pushMessage({ role: 'tool', tool_call_id: toolCalls[i].id, content: results[i] });
        }
      } else {
        for (const call of toolCalls) {
          // 中断后为剩余 tool_calls 补占位结果：每个 tool_call 都必须有对应 tool 消息
          const result = signal?.aborted
            ? 'Error: interrupted by user'
            : await this.executeTool(call);
          this.pushMessage({ role: 'tool', tool_call_id: call.id, content: result });
        }
      }
      if (signal?.aborted) throw new InterruptedError();

      await this.maybeCompact();
    }

    log.warn(`达到最大轮数 ${this.config.maxTurns}，停止`);
    ui.warn(`\n已达到最大轮数 (${this.config.maxTurns})，停止。可以输入 "继续" 让我接着做。`);
  }

  /** 流式请求（带重试）：限流/网络错误指数退避重试；已有部分输出则不再重试，避免重复打印 */
  private async streamCompletion(signal?: AbortSignal): Promise<StreamAccum> {
    log.debug('API 请求开始', {
      model: this.config.model,
      messages: this.messages.length,
      estTokens: estimateMessagesTokens(this.messages),
    });
    const started = Date.now();
    const acc = await withRetry(() => this.streamOnce(signal), {
      retries: 3,
      signal,
      isRetryable: (err) =>
        defaultIsRetryable(err) && !(err as { midStream?: boolean }).midStream,
      onRetry: (err, attempt, delayMs) => {
        const msg = err instanceof Error ? err.message : String(err);
        ui.warn(`\n请求失败：${msg}。${Math.round(delayMs / 1000)}s 后重试 (${attempt}/3)...`);
      },
    });
    log.debug('API 请求完成', {
      ms: Date.now() - started,
      contentLen: acc.content.length,
      toolCalls: [...acc.toolCalls.values()].map((t) => t.name),
      usage: { ...this.usage },
    });
    return acc;
  }

  /** 单次流式请求模型：thinking 折叠为状态行+结束摘要，正文只累积（流结束后统一渲染 Markdown），返回累积结果 */
  private async streamOnce(signal?: AbortSignal): Promise<StreamAccum> {
    const acc: StreamAccum = { content: '', toolCalls: new Map() };
    let inThinking = false;
    let thinkingStartedAt = 0;
    let thinkingChars = 0;
    const endThinking = () => {
      if (inThinking) {
        ui.thinkingEnd(Date.now() - thinkingStartedAt, thinkingChars);
        inThinking = false;
      }
    };

    // 首个 delta 到达前是静默等待期，显示加载提示
    ui.spinner.start('等待模型响应');
    let responded = false;
    const markResponded = () => {
      if (!responded) {
        responded = true;
        ui.spinner.stop();
      }
    };

    try {
      const stream = await this.client.chat.completions.create(
        {
          model: this.config.model,
          messages: this.messages,
          tools: toOpenAITools(this.tools),
          stream: true,
          stream_options: { include_usage: true },
          temperature: 1.0,
          top_p: 0.95,
        },
        { signal },
      );

      for await (const chunk of stream) {
        const usage = (
          chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } | null }
        ).usage;
        if (usage) {
          this.usage.promptTokens += usage.prompt_tokens ?? 0;
          this.usage.completionTokens += usage.completion_tokens ?? 0;
        }

        const delta = chunk.choices[0]?.delta as
          | {
              content?: string | null;
              reasoning_content?: string | null;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            }
          | undefined;
        if (!delta) continue;
        markResponded();

        if (delta.reasoning_content) {
          if (!inThinking) {
            ui.thinkingStart();
            inThinking = true;
            thinkingStartedAt = Date.now();
          }
          thinkingChars += delta.reasoning_content.length;
        }
        if (delta.content) {
          endThinking();
          acc.content += delta.content;
        }
        if (delta.tool_calls) {
          endThinking();
          for (const tc of delta.tool_calls) {
            const existing = acc.toolCalls.get(tc.index) ?? { id: '', name: '', arguments: '' };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.arguments += tc.function.arguments;
            acc.toolCalls.set(tc.index, existing);
          }
        }
      }
      endThinking();
      ui.spinner.stop();
      return acc;
    } catch (err) {
      ui.spinner.stop();
      // 已有部分输出时标记为"流中途失败"，重试会重复打印，交给上层直接报错
      if (acc.content || acc.toolCalls.size > 0) {
        (err as { midStream?: boolean }).midStream = true;
      }
      throw err;
    }
  }

  /** 是否免确认：仅限用户在当前会话明确批准过的工具。 */
  private isPreApproved(tool: Tool): boolean {
    return this.sessionApprovedTools.has(tool.name);
  }

  private async executeTool(call: ChatCompletionMessageToolCall): Promise<string> {
    const tool = this.tools.find((t) => t.name === call.function.name);
    if (!tool) {
      log.warn(`未知工具：${call.function.name}`);
      return `Error: unknown tool "${call.function.name}"`;
    }

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments || '{}');
    } catch {
      log.warn('工具参数 JSON 解析失败', { argumentLength: call.function.arguments.length });
      return 'Error: invalid tool arguments JSON';
    }
    // 参数可能含文件内容、命令或凭据；只记录字段名。
    log.debug(`工具调用 ${tool.name}`, { argumentNames: Object.keys(args) });

    ui.toolCall(tool.name, tool.summarize(args));

    // 权限确认：所有 bash 命令和文件写操作默认都需用户明确批准。
    if (tool.mutating && !this.config.autoYes && !this.isPreApproved(tool)) {
      const detail = buildPermissionDetail(tool.name, args, process.cwd());
      ui.permission(`${tool.name} 请求批准`);
      if (tool.name === 'bash') ui.info(`  ${detail}`);
      else printDiff(detail);
      const choice = await askConfirmation();
      if (choice === 'a') {
        this.sessionApprovedTools.add(tool.name);
        log.info(`权限批准：${tool.name}（本会话一律允许）`);
        ui.info(`  本会话内 ${tool.name} 一律允许。`);
      } else if (choice === 'n') {
        log.info(`权限拒绝：${tool.name}`);
        ui.toolResult('已被用户拒绝', true);
        return 'Error: user denied permission for this action. Do NOT retry the same action; ask the user or adjust your approach.';
      }
    }

    const ctx: ToolContext = {
      cwd: process.cwd(),
      confirm: async () => true,
    };
    const started = Date.now();
    ui.spinner.start(`${tool.name} 执行中`);
    try {
      const result = await tool.execute(args, ctx);
      ui.spinner.stop();
      log.debug(`工具完成 ${tool.name}`, { ms: Date.now() - started, resultLen: result.length });
      const truncated = truncateToolResult(result);
      const firstLine = result.split('\n')[0];
      ui.toolResult(
        firstLine.length > 100 ? firstLine.slice(0, 100) + '…' : firstLine,
      );
      return truncated;
    } catch (err) {
      ui.spinner.stop();
      const msg = err instanceof ToolError ? err.message : `unexpected error: ${err}`;
      log.warn(`工具失败 ${tool.name}（${Date.now() - started}ms）`, err instanceof Error ? err : msg);
      ui.toolResult(msg, true);
      return `Error: ${msg}`;
    }
  }

  /** 上下文接近预算时自动压缩 */
  private async maybeCompact(): Promise<void> {
    const tokens = estimateMessagesTokens(this.messages);
    if (tokens < this.config.contextTokenBudget) return;
    await this.doCompact();
  }

  /** 立即压缩上下文（/compact 命令） */
  async compactNow(): Promise<void> {
    await this.doCompact();
  }

  private async doCompact(): Promise<void> {
    ui.info(`\n🗜 上下文约 ${estimateMessagesTokens(this.messages)} tokens，压缩中...`);
    log.info(`上下文压缩开始（约 ${estimateMessagesTokens(this.messages)} tokens）`);
    const summarize = async (text: string): Promise<string> => {
      const res = await withRetry(
        () =>
          this.client.chat.completions.create({
            model: this.config.model,
            messages: [
              {
                role: 'user',
                content: `Summarize this coding-agent conversation history for continuation. Preserve: the user's goal, key decisions, files created/modified (with paths), important code details, errors encountered and their fixes, current progress, and next steps. Be dense and factual, under 1500 words.\n\n${text}`,
              },
            ],
          }),
        {
          retries: 3,
          onRetry: (_err, attempt, delayMs) =>
            ui.warn(`压缩请求失败，${Math.round(delayMs / 1000)}s 后重试 (${attempt}/3)...`),
        },
      );
      return res.choices[0]?.message.content ?? '(summary failed)';
    };
    this.messages = await compactMessages(this.messages, summarize);
    try {
      this.session?.reset(this.messages);
    } catch (err) {
      log.error('会话保存失败', err);
      ui.warn(`会话保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
    log.info(`上下文压缩完成，当前约 ${estimateMessagesTokens(this.messages)} tokens`);
    ui.info(`🗜 压缩完成，当前约 ${estimateMessagesTokens(this.messages)} tokens。`);
  }

  /** 清空对话历史（/clear 命令），重新生成 system prompt */
  clearHistory(): void {
    this.messages = [{ role: 'system', content: buildSystemPrompt(process.cwd()) }];
    this.todoList.items = [];
    log.info('对话历史已清空');
    try {
      this.session?.reset(this.messages);
    } catch (err) {
      log.error('会话保存失败', err);
      ui.warn(`会话保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private createClient(): OpenAI {
    return new OpenAI({ apiKey: this.config.apiKey, baseURL: this.config.baseURL });
  }

  /** 切换模型：命中 config.json 的配置名则整体切换 endpoint/环境变量凭据，否则按裸模型 ID 处理 */
  setModel(nameOrId: string): { model: string; profileName?: string } {
    const resolved = resolveProfile(nameOrId, this.config.profiles, this.config.defaults);
    if (!resolved.apiKey) {
      throw new Error(
        `配置 "${nameOrId}" 没有可用的 API key，请设置 apiKeyEnv 指向的环境变量或 MOONSHOT_API_KEY`,
      );
    }
    log.info(
      `模型切换为 ${resolved.model}` +
        (resolved.profileName ? `（配置：${resolved.profileName}，endpoint: ${resolved.baseURL}）` : ''),
    );
    this.config.model = resolved.model;
    this.config.baseURL = resolved.baseURL;
    this.config.apiKey = resolved.apiKey;
    this.config.profileName = resolved.profileName;
    this.client = this.createClient();
    return { model: resolved.model, profileName: resolved.profileName };
  }

  getModel(): string {
    return this.config.model;
  }

  getProfileName(): string | undefined {
    return this.config.profileName;
  }

  /** config.json 中配置的全部模型（/model 列表用） */
  listProfiles(): Array<{ name: string; model: string }> {
    return Object.entries(this.config.profiles).map(([name, p]) => ({ name, model: p.model }));
  }

  /** token 用量统计（/cost 命令）：API 累计 + 当前上下文估算 */
  getUsage(): { promptTokens: number; completionTokens: number; contextTokens: number } {
    return { ...this.usage, contextTokens: estimateMessagesTokens(this.messages) };
  }

  /** 追加消息并落盘（落盘失败不阻断对话） */
  private pushMessage(msg: ChatCompletionMessageParam): void {
    this.messages.push(msg);
    this.logMessage(msg);
  }

  private logMessage(msg: ChatCompletionMessageParam): void {
    try {
      this.session?.appendMessage(msg);
    } catch (err) {
      log.error('会话保存失败', err);
      ui.warn(`会话保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
