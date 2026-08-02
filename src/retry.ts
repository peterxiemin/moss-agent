/** 通用重试：指数退避，仅对可重试错误（限流/5xx/网络抖动）生效 */

import { log } from './logger.js';

export interface RetryOptions {
  /** 最大重试次数（不含首次尝试），默认 3 */
  retries?: number;
  /** 首次退避毫秒数，之后按 2 的幂增长，默认 1000 */
  baseDelayMs?: number;
  /** 判断错误是否可重试，默认 defaultIsRetryable */
  isRetryable?: (err: unknown) => boolean;
  /** 每次重试前的回调（用于打印提示） */
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  /** 中断信号；中止后不再重试 */
  signal?: AbortSignal;
}

const RETRYABLE_CODES = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EPIPE',
  'APIConnectionError',
]);

/** 默认可重试判定：HTTP 429 / 5xx，或常见网络错误 */
export function defaultIsRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number') return status === 429 || status >= 500;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && RETRYABLE_CODES.has(code)) return true;
  return RETRYABLE_CODES.has(err.name);
}

/** 是否为中断错误（用户主动 abort，不应重试） */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'AbortError' || err.name === 'APIUserAbortError')
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 1000,
    isRetryable = defaultIsRetryable,
    onRetry,
    signal,
  } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        attempt >= retries ||
        signal?.aborted ||
        isAbortError(err) ||
        !isRetryable(err)
      ) {
        if (!isAbortError(err) && !signal?.aborted) {
          log.error(`请求失败（不再重试，第 ${attempt + 1} 次尝试）`, err);
        }
        throw err;
      }
      const delay = baseDelayMs * 2 ** attempt;
      log.warn(`请求失败，${delay}ms 后重试（第 ${attempt + 1}/${retries} 次）`, err);
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
