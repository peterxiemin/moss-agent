/**
 * REPL 输入排队：任务执行中（busy）到达的输入进入 FIFO 队列，
 * 当前输入执行完后按序自动执行；被 Esc 中断时丢弃剩余队列，
 * 避免方向已变时还继续自动执行。
 */

export interface QueueEvents {
  /** 开始执行队列中的下一条（remaining 为之后还剩的条数） */
  onNext?: (input: string, remaining: number) => void;
  /** 中断导致丢弃剩余排队输入 */
  onDrop?: (dropped: number) => void;
}

export class InputQueue {
  private items: string[] = [];
  /** 是否有输入正在执行（busy 期间的输入应走 enqueue） */
  busy = false;

  /** busy 期间入队，返回排队序号（第几条）。调用方需先判断 busy */
  enqueue(input: string): number {
    this.items.push(input);
    return this.items.length;
  }

  get size(): number {
    return this.items.length;
  }

  /**
   * 执行首条输入并依序 drain 队列。
   * runOne 返回 true 表示被用户中断：丢弃剩余队列，不再自动执行。
   */
  async run(
    first: string,
    runOne: (input: string) => Promise<boolean>,
    events: QueueEvents = {},
  ): Promise<void> {
    this.busy = true;
    try {
      let current: string | undefined = first;
      while (current !== undefined) {
        const interrupted = await runOne(current);
        if (interrupted) {
          if (this.items.length > 0) events.onDrop?.(this.items.length);
          this.items.length = 0;
          return;
        }
        current = this.items.shift();
        if (current !== undefined) events.onNext?.(current, this.items.length);
      }
    } finally {
      this.busy = false;
    }
  }
}
