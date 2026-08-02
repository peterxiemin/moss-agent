import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSystemPrompt } from '../src/prompt.js';
import { logFilePath } from '../src/logger.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'moss-prompt-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('buildSystemPrompt', () => {
  it('includes the working directory in the base prompt', () => {
    expect(buildSystemPrompt(dir)).toContain(`Working directory: ${dir}`);
  });

  it('tells moss where its own log file is', () => {
    const prompt = buildSystemPrompt(dir);
    expect(prompt).toContain('# Self diagnostics');
    expect(prompt).toContain(logFilePath());
  });

  it('omits the AGENTS.md section when the file does not exist', () => {
    const prompt = buildSystemPrompt(dir);
    expect(prompt).not.toContain('# Project instructions');
  });

  it('appends AGENTS.md content under a dedicated section', () => {
    writeFileSync(join(dir, 'AGENTS.md'), 'Always run npm test after changes.');
    const prompt = buildSystemPrompt(dir);
    expect(prompt).toContain('# Project instructions (AGENTS.md)');
    expect(prompt).toContain('Always run npm test after changes.');
  });

  it('omits the section when AGENTS.md is empty', () => {
    writeFileSync(join(dir, 'AGENTS.md'), '   \n');
    expect(buildSystemPrompt(dir)).not.toContain('# Project instructions');
  });

  it('silently ignores unreadable AGENTS.md (e.g. it is a directory)', () => {
    mkdirSync(join(dir, 'AGENTS.md'));
    const prompt = buildSystemPrompt(dir);
    expect(prompt).not.toContain('# Project instructions');
  });
});
