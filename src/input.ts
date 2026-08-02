/**
 * stdin 行输入的唯一分发点。
 * 背景：权限确认曾自建 readline，导致一行输入被确认框和主 REPL 同时消费，
 * 并发 runTurn 把 user 消息插进 assistant(tool_calls) 与其 tool 结果之间，API 400 且会话被永久污染。
 * 现在 REPL 持有唯一 readline，line 事件统一走 dispatchLine 进入主循环。
 */

type LineHandler = (line: string) => void;

let mainHandler: LineHandler | null = null;

/** REPL 创建主 readline 后挂接；handler 即主循环（任务 / slash 命令处理） */
export function attachMainReadline(handler: LineHandler): void {
  mainHandler = handler;
}

/** 主 readline 的 line 事件统一入口 */
export function dispatchLine(line: string): void {
  mainHandler?.(line);
}
