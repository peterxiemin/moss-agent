import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// 行内代码/粗体/标题等用 marked-terminal 默认 chalk 样式；
// 围栏代码块的语法高亮由 marked-terminal 内置（cli-highlight，不支持的语言自动回退普通样式）
marked.use(markedTerminal({ width: process.stdout.columns || 80, reflowText: false }));

/** 把 assistant 正文渲染为终端 Markdown（整段渲染，输出以换行结尾） */
export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}
