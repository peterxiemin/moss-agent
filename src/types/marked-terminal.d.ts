// marked-terminal@7 未自带类型，@types/marked-terminal 停留在 v6 且签名不符，这里按 v7 实际 API 声明
declare module 'marked-terminal' {
  import type { MarkedExtension } from 'marked';

  export interface TerminalRendererOptions {
    width?: number;
    reflowText?: boolean;
    [key: string]: unknown;
  }

  export function markedTerminal(
    options?: TerminalRendererOptions,
    highlightOptions?: Record<string, unknown>,
  ): MarkedExtension;

  const Renderer: unknown;
  export default Renderer;
}
