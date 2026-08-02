import { describe, it, expect } from 'vitest';
import chalk from 'chalk';
import { renderOptions } from '../src/select.js';

// 测试环境强制关闭 chalk 颜色，断言纯文本结构
chalk.level = 0;

describe('renderOptions', () => {
  const options = [
    { label: 'k2.7', hint: 'kimi-k2.7-code-preview' },
    { label: 'deepseek', hint: 'deepseek-chat' },
    { label: 'No' },
  ];

  it('marks the cursor row with the pointer glyph', () => {
    const lines = renderOptions(options, 1).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('  k2.7  kimi-k2.7-code-preview');
    expect(lines[1]).toBe('❯ deepseek  deepseek-chat');
    expect(lines[2]).toBe('  No');
  });

  it('moves the pointer with the cursor index', () => {
    const lines = renderOptions(options, 0).split('\n');
    expect(lines[0]).toMatch(/^❯ /);
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it('omits hint spacing when hint is absent', () => {
    const lines = renderOptions([{ label: 'Yes, once' }], 0).split('\n');
    expect(lines[0]).toBe('❯ Yes, once');
  });
});
