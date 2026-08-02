import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, readConfigFile, resolveProfile } from '../src/config.js';

const ENV_KEYS = [
  'MOSS_HOME',
  'MOONSHOT_API_KEY',
  'API_KEY',
  'BASE_URL',
  'MODEL',
  'DEEPSEEK_API_KEY',
] as const;

let home: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), 'moss-config-test-'));
  process.env.MOSS_HOME = home;
  process.env.MOONSHOT_API_KEY = 'environment-value';
  delete process.env.API_KEY;
  delete process.env.BASE_URL;
  delete process.env.MODEL;
  delete process.env.DEEPSEEK_API_KEY;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(home, { recursive: true, force: true });
});

function writeConfigFile(content: string): void {
  writeFileSync(join(home, 'config.json'), content);
}

describe('readConfigFile', () => {
  it('returns empty config when the file does not exist', () => {
    expect(readConfigFile()).toEqual({});
  });

  it('parses a valid config file', () => {
    writeConfigFile(
      JSON.stringify({
        default: 'k2.7',
        models: { 'k2.7': { model: 'kimi-k2.7-code-preview' } },
      }),
    );
    const file = readConfigFile();
    expect(file.default).toBe('k2.7');
    expect(file.models?.['k2.7']).toEqual({ model: 'kimi-k2.7-code-preview' });
  });

  it('returns empty config on malformed JSON without throwing', () => {
    writeConfigFile('{ not json');
    expect(readConfigFile()).toEqual({});
  });
});

describe('resolveProfile', () => {
  const defaults = { baseURL: 'https://api.moonshot.cn/v1', apiKey: 'default-value' };

  it('treats an unknown name as a raw model id with defaults', () => {
    expect(resolveProfile('some-model', {}, defaults)).toEqual({
      model: 'some-model',
      baseURL: defaults.baseURL,
      apiKey: 'default-value',
    });
  });

  it('falls back to defaults for fields the profile omits', () => {
    const r = resolveProfile('a', { a: { model: 'm1' } }, defaults);
    expect(r).toEqual({
      model: 'm1',
      baseURL: defaults.baseURL,
      apiKey: 'default-value',
      profileName: 'a',
    });
  });

  it('uses the profile baseURL while keeping credentials in environment variables', () => {
    const r = resolveProfile(
      'ds',
      { ds: { model: 'deepseek-chat', baseURL: 'https://api.deepseek.com/v1' } },
      defaults,
    );
    expect(r.baseURL).toBe('https://api.deepseek.com/v1');
    expect(r.apiKey).toBe('default-value');
  });

  it('reads credentials from the configured environment variable', () => {
    process.env.DEEPSEEK_API_KEY = 'environment-profile-value';
    const profiles = {
      a: { model: 'm1', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    };
    expect(resolveProfile('a', profiles, defaults).apiKey).toBe('environment-profile-value');
  });
});

describe('loadConfig', () => {
  it('keeps the built-in default when there is no config file', () => {
    const c = loadConfig({});
    expect(c.model).toBe('kimi-k2.7-code-preview');
    expect(c.profileName).toBeUndefined();
    expect(c.profiles).toEqual({});
    expect(c.apiKey).toBe('environment-value');
  });

  it('uses the config file default profile when no -m/MODEL is given', () => {
    process.env.DEEPSEEK_API_KEY = 'environment-profile-value';
    writeConfigFile(
      JSON.stringify({
        default: 'ds',
        models: {
          ds: {
            model: 'deepseek-chat',
            baseURL: 'https://api.deepseek.com/v1',
            apiKeyEnv: 'DEEPSEEK_API_KEY',
          },
        },
      }),
    );
    const c = loadConfig({});
    expect(c.model).toBe('deepseek-chat');
    expect(c.baseURL).toBe('https://api.deepseek.com/v1');
    expect(c.apiKey).toBe('environment-profile-value');
    expect(c.profileName).toBe('ds');
  });

  it('-m with a profile name resolves the profile, raw id still works', () => {
    writeConfigFile(
      JSON.stringify({
        models: { fast: { model: 'kimi-k2.7-code-highspeed' } },
      }),
    );
    const byProfile = loadConfig({ model: 'fast' });
    expect(byProfile.model).toBe('kimi-k2.7-code-highspeed');
    expect(byProfile.profileName).toBe('fast');
    expect(byProfile.apiKey).toBe('environment-value');

    const byRawId = loadConfig({ model: 'kimi-k2.7-code-highspeed' });
    expect(byRawId.model).toBe('kimi-k2.7-code-highspeed');
    expect(byRawId.profileName).toBeUndefined();
  });

  it('respects the MODEL env var between -m and config default', () => {
    writeConfigFile(JSON.stringify({ default: 'nope', models: { nope: { model: 'm-x' } } }));
    process.env.MODEL = 'env-model';
    expect(loadConfig({}).model).toBe('env-model');
    expect(loadConfig({ model: 'cli-model' }).model).toBe('cli-model');
  });
});
