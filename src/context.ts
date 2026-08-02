import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

/** 粗粒度 token 估算：英文约 4 字符/token，中文更密，取保守值 3 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

export function estimateMessagesTokens(messages: ChatCompletionMessageParam[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') total += estimateTokens(m.content);
    else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part.type === 'text') total += estimateTokens(part.text);
      }
    }
    if (m.role === 'assistant' && m.tool_calls) {
      total += estimateTokens(JSON.stringify(m.tool_calls));
    }
  }
  return total;
}

const MAX_TOOL_RESULT_CHARS = 60_000;

/** 截断过长的单条工具结果 */
export function truncateToolResult(result: string): string {
  if (result.length <= MAX_TOOL_RESULT_CHARS) return result;
  const head = result.slice(0, MAX_TOOL_RESULT_CHARS / 2);
  const tail = result.slice(-MAX_TOOL_RESULT_CHARS / 2);
  return `${head}\n\n[... truncated ${result.length - MAX_TOOL_RESULT_CHARS} chars ...]\n\n${tail}`;
}

/**
 * 找一个安全的切割点：不能在 assistant(tool_calls) 与其 tool 响应之间切开。
 * 返回应保留的"尾部"起始下标。
 */
function findSafeCutIndex(messages: ChatCompletionMessageParam[], targetTailCount: number): number {
  let idx = Math.max(1, messages.length - targetTailCount);
  // 向前推进，直到 idx 指向的不是 tool 消息（且前一条不是带 tool_calls 的 assistant）
  while (idx < messages.length) {
    const msg = messages[idx];
    const prev = messages[idx - 1];
    const isOrphanTool = msg.role === 'tool';
    const prevHasToolCalls =
      prev?.role === 'assistant' && Array.isArray(prev.tool_calls) && prev.tool_calls.length > 0;
    if (!isOrphanTool && !prevHasToolCalls) break;
    idx++;
  }
  return Math.min(idx, messages.length - 1);
}

/**
 * 上下文压缩：当 token 超预算时，让模型把旧对话总结为一条 user 消息，
 * 保留 system prompt + 总结 + 最近若干轮原文。
 */
export async function compactMessages(
  messages: ChatCompletionMessageParam[],
  summarize: (text: string) => Promise<string>,
  keepRecent = 8,
): Promise<ChatCompletionMessageParam[]> {
  const system = messages[0];
  const cutIdx = findSafeCutIndex(messages, keepRecent);
  const oldPart = messages.slice(1, cutIdx);
  const recentPart = messages.slice(cutIdx);

  const oldText = oldPart
    .map((m) => {
      const content =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      const extra =
        m.role === 'assistant' && m.tool_calls
          ? ` [called tools: ${m.tool_calls.map((t) => t.function.name).join(', ')}]`
          : '';
      return `<${m.role}>${extra}\n${content.slice(0, 4000)}`;
    })
    .join('\n\n');

  const summary = await summarize(oldText);
  const summaryMessage: ChatCompletionMessageParam = {
    role: 'user',
    content: `[Context compacted. Summary of earlier conversation:]\n\n${summary}\n\n[Continue based on this summary and the recent messages below.]`,
  };
  return [system, summaryMessage, ...recentPart];
}
