import { describe, it, expect } from 'vitest';
import { InputQueue } from '../src/queue.js';

describe('InputQueue', () => {
  it('busy 期间 enqueue 返回排队序号', async () => {
    const q = new InputQueue();
    expect(q.busy).toBe(false);
    const positions: number[] = [];
    await q.run('a', async () => {
      expect(q.busy).toBe(true);
      positions.push(q.enqueue('b'), q.enqueue('c'));
      return true; // 中断，丢弃 b/c
    });
    expect(positions).toEqual([1, 2]);
    expect(q.size).toBe(0);
    expect(q.busy).toBe(false);
  });

  it('run 按 FIFO 顺序执行首条和队列中的输入', async () => {
    const q = new InputQueue();
    const ran: string[] = [];
    const nexts: string[] = [];
    await q.run(
      'a',
      async (input) => {
        ran.push(input);
        if (input === 'a') {
          // 执行期间到达的新输入
          q.enqueue('b');
          q.enqueue('c');
        }
        return false;
      },
      { onNext: (input, remaining) => nexts.push(`${input}:${remaining}`) },
    );
    expect(ran).toEqual(['a', 'b', 'c']);
    expect(nexts).toEqual(['b:1', 'c:0']);
    expect(q.busy).toBe(false);
  });

  it('中断时丢弃剩余队列并回调 onDrop', async () => {
    const q = new InputQueue();
    const ran: string[] = [];
    let dropped = 0;
    await q.run(
      'a',
      async (input) => {
        ran.push(input);
        if (input === 'a') {
          q.enqueue('b');
          q.enqueue('c');
          return true;
        }
        return false;
      },
      { onDrop: (n) => (dropped = n) },
    );
    expect(ran).toEqual(['a']);
    expect(dropped).toBe(2);
    expect(q.size).toBe(0);
    expect(q.busy).toBe(false);
  });

  it('中断发生在最后一条时不再回调 onDrop', async () => {
    const q = new InputQueue();
    let drops = 0;
    await q.run('a', async () => true, { onDrop: () => drops++ });
    expect(drops).toBe(0);
  });

  it('runOne 抛异常时 busy 复位，异常向外传播', async () => {
    const q = new InputQueue();
    await expect(q.run('a', async () => Promise.reject(new Error('boom')))).rejects.toThrow(
      'boom',
    );
    expect(q.busy).toBe(false);
  });

  it('drain 过程中新到达的输入会被接着执行', async () => {
    const q = new InputQueue();
    const ran: string[] = [];
    await q.run('a', async (input) => {
      ran.push(input);
      if (input === 'b') q.enqueue('d'); // b 执行时又有输入到达
      if (input === 'a') q.enqueue('b');
      return false;
    });
    expect(ran).toEqual(['a', 'b', 'd']);
  });
});
