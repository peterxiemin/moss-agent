import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { asNumber, asString, Tool, ToolError } from './types.js';

const MAX_LINES = 2000;

export const readFileTool: Tool = {
  name: 'read_file',
  description:
    'Read a file with line numbers. Use offset/limit for large files. Always read a file before editing it.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path (absolute or relative to cwd)' },
      offset: { type: 'number', description: '1-based line number to start from (default 1)' },
      limit: { type: 'number', description: `Max lines to read (default ${MAX_LINES})` },
    },
    required: ['path'],
  },
  mutating: false,
  summarize: (args) => `${args.path}`,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, asString(args, 'path'));
    if (!existsSync(path)) throw new ToolError(`file not found: ${path}`);
    const lines = readFileSync(path, 'utf-8').split('\n');
    const offset = asNumber(args, 'offset', 1);
    const limit = asNumber(args, 'limit', MAX_LINES);
    const start = Math.max(0, offset - 1);
    const slice = lines.slice(start, start + limit);
    const body = slice.map((l, i) => `${start + i + 1}\t${l}`).join('\n');
    const truncated = start + limit < lines.length;
    return (
      body +
      (truncated
        ? `\n\n[truncated: showing lines ${start + 1}-${start + slice.length} of ${lines.length}. Use offset to continue.]`
        : '')
    );
  },
};
