import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { asString, Tool, ToolError } from './types.js';

export const editFileTool: Tool = {
  name: 'edit_file',
  description:
    'Edit a file by exact string replacement. old_string must match the file content exactly (including indentation) and must be unique unless replace_all is true. Read the file first to get exact content.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      old_string: { type: 'string', description: 'Exact text to replace' },
      new_string: { type: 'string', description: 'Replacement text' },
      replace_all: {
        type: 'boolean',
        description: 'Replace all occurrences (default false)',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },
  mutating: true,
  summarize: (args) => `${args.path}`,
  async execute(args, ctx) {
    const path = resolve(ctx.cwd, asString(args, 'path'));
    const oldString = asString(args, 'old_string');
    const newString = asString(args, 'new_string');
    const replaceAll = args.replace_all === true;
    if (!existsSync(path)) throw new ToolError(`file not found: ${path}`);
    if (oldString === newString) throw new ToolError('old_string and new_string are identical');

    const original = readFileSync(path, 'utf-8');
    const occurrences = original.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new ToolError(
        'old_string not found in file. Re-read the file to get the exact current content (watch whitespace/indentation).',
      );
    }
    if (occurrences > 1 && !replaceAll) {
      throw new ToolError(
        `old_string matches ${occurrences} locations. Provide more surrounding context to make it unique, or set replace_all: true.`,
      );
    }

    const updated = replaceAll
      ? original.split(oldString).join(newString)
      : original.replace(oldString, newString);
    writeFileSync(path, updated);
    return `edited ${path} (${occurrences} replacement${occurrences > 1 ? 's' : ''})`;
  },
};
