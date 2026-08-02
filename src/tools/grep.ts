import fg from 'fast-glob';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { asString, Tool, ToolError } from './types.js';

const MAX_MATCHES = 100;
const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

export const grepTool: Tool = {
  name: 'grep',
  description:
    'Search file contents with a regex. Returns matching lines as "path:line: content". Use glob_pattern to narrow file set, e.g. "*.ts".',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for' },
      path: { type: 'string', description: 'Directory to search in (default: cwd)' },
      glob_pattern: {
        type: 'string',
        description: 'Only search files matching this glob, e.g. "**/*.ts" (default: all files)',
      },
    },
    required: ['pattern'],
  },
  mutating: false,
  summarize: (args) => `/${args.pattern}/ ${args.glob_pattern ?? ''}`.trim(),
  async execute(args, ctx) {
    const pattern = asString(args, 'pattern');
    let regex: RegExp;
    try {
      regex = new RegExp(pattern);
    } catch {
      throw new ToolError(`invalid regex: ${pattern}`);
    }
    const cwd = args.path ? asString(args, 'path') : ctx.cwd;
    const globPattern = asString(args, 'glob_pattern', false) || '**/*';
    const files = await fg(globPattern, {
      cwd,
      ignore: IGNORE,
      onlyFiles: true,
      followSymbolicLinks: false,
    });

    const matches: string[] = [];
    outer: for (const file of files) {
      let content: string;
      try {
        content = readFileSync(join(cwd, file), 'utf-8');
      } catch {
        continue; // 二进制或不可读文件，跳过
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          const text = lines[i].length > 200 ? lines[i].slice(0, 200) + '…' : lines[i];
          matches.push(`${file}:${i + 1}: ${text}`);
          if (matches.length >= MAX_MATCHES) break outer;
        }
      }
    }
    const suffix =
      matches.length >= MAX_MATCHES ? `\n\n[truncated at ${MAX_MATCHES} matches]` : '';
    return (matches.length ? matches.join('\n') : '(no matches)') + suffix;
  },
};
