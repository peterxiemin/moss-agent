import { describe, it, expect } from 'vitest';
import { renderThinkingSummary, formatToolSummary } from '../src/ui.js';

describe('renderThinkingSummary', () => {
  it('包含耗时（秒，一位小数）和内容长度', () => {
    expect(renderThinkingSummary(3200, 487)).toBe('✨ thought for 3.2s · 487 chars');
  });

  it('耗时不足一秒时显示 0.x s', () => {
    expect(renderThinkingSummary(250, 10)).toBe('✨ thought for 0.3s · 10 chars');
  });

  it('不泄露 thinking 正文内容', () => {
    expect(renderThinkingSummary(1000, 5)).not.toContain('secret');
  });
});

describe('formatToolSummary', () => {
  it('单行短摘要原样返回', () => {
    expect(formatToolSummary('ls -la src/')).toBe('ls -la src/');
  });

  it('多行命令压缩为单行', () => {
    expect(formatToolSummary('npm install &&\nnpm test')).toBe('npm install && npm test');
  });

  it('压缩连续空白', () => {
    expect(formatToolSummary('echo   a\t\tb')).toBe('echo a b');
  });

  it('超长摘要截断并加省略号', () => {
    const long = 'x'.repeat(200);
    const out = formatToolSummary(long);
    expect(out).toHaveLength(121);
    expect(out.endsWith('…')).toBe(true);
  });

  it('恰好等于上限时不截断', () => {
    const exact = 'y'.repeat(120);
    expect(formatToolSummary(exact)).toBe(exact);
  });
});
