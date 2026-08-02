import readline from 'node:readline';
import chalk from 'chalk';

export interface SelectOption {
  label: string;
  /** 选项右侧的灰色补充说明 */
  hint?: string;
}

/** 纯函数：把选项列表渲染成文本，cursor 行高亮（便于测试） */
export function renderOptions(options: SelectOption[], cursor: number): string {
  return options
    .map((opt, i) => {
      const hint = opt.hint ? chalk.gray(`  ${opt.hint}`) : '';
      if (i === cursor) {
        return chalk.cyan('❯ ') + chalk.bold(opt.label) + hint;
      }
      return '  ' + opt.label + hint;
    })
    .join('\n');
}

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

/**
 * 箭头键选择器：↑/↓ 移动、Enter 确认、Esc 或 Ctrl+C 取消（返回 null）。
 * 调用前调用方需保证 stdin 空闲（REPL 场景先 rl.pause()）；结束后恢复此前的 raw mode。
 * 非 TTY 环境无法交互，直接返回 null。
 */
export function select(title: string, options: SelectOption[]): Promise<number | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY || options.length === 0) return Promise.resolve(null);

  return new Promise((resolve) => {
    let cursor = 0;
    let renderedLines = 0;
    const wasRaw = stdin.isRaw ?? false;

    const render = () => {
      // 清掉上一轮渲染的行，回到起点重绘
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
      const text = chalk.bold(title) + '\n' + renderOptions(options, cursor) + '\n' + chalk.gray('  ↑↓ 移动 · Enter 确认 · Esc 取消');
      process.stdout.write(text + '\n');
      renderedLines = text.split('\n').length;
    };

    const finish = (result: number | null) => {
      stdin.off('keypress', onKeypress);
      if (stdin.isTTY) stdin.setRawMode(wasRaw);
      process.stdout.write(SHOW_CURSOR);
      // 清掉菜单，留一行结果摘要
      process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      if (result !== null) {
        console.log(`${chalk.bold(title)} ${chalk.cyan(options[result].label)}`);
      }
      resolve(result);
    };

    const onKeypress = (_: string, key: { name?: string; ctrl?: boolean }) => {
      if (!key) return;
      if (key.name === 'up') {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
      } else if (key.name === 'down') {
        cursor = (cursor + 1) % options.length;
        render();
      } else if (key.name === 'return') {
        finish(cursor);
      } else if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        finish(null);
      }
    };

    readline.emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    process.stdout.write(HIDE_CURSOR);
    stdin.on('keypress', onKeypress);
    render();
  });
}
