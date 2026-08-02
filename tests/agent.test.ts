import { describe, it, expect } from 'vitest';
import type { ChatCompletionMessageToolCall } from 'openai/resources/chat/completions.js';
import type { Tool } from '../src/tools/types.js';
import { canRunInParallel } from '../src/agent.js';

/** 构造一个最小 Tool 桩，只需 name 和 mutating 参与判定 */
function stubTool(name: string, mutating: boolean): Tool {
  return {
    name,
    mutating,
    description: '',
    parameters: {},
    summarize: () => '',
    execute: async () => '',
  };
}

/** 构造一个最小 tool_call 桩 */
function stubCall(name: string): ChatCompletionMessageToolCall {
  return {
    id: `call_${name}`,
    type: 'function',
    function: { name, arguments: '{}' },
  };
}

const tools: Tool[] = [
  stubTool('read_file', false),
  stubTool('grep', false),
  stubTool('write_file', true),
  stubTool('bash', true),
];

describe('canRunInParallel', () => {
  it('returns true when all calls are non-mutating', () => {
    expect(canRunInParallel([stubCall('read_file'), stubCall('grep')], tools)).toBe(true);
  });

  it('returns false when any call is mutating', () => {
    expect(canRunInParallel([stubCall('read_file'), stubCall('write_file')], tools)).toBe(false);
    expect(canRunInParallel([stubCall('bash')], tools)).toBe(false);
  });

  it('returns false for unknown tools (treated as mutating)', () => {
    expect(canRunInParallel([stubCall('nope')], tools)).toBe(false);
  });

  it('returns true for an empty batch', () => {
    expect(canRunInParallel([], tools)).toBe(true);
  });
});
