# moss-agent

一个简化版 Claude Code：终端里的 AI 编码 agent，默认由 **Kimi K2.7 Code**（`kimi-k2.7-code-preview`）驱动，OpenAI 兼容协议，可切换到任意兼容 API（DeepSeek、OpenAI 等）。

## 能力

- **Agent loop**：模型自主规划 → 调用工具 → 观察结果 → 迭代，直到任务完成（默认最多 40 轮防失控）
- **7 个工具**：`read_file` / `write_file` / `edit_file`（精确替换）/ `bash` / `glob` / `grep` / `todo`
- **权限系统**：写文件/改文件展示带行号的彩色 diff、执行命令回显，箭头键选择器逐条确认（允许一次/本会话总是允许/拒绝）；`-y` 全自动
- **Markdown 渲染**：正文按 Markdown 渲染（标题/列表/行内代码），围栏代码块语法高亮
- **Thinking 展示**：推理过程折叠为一行状态，结束后显示耗时与内容长度
- **上下文管理**：超长工具结果截断 + 接近 256K 预算时自动总结压缩（也可 `/compact` 手动触发）
- **健壮性**：限流/5xx/网络错误指数退避重试；REPL 中按 Esc 中断当前任务；bash 命令带超时
- **会话持久化**：对话以 JSONL 实时落盘（`~/.moss/sessions/`），`moss -c` 继续上次会话，`moss -r <id>` 恢复指定会话
- **文件日志**：运行细节与报错堆栈落盘到 `~/.moss/logs/`（按天分文件），`--log-level` 控制级别
- **两种模式**：单条命令 / 交互 REPL（支持 slash 命令与历史记录；等待时显示加载指示，执行中输入自动排队）

## 快速开始

```bash
git clone https://github.com/peterxiemin/moss-agent.git
cd moss-agent
npm install

# 在本地配置凭据（不要提交 .env）
cp .env.example .env

# 单条命令模式
npm run dev -- "给这个项目写一个 .gitignore"

# 交互模式
npm run dev
```

## 使用

```bash
moss "修复 src/auth.ts 里的类型错误并跑测试"   # 一次性任务
moss                                            # REPL 持续对话
moss -y "重构 utils 目录"                        # 自动批准（谨慎）
moss -m kimi-k2.7-code-highspeed "..."          # 高速版模型
moss -m deepseek "..."                          # 使用 config.json 中名为 deepseek 的模型配置
moss -c                                         # 继续当前目录最近一次会话
moss -r 20260718101132-b5                       # 恢复指定 id 的会话（前缀即可）
```

REPL 内的 slash 命令：

```
/help            显示帮助
/clear           清空对话历史
/compact         立即压缩上下文
/model [名称]    切换模型（无参数时弹出列表选择；可给 config.json 配置名或模型 ID）
/cost            查看 token 用量
/sessions        列出最近会话
/exit            退出（执行中按 Esc 中断当前任务）
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `MOONSHOT_API_KEY` | — | 必填 |
| `BASE_URL` | `https://api.moonshot.cn/v1` | 换任意 OpenAI 兼容端点 |
| `MODEL` | `kimi-k2.7-code-preview` | 模型 ID |
| `MOSS_HOME` | `~/.moss` | 会话、REPL 历史与日志存储目录 |
| `MOSS_LOG_LEVEL` | `debug` | 文件日志级别：`debug`/`info`/`warn`/`error`/`none` |

## 多模型配置

在 `~/.moss/config.json` 里可以预先配置多个模型（文件可选，缺失时行为不变）：

```json
{
  "default": "k2.7",
  "models": {
    "k2.7":      { "model": "kimi-k2.7-code-preview" },
    "k2.7-fast": { "model": "kimi-k2.7-code-highspeed" },
    "deepseek":  { "model": "deepseek-chat", "baseURL": "https://api.deepseek.com/v1", "apiKeyEnv": "DEEPSEEK_API_KEY" },
    "gpt":       { "model": "gpt-4o", "baseURL": "https://api.openai.com/v1", "apiKeyEnv": "OPENAI_API_KEY" }
  }
}
```

- 每个配置以名字引用：`moss -m deepseek "..."` 或 REPL 里 `/model deepseek`；`/model` 不带参数弹出箭头键选择列表（Enter 切换，Esc 取消）
- 凭据只从环境变量读取，不支持把真实值内联写入 `config.json`
- `baseURL`/`apiKeyEnv` 可省略，缺省沿用 `BASE_URL`/`MOONSHOT_API_KEY`
- `default` 指定启动时的默认配置；优先级：`-m` > `MODEL` 环境变量 > `default` > 内置默认模型
- 不匹配任何配置名的输入按裸模型 ID 处理（沿用默认端点），与旧行为一致

## 日志

运行信息写入 `~/.moss/logs/moss-YYYY-MM-DD.log`（按本地日期分文件，启动时会打印具体路径）。日志不会记录用户输入原文、工具参数或工具结果；日志、会话和 REPL 历史文件均以仅当前用户可读写的权限创建。

```bash
tail -f ~/.moss/logs/moss-$(date +%F).log   # 一边试用一边看日志
moss --log-level error                       # 只记错误
```

## 安全边界

- Bash 与文件写操作默认逐次请求确认；不使用基于命令前缀的免确认白名单，避免管道或命令拼接绕过。
- `-y` 会自动批准所有写操作和命令，仅应在隔离、可信的工作目录中使用。
- `.env`、日志、构建产物和本地会话均被 `.gitignore` 排除；不要把凭据写进提示词、代码或 Git 历史。
- 模型仍会读取任务所需的项目内容并发送给配置的模型服务，请只在你信任的代码和服务端点上运行。

## 架构

```
src/
  cli.ts          # 入口：commander + REPL + slash 命令 + Esc 中断
  agent.ts        # agent loop：流式请求（带重试）→ 工具执行 → 迭代
  config.ts       # 配置加载：.env、环境变量、~/.moss/config.json（多模型配置）
  prompt.ts       # system prompt
  context.ts      # token 估算、截断、自动压缩
  session.ts      # 会话持久化（JSONL 落盘与恢复）
  logger.ts       # 文件日志（~/.moss/logs/，按天分文件）
  retry.ts        # 通用重试（指数退避）
  permissions.ts  # 权限确认 + 带行号的彩色 diff
  input.ts        # stdin 行输入唯一分发点：REPL 的 line 事件统一入口，避免输入被多处消费
  markdown.ts     # assistant 正文的终端 Markdown 渲染（marked + marked-terminal）
  ui.ts           # 终端输出原语
  tools/          # 7 个工具，每个一个文件
```

## 明确不做（保持简单）

subagent / workflow / hook / 插件系统 / MCP / Web UI

## License

[MIT](LICENSE) © [peterxiemin](https://github.com/peterxiemin)
