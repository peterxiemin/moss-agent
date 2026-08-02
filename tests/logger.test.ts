import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { log, logFilePath, setLogLevel } from '../src/logger.js';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'moss-log-test-'));
  process.env.MOSS_HOME = home;
  setLogLevel('debug');
});

afterEach(() => {
  delete process.env.MOSS_HOME;
  rmSync(home, { recursive: true, force: true });
});

function readLog(): string {
  return readFileSync(logFilePath(), 'utf-8');
}

describe('logger', () => {
  it('writes formatted lines to the dated log file under MOSS_HOME', () => {
    log.info('hello', { a: 1 });
    expect(logFilePath().startsWith(join(home, 'logs'))).toBe(true);
    expect(readLog()).toMatch(/\[INFO ?\] hello \{"a":1\}\n$/);
    expect(statSync(logFilePath()).mode & 0o777).toBe(0o600);
  });

  it('filters messages below the minimum level', () => {
    setLogLevel('warn');
    log.debug('nope-debug');
    log.info('nope-info');
    log.warn('yes-warn');
    const content = readLog();
    expect(content).not.toContain('nope');
    expect(content).toContain('yes-warn');
  });

  it('logs Error objects with stack and message', () => {
    log.error('boom', new Error('kaput'));
    const content = readLog();
    expect(content).toContain('[ERROR');
    expect(content).toContain('boom');
    expect(content).toContain('kaput');
  });

  it('"none" disables writing entirely', () => {
    setLogLevel('none');
    log.error('silent');
    expect(existsSync(logFilePath())).toBe(false);
  });

  it('ignores invalid level in setLogLevel', () => {
    setLogLevel('bogus');
    log.debug('still-debug');
    expect(readLog()).toContain('still-debug');
  });
});
