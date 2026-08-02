import chalk from 'chalk';

/** thinking 结束摘要（纯函数，便于测试）：内容折叠不展示，只给耗时和长度 */
export function renderThinkingSummary(ms: number, chars: number): string {
  return `✨ thought for ${(ms / 1000).toFixed(1)}s · ${chars} chars`;
}

/** 工具调用摘要折叠（纯函数，便于测试）：压缩为单行，超长截断 */
export function formatToolSummary(summary: string, maxLen = 120): string {
  const oneLine = summary.replace(/\s+/g, ' ').trim();
  return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + '…' : oneLine;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** 静默等待期间的加载提示：旋转字符 + 已等待秒数。仅 TTY 下显示；stop 幂等 */
export class Spinner {
  private timer: NodeJS.Timeout | null = null;
  private frame = 0;
  private text = '';
  private startedAt = 0;

  start(text: string): void {
    if (!process.stdout.isTTY) return;
    this.stop();
    this.text = text;
    this.frame = 0;
    this.startedAt = Date.now();
    this.render();
    this.timer = setInterval(() => this.render(), 100);
    // 不拖住进程：spinner 不是退出前必须完成的工作
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    process.stdout.write('\r\x1b[K');
  }

  private render(): void {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000);
    const frame = SPINNER_FRAMES[this.frame++ % SPINNER_FRAMES.length];
    // \x1b[K 清掉行尾残留（等待期间可能穿插过其他输出）
    process.stdout.write(`\r${chalk.cyan(frame)} ${chalk.dim(this.text)} (${elapsed}s)\x1b[K`);
  }
}

export const ui = {
  spinner: new Spinner(),
  /** thinking 块开始：只显示状态行，内容不逐字输出 */
  thinkingStart(): void {
    console.log('\n' + chalk.dim('💭 thinking'));
  },
  /** thinking 块结束，展示耗时和内容长度（正文折叠） */
  thinkingEnd(ms: number, chars: number): void {
    console.log(chalk.dim(`\n${renderThinkingSummary(ms, chars)}\n`));
  },
  /** 工具调用提示 */
  toolCall(name: string, summary: string): void {
    console.log(
      '\n' + chalk.cyan('● ') + chalk.bold(name) + chalk.gray(` ${formatToolSummary(summary)}`),
    );
  },
  /** 工具结果摘要（树形连接符，与工具调用配对） */
  toolResult(summary: string, isError = false): void {
    const icon = isError ? chalk.red('✗') : chalk.green('✓');
    console.log(`  ${chalk.gray('⎿')}  ${icon} ${chalk.gray(summary)}`);
  },
  info(msg: string): void {
    console.log(chalk.gray(msg));
  },
  warn(msg: string): void {
    console.log(chalk.yellow(msg));
  },
  error(msg: string): void {
    console.log(chalk.red(msg));
  },
  /** 轮次之间的分隔线 */
  rule(): void {
    const width = Math.min(process.stdout.columns || 80, 80);
    console.log(chalk.dim('─'.repeat(width)));
  },
  /** 权限确认标题 */
  permission(title: string): void {
    console.log('\n' + chalk.yellow('⚠ ') + chalk.bold(title));
  },
  todoList(items: { content: string; status: string }[]): void {
    for (const item of items) {
      const mark =
        item.status === 'completed'
          ? chalk.green('☒')
          : item.status === 'in_progress'
            ? chalk.yellow('☐')
            : chalk.gray('☐');
      console.log(`  ${mark} ${item.status === 'completed' ? chalk.strikethrough.gray(item.content) : item.content}`);
    }
  },
};
