import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/markdown.js';

// vitest 非 TTY 环境下 chalk 无色，可直接断言纯文本结构
describe('renderMarkdown', () => {
  it('renders headings, bold, lists and code blocks', () => {
    const out = renderMarkdown(
      '# Title\n\nSome **bold** and `inline code`.\n\n- item a\n- item b\n\n```ts\nconst x = 1;\n```\n',
    );
    expect(out).toContain('Title');
    expect(out).toContain('bold');
    expect(out).toContain('inline code');
    expect(out).toContain('* item a');
    expect(out).toContain('const x = 1;');
  });

  it('handles plain text and empty input', () => {
    expect(renderMarkdown('hello')).toContain('hello');
    expect(renderMarkdown('')).toBe('');
  });

  it('keeps unclosed code fence content instead of crashing', () => {
    const out = renderMarkdown('```ts\nconst x = 1;');
    expect(out).toContain('const x = 1;');
  });
});
