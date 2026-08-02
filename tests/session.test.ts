import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { SessionStore, mossHome } from '../src/session.js';
import { Agent } from '../src/agent.js';
import type { Config } from '../src/config.js';

const msg = (role: 'user' | 'assistant', content: string): ChatCompletionMessageParam => ({
  role,
  content,
});

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'moss-test-'));
  process.env.MOSS_HOME = home;
});

afterEach(() => {
  delete process.env.MOSS_HOME;
  rmSync(home, { recursive: true, force: true });
});

describe('mossHome', () => {
  it('respects MOSS_HOME env', () => {
    expect(mossHome()).toBe(home);
  });
});

describe('SessionStore', () => {
  it('creates a session file with a meta first line', () => {
    const s = SessionStore.create('/tmp/proj', 'test-model');
    expect(existsSync(s.meta.file)).toBe(true);
    const firstLine = readFileSync(s.meta.file, 'utf-8').split('\n')[0];
    expect(JSON.parse(firstLine)).toMatchObject({
      type: 'meta',
      cwd: '/tmp/proj',
      model: 'test-model',
    });
    expect(s.meta.id.length).toBeGreaterThan(8);
    expect(statSync(s.meta.file).mode & 0o777).toBe(0o600);
  });

  it('roundtrips messages through append + load', () => {
    const s = SessionStore.create('/tmp/proj', 'm');
    s.appendMessage(msg('user', 'hello'));
    s.appendMessage(msg('assistant', 'hi'));
    const { store, messages } = SessionStore.load(s.meta.file);
    expect(messages).toEqual([msg('user', 'hello'), msg('assistant', 'hi')]);
    expect(store.meta.cwd).toBe('/tmp/proj');
    expect(store.meta.id).toBe(s.meta.id);
  });

  it('reset replaces the whole history on load', () => {
    const s = SessionStore.create('/tmp/proj', 'm');
    s.appendMessage(msg('user', 'a'));
    s.appendMessage(msg('user', 'b'));
    s.reset([msg('user', 'compacted')]);
    s.appendMessage(msg('assistant', 'c'));
    const { messages } = SessionStore.load(s.meta.file);
    expect(messages).toEqual([msg('user', 'compacted'), msg('assistant', 'c')]);
  });

  it('keeps appending to the same file after load (resume)', () => {
    const s = SessionStore.create('/tmp/proj', 'm');
    s.appendMessage(msg('user', 'a'));
    const { store } = SessionStore.load(s.meta.file);
    store.appendMessage(msg('user', 'b'));
    expect(SessionStore.load(s.meta.file).messages).toEqual([msg('user', 'a'), msg('user', 'b')]);
  });

  it('tolerates a half-written trailing line', () => {
    const s = SessionStore.create('/tmp/proj', 'm');
    s.appendMessage(msg('user', 'a'));
    appendFileSync(s.meta.file, '{"type":"message","mess');
    expect(SessionStore.load(s.meta.file).messages).toEqual([msg('user', 'a')]);
  });

  it('finds a session by id prefix', () => {
    const a = SessionStore.create('/tmp/a', 'm');
    SessionStore.create('/tmp/b', 'm');
    const found = SessionStore.find(a.meta.id.slice(0, -2));
    expect(found?.store.meta.id).toBe(a.meta.id);
    expect(SessionStore.find('no-such-id')).toBeUndefined();
  });

  it('latest returns the most recent session for the cwd only', async () => {
    SessionStore.create('/tmp/proj', 'm');
    await new Promise((r) => setTimeout(r, 5)); // 保证 createdAt 不同（毫秒精度）
    const newer = SessionStore.create('/tmp/proj', 'm');
    SessionStore.create('/tmp/other', 'm');
    const found = SessionStore.latest('/tmp/proj');
    expect(found?.store.meta.id).toBe(newer.meta.id);
    expect(SessionStore.latest('/tmp/none')).toBeUndefined();
  });

  it('lists sessions newest first', async () => {
    const first = SessionStore.create('/tmp/a', 'm');
    await new Promise((r) => setTimeout(r, 5));
    const second = SessionStore.create('/tmp/b', 'm');
    const list = SessionStore.list();
    expect(list.map((m) => m.id)).toEqual([second.meta.id, first.meta.id]);
  });
});

describe('Agent + session integration', () => {
  const testConfig: Config = {
    apiKey: 'unit-test-value',
    baseURL: 'http://localhost',
    model: 'test-model',
    autoYes: true,
    maxTurns: 1,
    bashTimeoutMs: 1000,
    contextTokenBudget: 100_000,
  };

  it('logs the system prompt on a fresh session so the file is self-contained', () => {
    const store = SessionStore.create('/tmp/proj', 'm');
    new Agent(testConfig, { session: store });
    const { messages } = SessionStore.load(store.meta.file);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
  });

  it('does not re-log when resuming restored messages', () => {
    const store = SessionStore.create('/tmp/proj', 'm');
    const restored: ChatCompletionMessageParam[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ];
    new Agent(testConfig, { session: store, messages: restored });
    const { messages } = SessionStore.load(store.meta.file);
    expect(messages).toHaveLength(0); // 文件里只有 meta 行，没有重复写入
  });
});
