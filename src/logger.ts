import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mossHome } from './session.js';

/**
 * 文件日志：写入 ~/.moss/logs/moss-YYYY-MM-DD.log（按本地日期分文件）。
 * 用于部署后排查问题：终端 UI 保持简洁，细节全部落盘。
 * 任何写入失败都静默吞掉，绝不影响主流程。
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel | 'none', number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

function parseLevel(v?: string): LogLevel | 'none' | undefined {
  const s = v?.trim().toLowerCase();
  return s && s in LEVELS ? (s as LogLevel | 'none') : undefined;
}

/** 当前最低级别：默认 debug，可用 MOSS_LOG_LEVEL 或 --log-level 覆盖 */
let minLevel: number = LEVELS[parseLevel(process.env.MOSS_LOG_LEVEL) ?? 'debug'];

/** CLI --log-level 覆盖（非法值忽略，保持当前级别） */
export function setLogLevel(level: string): void {
  const parsed = parseLevel(level);
  if (parsed !== undefined) minLevel = LEVELS[parsed];
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 当日志文件路径 */
export function logFilePath(): string {
  return join(mossHome(), 'logs', `moss-${dateStamp()}.log`);
}

/** data 序列化上限，避免超长工具参数/结果撑爆单行 */
const MAX_DATA_LEN = 4000;

function formatData(data: unknown): string {
  let text: string;
  if (data instanceof Error) text = data.stack ?? data.message;
  else if (typeof data === 'string') text = data;
  else text = JSON.stringify(data);
  return text.length > MAX_DATA_LEN
    ? `${text.slice(0, MAX_DATA_LEN)}…(+${text.length - MAX_DATA_LEN} chars)`
    : text;
}

function write(level: LogLevel, msg: string, data?: unknown): void {
  if (LEVELS[level] < minLevel) return;
  try {
    const line =
      `${new Date().toISOString()} [${level.toUpperCase().padEnd(5)}] ${msg}` +
      (data === undefined ? '' : ` ${formatData(data)}`);
    const dir = join(mossHome(), 'logs');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    appendFileSync(logFilePath(), line + '\n', { mode: 0o600 });
  } catch {
    // 日志失败不影响使用
  }
}

export const log = {
  debug: (msg: string, data?: unknown): void => write('debug', msg, data),
  info: (msg: string, data?: unknown): void => write('info', msg, data),
  warn: (msg: string, data?: unknown): void => write('warn', msg, data),
  error: (msg: string, data?: unknown): void => write('error', msg, data),
};
