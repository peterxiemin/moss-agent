import { describe, it, expect } from 'vitest';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import {
  estimateTokens,
  estimateMessagesTokens,
  truncateToolResult,
  compactMessages,
} from '../src/context.js';

describe('estimateTokens', () => {
  it('estimates ~3 chars per token', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('a'.repeat(10))).toBe(4);
  });
});

describe('estimateMessagesTokens', () => {
  it('sums string contents across messages', () => {
    const msgs: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'a'.repeat(30) },
      { role: 'user', content: 'b'.repeat(60) },
    ];
    expect(estimateMessagesTokens(msgs)).toBe(10 + 20);
  });

  it('counts assistant tool_calls', () => {
    const msgs: ChatCompletionMessageParam[] = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.ts"}' },
          },
        ],
      },
    ];
    expect(estimateMessagesTokens(msgs)).toBeGreaterThan(0);
  });
});

describe('truncateToolResult', () => {
  it('passes through results under the limit', () => {
    expect(truncateToolResult('short')).toBe('short');
  });

  it('keeps head and tail with a marker when over the limit', () => {
    const long = 'H'.repeat(30_000) + 'M'.repeat(20_000) + 'T'.repeat(30_000);
    const out = truncateToolResult(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out.startsWith('H'.repeat(100))).toBe(true);
    expect(out.endsWith('T'.repeat(100))).toBe(true);
    expect(out).toContain('[... truncated 20000 chars ...]');
  });
});

describe('compactMessages', () => {
  const summarize = async (text: string) => `SUMMARY(${text.length} chars)`;

  const buildMessages = (): ChatCompletionMessageParam[] => [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'old question' },
    { role: 'assistant', content: 'old answer' },
    { role: 'user', content: 'recent question 1' },
    { role: 'assistant', content: 'recent answer 1' },
  ];

  it('keeps system, inserts summary, and preserves recent messages', async () => {
    const out = await compactMessages(buildMessages(), summarize, 3);
    expect(out[0]).toEqual({ role: 'system', content: 'system prompt' });
    expect(out[1].role).toBe('user');
    expect(out[1].content as string).toContain('SUMMARY(');
    expect(out[out.length - 1]).toEqual({ role: 'assistant', content: 'recent answer 1' });
    // 老消息已被压缩掉
    expect(out.some((m) => m.content === 'old question')).toBe(false);
  });

  it('never splits an assistant tool_call from its tool response', async () => {
    const msgs: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'bash', arguments: '{"command":"ls"}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'file.txt' },
      { role: 'assistant', content: 'done' },
    ];
    // keepRecent=2 会把切割点落在 tool 消息上，应向前跳过整段 tool 交互
    const out = await compactMessages(msgs, summarize, 2);
    const toolIdx = out.findIndex((m) => m.role === 'tool');
    const assistantIdx = out.findIndex(
      (m) => m.role === 'assistant' && Array.isArray(m.tool_calls),
    );
    // 要么整段都保留且 tool_calls 紧跟 tool 响应，要么整段都被压缩进 summary
    if (toolIdx !== -1) {
      expect(assistantIdx).toBe(toolIdx - 1);
    }
    expect(out[out.length - 1]).toEqual({ role: 'assistant', content: 'done' });
  });

  it('marks tool usage in the summarized text', async () => {
    let captured = '';
    const spySummarize = async (text: string) => {
      captured = text;
      return 's';
    };
    const msgs: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: 'calling tool',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'glob', arguments: '{}' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'a.ts' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    await compactMessages(msgs, spySummarize, 2);
    expect(captured).toContain('[called tools: glob]');
  });
});
