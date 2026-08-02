import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '../src/tools/types.js';
import { readFileTool } from '../src/tools/readFile.js';
import { writeFileTool } from '../src/tools/writeFile.js';
import { editFileTool } from '../src/tools/editFile.js';
import { globTool } from '../src/tools/glob.js';
import { grepTool } from '../src/tools/grep.js';
import { bashTool } from '../src/tools/bash.js';
import { TodoList, createTodoTool } from '../src/tools/todo.js';

let dir: string;
let ctx: ToolContext;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moss-test-'));
  ctx = { cwd: dir, confirm: async () => true };
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('read_file', () => {
  it('returns content with line numbers', async () => {
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree');
    const out = await readFileTool.execute({ path: 'a.txt' }, ctx);
    expect(out).toBe('1\tone\n2\ttwo\n3\tthree');
  });

  it('respects offset and limit', async () => {
    writeFileSync(join(dir, 'a.txt'), '1\n2\n3\n4\n5');
    const out = await readFileTool.execute({ path: 'a.txt', offset: 2, limit: 2 }, ctx);
    expect(out).toContain('2\t2\n3\t3');
    expect(out).toContain('truncated');
  });

  it('appends truncation notice when file exceeds limit', async () => {
    const lines = Array.from({ length: 2100 }, (_, i) => `line${i}`);
    writeFileSync(join(dir, 'big.txt'), lines.join('\n'));
    const out = await readFileTool.execute({ path: 'big.txt' }, ctx);
    expect(out).toContain('[truncated: showing lines 1-2000 of 2100');
  });

  it('throws on missing file', async () => {
    await expect(readFileTool.execute({ path: 'nope.txt' }, ctx)).rejects.toThrow(
      'file not found',
    );
  });
});

describe('write_file', () => {
  it('creates a file and parent directories', async () => {
    const out = await writeFileTool.execute(
      { path: 'sub/deep/a.txt', content: 'hello' },
      ctx,
    );
    expect(out).toContain('created');
    expect(readFileSync(join(dir, 'sub/deep/a.txt'), 'utf-8')).toBe('hello');
  });

  it('overwrites an existing file', async () => {
    writeFileSync(join(dir, 'a.txt'), 'old');
    const out = await writeFileTool.execute({ path: 'a.txt', content: 'new' }, ctx);
    expect(out).toContain('overwrote');
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe('new');
  });
});

describe('edit_file', () => {
  it('replaces a unique match', async () => {
    writeFileSync(join(dir, 'a.txt'), 'foo bar baz');
    const out = await editFileTool.execute(
      { path: 'a.txt', old_string: 'bar', new_string: 'qux' },
      ctx,
    );
    expect(out).toContain('1 replacement');
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe('foo qux baz');
  });

  it('rejects non-unique match without replace_all', async () => {
    writeFileSync(join(dir, 'a.txt'), 'bar bar');
    await expect(
      editFileTool.execute({ path: 'a.txt', old_string: 'bar', new_string: 'x' }, ctx),
    ).rejects.toThrow('matches 2 locations');
  });

  it('replace_all replaces every occurrence', async () => {
    writeFileSync(join(dir, 'a.txt'), 'bar bar bar');
    await editFileTool.execute(
      { path: 'a.txt', old_string: 'bar', new_string: 'x', replace_all: true },
      ctx,
    );
    expect(readFileSync(join(dir, 'a.txt'), 'utf-8')).toBe('x x x');
  });

  it('rejects when old_string is not found', async () => {
    writeFileSync(join(dir, 'a.txt'), 'content');
    await expect(
      editFileTool.execute({ path: 'a.txt', old_string: 'absent', new_string: 'x' }, ctx),
    ).rejects.toThrow('not found');
  });

  it('rejects identical old and new strings', async () => {
    writeFileSync(join(dir, 'a.txt'), 'content');
    await expect(
      editFileTool.execute({ path: 'a.txt', old_string: 'a', new_string: 'a' }, ctx),
    ).rejects.toThrow('identical');
  });
});

