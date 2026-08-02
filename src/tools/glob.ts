import fg from 'fast-glob';
import { asString, Tool } from './types.js';

const MAX_RESULTS = 200;
const IGNORE = ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'];

export const globTool: Tool = {
  name: 'glob',
  description:
    'Find files by glob pattern, e.g. "src/**/*.ts", "**/*.test.js". Returns matching paths sorted by modification time (newest first).',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern' },
      path: { type: 'string', description: 'Directory to search in (default: cwd)' },
    },
    required: ['pattern'],
  },
  mutating: false,
  summarize: (args) => `${args.pattern}`,
  async execute(args, ctx) {
    const pattern = asString(args, 'pattern');
    const cwd = args.path ? asString(args, 'path') : ctx.cwd;
    const entries = await fg(pattern, {
      cwd,
      ignore: IGNORE,
      onlyFiles: true,
      stats: true,
      objectMode: true,
    });
    entries.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
    const paths = entries.slice(0, MAX_RESULTS).map((e) => e.path);
    const suffix =
      entries.length > MAX_RESULTS
        ? `\n\n[truncated: ${entries.length} matches, showing first ${MAX_RESULTS}]`
        : '';
    return (paths.length ? paths.join('\n') : '(no matches)') + suffix;
  },
};
