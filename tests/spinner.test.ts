import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Spinner } from '../src/ui.js';

// Spinner 依赖 process.stdout.isTTY 与 write：测试里把 stdout 伪造成 TTY 并捕获输出
describe('Spinner', () => {
  let written: string[];
  let writeSpy: ReturnType<typeof vi.spyOn>;

  const setTTY = (value: boolean) => {
    Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
  };

  beforeEach(() => {
    written = [];
    writeSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: unknown): boolean => {
        written.push(String(chunk));
        return true;
      });
    setTTY(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    writeSpy.mockRestore();
    vi.useRealTimers();
    delete (process.stdout as unknown as { isTTY?: boolean }).isTTY;
  });

  it('启动后立即渲染一帧，并按 100ms 间隔推进', () => {
    const s = new Spinner();
    s.start('等待模型响应');
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^\r/);
    expect(written[0]).toContain('等待模型响应');
    expect(written[0]).toContain('(0s)');
    vi.advanceTimersByTime(500);
    expect(written).toHaveLength(6);
    s.stop();
  });

  it('帧字符循环变化，秒数随时间更新', () => {
    const s = new Spinner();
    s.start('loading');
    vi.advanceTimersByTime(2100);
    expect(written[written.length - 1]).toContain('(2s)');
    // 相邻两帧的旋转字符不同
    expect(written[0]).not.toBe(written[1]);
    s.stop();
  });

  it('stop 清行且幂等，之后不再渲染', () => {
    const s = new Spinner();
    s.start('x');
    s.stop();
    expect(written[written.length - 1]).toBe('\r\x1b[K');
    const n = written.length;
    vi.advanceTimersByTime(500);
    expect(written).toHaveLength(n);
    s.stop();
    expect(written).toHaveLength(n);
  });

  it('非 TTY 下完全不输出', () => {
    setTTY(false);
    const s = new Spinner();
    s.start('x');
    vi.advanceTimersByTime(500);
    expect(written).toEqual([]);
    s.stop();
    expect(written).toEqual([]);
  });

  it('重复 start 会先停掉上一个再重绘', () => {
    const s = new Spinner();
    s.start('a');
    s.start('b');
    expect(written.some((w) => w === '\r\x1b[K')).toBe(true);
    expect(written[written.length - 1]).toContain('b');
    vi.advanceTimersByTime(200);
    expect(written[written.length - 1]).toContain('b');
    s.stop();
  });

  it('stop 后再 start 可以重新开始', () => {
    const s = new Spinner();
    s.start('a');
    s.stop();
    s.start('c');
    expect(written[written.length - 1]).toContain('c');
    s.stop();
  });
});
