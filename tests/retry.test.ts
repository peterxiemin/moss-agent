import { describe, it, expect, vi } from 'vitest';
import { withRetry, defaultIsRetryable, isAbortError } from '../src/retry.js';

function apiError(status: number): Error {
  const err = new Error(`status ${status}`);
  (err as { status?: number }).status = status;
  return err;
}

describe('defaultIsRetryable', () => {
  it('retries 429 and 5xx', () => {
    expect(defaultIsRetryable(apiError(429))).toBe(true);
    expect(defaultIsRetryable(apiError(500))).toBe(true);
    expect(defaultIsRetryable(apiError(503))).toBe(true);
  });

  it('does not retry other 4xx', () => {
    expect(defaultIsRetryable(apiError(400))).toBe(false);
    expect(defaultIsRetryable(apiError(401))).toBe(false);
    expect(defaultIsRetryable(apiError(404))).toBe(false);
  });

  it('retries network errors by code or name', () => {
    const reset = new Error('read ECONNRESET');
    (reset as { code?: string }).code = 'ECONNRESET';
    expect(defaultIsRetryable(reset)).toBe(true);

    const conn = new Error('connection failed');
    conn.name = 'APIConnectionError';
    expect(defaultIsRetryable(conn)).toBe(true);
  });

  it('does not retry plain errors', () => {
    expect(defaultIsRetryable(new Error('boom'))).toBe(false);
    expect(defaultIsRetryable('not an error')).toBe(false);
  });
});

describe('isAbortError', () => {
  it('recognizes abort error names', () => {
    const a = new Error('x');
    a.name = 'AbortError';
    expect(isAbortError(a)).toBe(true);
    const b = new Error('x');
    b.name = 'APIUserAbortError';
    expect(isAbortError(b)).toBe(true);
    expect(isAbortError(new Error('x'))).toBe(false);
  });
});

describe('withRetry', () => {
  it('returns on first success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn)).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries retryable errors then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(apiError(429))
      .mockRejectedValueOnce(apiError(500))
      .mockResolvedValue('ok');
    expect(await withRetry(fn, { baseDelayMs: 1 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('gives up after max retries', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(500));
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow('status 500');
    expect(fn).toHaveBeenCalledTimes(3); // 首次 + 2 次重试
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(400));
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('status 400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not retry abort errors', async () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    const fn = vi.fn().mockRejectedValue(aborted);
    await expect(withRetry(fn, { baseDelayMs: 1 })).rejects.toThrow('aborted');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('stops retrying once the signal aborts', async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(apiError(500));
    });
    await expect(withRetry(fn, { baseDelayMs: 1, signal: controller.signal })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports attempts and backoff via onRetry', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValue('ok');
    await withRetry(fn, { baseDelayMs: 5, onRetry });
    expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 5);
  });
});