describe('glob', () => {
  it('finds files by pattern', async () => {
    writeFileSync(join(dir, 'a.ts'), '');
    writeFileSync(join(dir, 'b.js'), '');
    mkdirSync(join(dir, 'src'));
    writeFileSync(join(dir, 'src/c.ts'), '');
    const out = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    expect(out).toContain('a.ts');
    expect(out).toContain('src/c.ts');
    expect(out).not.toContain('b.js');
  });

  it('returns newest modified file first', async () => {
    const old = join(dir, 'old.txt');
    const fresh = join(dir, 'new.txt');
    writeFileSync(old, '');
    writeFileSync(fresh, '');
    utimesSync(old, new Date('2020-01-01'), new Date('2020-01-01'));
    const out = await globTool.execute({ pattern: '*.txt' }, ctx);
    expect(out.indexOf('new.txt')).toBeLessThan(out.indexOf('old.txt'));
  });

  it('ignores node_modules', async () => {
    mkdirSync(join(dir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/pkg/x.ts'), '');
    const out = await globTool.execute({ pattern: '**/*.ts' }, ctx);
    expect(out).toBe('(no matches)');
  });

  it('returns "(no matches)" when nothing matches', async () => {
    const out = await globTool.execute({ pattern: '*.zzz' }, ctx);
    expect(out).toBe('(no matches)');
  });
});

describe('grep', () => {
  it('finds matching lines with path and line number', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\nhello again');
    const out = await grepTool.execute({ pattern: 'hello' }, ctx);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('a.txt:1: hello world');
    expect(lines[1]).toBe('a.txt:3: hello again');
  });

  it('filters files by glob_pattern', async () => {
    writeFileSync(join(dir, 'a.ts'), 'target');
    writeFileSync(join(dir, 'b.js'), 'target');
    const out = await grepTool.execute({ pattern: 'target', glob_pattern: '**/*.ts' }, ctx);
    expect(out).toContain('a.ts');
    expect(out).not.toContain('b.js');
  });

  it('throws on invalid regex', async () => {
    await expect(grepTool.execute({ pattern: '[' }, ctx)).rejects.toThrow('invalid regex');
  });

  it('truncates very long lines', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x'.repeat(300) + ' needle');
    const out = await grepTool.execute({ pattern: 'needle' }, ctx);
    expect(out).toContain('…');
    expect(out.split(': ')[1].length).toBeLessThanOrEqual(201);
  });
});

describe('bash', () => {
  it('returns stdout of a command', async () => {
    const out = await bashTool.execute({ command: 'echo hello' }, ctx);
    expect(out).toBe('hello');
  });

  it('includes exit code on failure', async () => {
    const out = await bashTool.execute({ command: 'exit 3' }, ctx);
    expect(out).toContain('[exit code 3]');
  });

  it('labels stderr when stdout is also present', async () => {
    const out = await bashTool.execute({ command: 'echo out; echo err >&2' }, ctx);
    expect(out).toContain('[stderr]');
    expect(out).toContain('out');
    expect(out).toContain('err');
  });

  it('returns bare stderr text when stdout is empty', async () => {
    const out = await bashTool.execute({ command: 'echo err >&2' }, ctx);
    expect(out).toBe('err');
  });

  it('reports timeout', async () => {
    const out = await bashTool.execute({ command: 'sleep 5', timeout: 1 }, ctx);
    expect(out).toContain('timed out');
  }, 10000);
});

describe('todo', () => {
  it('renders the task list', async () => {
    const list = new TodoList();
    const tool = createTodoTool(list);
    const out = await tool.execute(
      { items: [{ content: 'task one', status: 'in_progress' }] },
      ctx,
    );
    expect(out).toContain('- [in_progress] task one');
  });

  it('rejects more than one in_progress item', async () => {
    const list = new TodoList();
    const tool = createTodoTool(list);
    await expect(
      tool.execute(
        {
          items: [
            { content: 'a', status: 'in_progress' },
            { content: 'b', status: 'in_progress' },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow('only one item can be in_progress');
  });

  it('rejects non-array items', async () => {
    const tool = createTodoTool(new TodoList());
    await expect(tool.execute({ items: 'nope' }, ctx)).rejects.toThrow('must be an array');
  });
});
