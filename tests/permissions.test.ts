import { describe, it, expect } from 'vitest';
import { renderDiff } from '../src/permissions.js';

// vitest 非 TTY 环境下 chalk 无色，可直接断言纯文本结构
describe('renderDiff', () => {
  const sample = [
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,3 +10,3 @@ const fn = () => {',
    ' context line',
    '-old line',
    '+new line',
    ' tail line',
  ].join('\n');

  it('keeps hunk headers and file headers', () => {
    const out = renderDiff(sample).split('\n');
    expect(out[0]).toBe('--- a/src/a.ts');
    expect(out[1]).toBe('+++ b/src/a.ts');
    expect(out[2]).toBe('@@ -10,3 +10,3 @@ const fn = () => {');
  });

  it('tracks old/new line numbers from the hunk header', () => {
    const out = renderDiff(sample).split('\n');
    // 格式：<old> <new> │ <内容>；删除行只有旧行号，新增行只有新行号
    expect(out[3]).toBe('  10   10 │  context line');
    expect(out[4]).toBe('  11      │ - old line');
    expect(out[5]).toBe('       11 │ + new line');
    expect(out[6]).toBe('  12   12 │  tail line');
  });

  it('handles multiple hunks by resetting counters at each header', () => {
    const two = ['@@ -1 +1 @@', '-a', '+b', '@@ -50 +50 @@', '-c', '+d'].join('\n');
    const out = renderDiff(two).split('\n');
    expect(out[1]).toContain('1');
    expect(out[4]).toBe('  50      │ - c');
  });

  it('passes through meta lines like truncation notes', () => {
    const out = renderDiff('@@ -1 +1 @@\n+x\n... (diff truncated, 100 lines total)');
    expect(out.split('\n')[2]).toBe('... (diff truncated, 100 lines total)');
  });
});
