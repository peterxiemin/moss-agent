import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';

/** moss 数据目录：MOSS_HOME 环境变量可覆盖（测试用），默认 ~/.moss */
export function mossHome(): string {
  return process.env.MOSS_HOME || join(homedir(), '.moss');
}

function sessionsDir(): string {
  return join(mossHome(), 'sessions');
}

export interface SessionMeta {
  id: string;
  file: string;
  cwd: string;
  model: string;
  createdAt: string;
}

type SessionLine =
  | { type: 'meta'; cwd: string; model: string; createdAt: string }
  | { type: 'message'; message: ChatCompletionMessageParam }
  | { type: 'reset'; messages: ChatCompletionMessageParam[] };

/**
 * 会话持久化：每个会话一个 JSONL 文件。
 * 首行为 meta；之后每条 message 追加一行；上下文压缩后写一行 reset（替换全部历史）。
 * 加载时顺序回放：message 追加、reset 替换，容忍末尾半行（异常退出导致）。
 */
export class SessionStore {
  private constructor(public readonly meta: SessionMeta) {}

  static create(cwd: string, model: string): SessionStore {
    const dir = sessionsDir();
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const createdAt = new Date().toISOString();
    const stamp = createdAt.slice(0, 19).replace(/[-:T]/g, '');
    const id = `${stamp}-${randomBytes(3).toString('hex')}`;
    const store = new SessionStore({ id, file: join(dir, `${id}.jsonl`), cwd, model, createdAt });
    store.append({ type: 'meta', cwd, model, createdAt });
    return store;
  }

  appendMessage(message: ChatCompletionMessageParam): void {
    this.append({ type: 'message', message });
  }

  /** 上下文压缩/清空后调用，记录全量新历史 */
  reset(messages: ChatCompletionMessageParam[]): void {
    this.append({ type: 'reset', messages });
  }

  private append(line: SessionLine): void {
    const text = JSON.stringify(line) + '\n';
    if (existsSync(this.meta.file)) appendFileSync(this.meta.file, text, { mode: 0o600 });
    else writeFileSync(this.meta.file, text, { mode: 0o600 });
  }

  /** 打开已有会话文件，返回可继续追加的 store 与回放出的消息历史 */
  static load(file: string): { store: SessionStore; messages: ChatCompletionMessageParam[] } {
    const lines = readFileSync(file, 'utf-8').split('\n');
    let metaLine: Extract<SessionLine, { type: 'meta' }> | undefined;
    let messages: ChatCompletionMessageParam[] = [];
    for (const raw of lines) {
      if (!raw.trim()) continue;
      let line: SessionLine;
      try {
        line = JSON.parse(raw) as SessionLine;
      } catch {
        continue; // 容忍半行/坏行
      }
      if (line.type === 'meta') metaLine = line;
      else if (line.type === 'message') messages.push(line.message);
      else if (line.type === 'reset') messages = line.messages;
    }
    const id = file.split('/').pop()!.replace(/\.jsonl$/, '');
    const store = new SessionStore({
      id,
      file,
      cwd: metaLine?.cwd ?? '',
      model: metaLine?.model ?? '',
      createdAt: metaLine?.createdAt ?? '',
    });
    return { store, messages };
  }

  /** 列出全部会话，按创建时间倒序 */
  static list(): SessionMeta[] {
    const dir = sessionsDir();
    if (!existsSync(dir)) return [];
    const metas: SessionMeta[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      const file = join(dir, name);
      try {
        const firstLine = readFileSync(file, 'utf-8').split('\n', 1)[0];
        const parsed = JSON.parse(firstLine) as SessionLine;
        if (parsed.type !== 'meta') continue;
        metas.push({
          id: name.replace(/\.jsonl$/, ''),
          file,
          cwd: parsed.cwd,
          model: parsed.model,
          createdAt: parsed.createdAt,
        });
      } catch {
        continue;
      }
    }
    return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** 按 id 前缀查找并加载 */
  static find(idPrefix: string): { store: SessionStore; messages: ChatCompletionMessageParam[] } | undefined {
    const meta = this.list().find((m) => m.id.startsWith(idPrefix));
    return meta ? this.load(meta.file) : undefined;
  }

  /** 指定目录下最近的一次会话 */
  static latest(cwd: string): { store: SessionStore; messages: ChatCompletionMessageParam[] } | undefined {
    const meta = this.list().find((m) => m.cwd === cwd);
    return meta ? this.load(meta.file) : undefined;
  }
}
