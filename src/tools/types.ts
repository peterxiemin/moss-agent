/** 工具定义与执行框架。每个工具自带 OpenAI function calling 所需的 JSON Schema。 */

export interface ToolContext {
  cwd: string;
  /** 请求权限确认；返回 true 表示用户批准 */
  confirm: (title: string, detail?: string) => Promise<boolean>;
}

export interface Tool {
  name: string;
  description: string;
  /** OpenAI function calling JSON Schema */
  parameters: Record<string, unknown>;
  /** 是否修改状态（需要权限确认） */
  mutating: boolean;
  /** 生成一行调用摘要，展示给用户 */
  summarize: (args: Record<string, unknown>) => string;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

export class ToolError extends Error {}

export function asString(args: Record<string, unknown>, key: string, required = true): string {
  const v = args[key];
  if (v === undefined || v === null) {
    if (required) throw new ToolError(`missing required argument: ${key}`);
    return '';
  }
  if (typeof v !== 'string') throw new ToolError(`argument ${key} must be a string`);
  return v;
}

export function asNumber(
  args: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number') throw new ToolError(`argument ${key} must be a number`);
  return v;
}
