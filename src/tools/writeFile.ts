import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { asString, Tool } from './types.js';

export const writeFileTool: Tool = {
  name: 'write_file',
  description:
    'Write an entire file (creates parent directories, overwrites existing content). For modifying existing files, prefer edit_file.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      content: { type: 'string', description: 'Full file content to write' },
    },
    required: ['path', 'content'],
  },
  mutating: true,
  summarize: (args) => `${args.path} (${String(args.content ?? '').length} chars)`,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, asString(args, 'path'));
    const content = asString(args, 'content');
    mkdirSync(dirname(path), { recursive: true });
    const existed = existsSync(path);
    writeFileSync(path, content);
    return `${existed ? 'overwrote' : 'created'} ${path} (${content.split('\n').length} lines)`;
  },
};
