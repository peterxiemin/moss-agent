import { exec } from 'node:child_process';
import { asNumber, asString, Tool } from './types.js';

const MAX_OUTPUT_CHARS = 30_000;

export const bashTool: Tool = {
  name: 'bash',
  description:
    'Run a shell command and return stdout/stderr plus exit code. Use for builds, tests, git status, running scripts. Has a timeout (default 30s, max 120s). Not for long-running servers.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: {
        type: 'number',
        description: 'Timeout in seconds (default 30, max 120)',
      },
    },
    required: ['command'],
  },
  mutating: true,
  summarize: (args) => `${args.command}`,
  async execute(args, ctx) {
    const command = asString(args, 'command');
    const timeoutSec = Math.min(asNumber(args, 'timeout', 30), 120);
    return new Promise((resolvePromise) => {
      exec(
        command,
        { cwd: ctx.cwd, timeout: timeoutSec * 1000, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          let out = '';
          if (stdout) out += stdout;
          if (stderr) out += (out ? '\n[stderr]\n' : '') + stderr;
          if (out.length > MAX_OUTPUT_CHARS) {
            out =
              out.slice(0, MAX_OUTPUT_CHARS) +
              `\n\n[output truncated at ${MAX_OUTPUT_CHARS} chars]`;
          }
          if (error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed) {
            resolvePromise(`[command timed out after ${timeoutSec}s]\n${out}`.trim());
            return;
          }
          const code =
            error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
          const header = code === 0 ? '' : `[exit code ${code}]\n`;
          resolvePromise((header + (out || '(no output)')).trim());
        },
      );
    });
  },
};
