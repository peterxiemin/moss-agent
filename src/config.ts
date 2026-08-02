import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mossHome } from './session.js';

/** 极简 .env 加载（避免额外依赖） */
function loadDotEnv(): void {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    const key = m[1];
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

/** ~/.moss/config.json 中单个模型配置：model 必填，其余缺省沿用环境变量默认 */
export interface ModelProfile {
  /** 真实模型 ID */
  model: string;
  /** 缺省沿用 BASE_URL 环境变量或 Moonshot 默认端点 */
  baseURL?: string;
  /** 指向某个环境变量名；凭据不会写进配置文件 */
  apiKeyEnv?: string;
}

/** ~/.moss/config.json 的结构 */
export interface ConfigFile {
  /** 默认使用的 models 配置名 */
  default?: string;
  models?: Record<string, ModelProfile>;
}

/** 读取 ~/.moss/config.json；文件缺失返回空配置，损坏则警告并忽略 */
export function readConfigFile(): ConfigFile {
  const path = join(mossHome(), 'config.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as ConfigFile;
  } catch (err) {
    console.error(
      `Warning: ${path} 解析失败，已忽略：${err instanceof Error ? err.message : String(err)}`,
    );
    return {};
  }
}

export interface ResolvedModel {
  model: string;
  baseURL: string;
  apiKey: string;
  /** 命中的配置名；按裸模型 ID 解析时为 undefined */
  profileName?: string;
}

/**
 * 把用户输入（配置名或裸模型 ID）解析为生效的 model/baseURL/apiKey。
 * 命中 profiles 中的配置名时从 apiKeyEnv 或默认环境变量读取凭据，
 * 否则按裸模型 ID + 默认端点/key 处理（向后兼容）。
 */
export function resolveProfile(
  name: string,
  profiles: Record<string, ModelProfile>,
  defaults: { baseURL: string; apiKey: string },
): ResolvedModel {
  const profile = profiles[name];
  if (!profile) {
    return { model: name, baseURL: defaults.baseURL, apiKey: defaults.apiKey };
  }
  return {
    model: profile.model,
    baseURL: profile.baseURL ?? defaults.baseURL,
    apiKey: (profile.apiKeyEnv ? process.env[profile.apiKeyEnv] : undefined) ?? defaults.apiKey,
    profileName: name,
  };
}

export interface Config {
  apiKey: string;
  baseURL: string;
  model: string;
  /** 当前使用的配置名（裸模型 ID 启动时为 undefined） */
  profileName?: string;
  /** config.json 中配置的全部模型 profile */
  profiles: Record<string, ModelProfile>;
  /** profile 未指定 baseURL/apiKeyEnv 时的默认值（来自环境变量） */
  defaults: { baseURL: string; apiKey: string };
  /** 自动批准所有写操作和命令执行 */
  autoYes: boolean;
  /** agent loop 最大轮数（防止失控） */
  maxTurns: number;
  /** bash 默认超时（毫秒） */
  bashTimeoutMs: number;
  /** 上下文 token 预算，超过则触发压缩（K2.7 为 256K，预留输出空间） */
  contextTokenBudget: number;
}

const DEFAULT_MODEL = 'kimi-k2.7-code-preview';

export function loadConfig(opts: { yes?: boolean; model?: string; maxTurns?: number }): Config {
  const defaults = {
    apiKey: process.env.MOONSHOT_API_KEY ?? process.env.API_KEY ?? '',
    baseURL: process.env.BASE_URL ?? 'https://api.moonshot.cn/v1',
  };
  const file = readConfigFile();
  const profiles = file.models ?? {};

  // 优先级：-m > MODEL 环境变量 > config.json default > 内置默认
  const requested = opts.model ?? process.env.MODEL ?? file.default ?? DEFAULT_MODEL;
  const resolved = resolveProfile(requested, profiles, defaults);

  if (!resolved.apiKey) {
    console.error(
      'Error: 未找到 API key。请设置 MOONSHOT_API_KEY 环境变量，或在项目根目录创建 .env（参考 .env.example），或在 ~/.moss/config.json 中为该模型配置 apiKeyEnv',
    );
    process.exit(1);
  }
  return {
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
    model: resolved.model,
    profileName: resolved.profileName,
    profiles,
    defaults,
    autoYes: opts.yes ?? false,
    maxTurns: opts.maxTurns ?? 40,
    bashTimeoutMs: 30_000,
    contextTokenBudget: 200_000,
  };
}
