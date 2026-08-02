import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import chalk from 'chalk';
import { createTwoFilesPatch } from 'diff';
import { select } from './select.js';

const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_LINES = 60;

/**
 * 生成权限确认用的展示内容。
 * edit_file / write_file 展示彩色 diff；bash 展示命令本身。
 */
export function buildPermissionDetail(
  toolName: string,
  args: Record<string, unknown>,
  cwd: string,
): string {
  if (toolName === 'bash') {
    return `$ ${args.command}`;
  }
  const path = resolve(cwd, String(args.path ?? ''));
  if (toolName === 'write_file') {
    const oldContent = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    return formatDiff(path, oldContent, String(args.content ?? ''));
  }
  if (toolName === 'edit_file') {
    if (!existsSync(path)) return `(file will be created: ${path})`;
    const original = readFileSync(path, 'utf-8');
    const oldString = String(args.old_string ?? '');
    const newString = String(args.new_string ?? '');
    const updated =
      args.replace_all === true
        ? original.split(oldString).join(newString)
        : original.replace(oldString, newString);
    return formatDiff(path, original, updated);
  }
  return JSON.stringify(args).slice(0, 500);
}

function formatDiff(path: string, oldContent: string, newContent: string): string {
  const patch = createTwoFilesPatch(path, path, oldContent, newContent, '', '', {
    context: DIFF_CONTEXT_LINES,
  });
  const lines = patch.split('\n').filter((l) => !l.startsWith('Index:') && !l.startsWith('==='));
  if (lines.length <= MAX_DIFF_LINES) return lines.join('\n');
  return lines.slice(0, MAX_DIFF_LINES).join('\n') + `\n... (diff truncated, ${lines.length} lines total)`;
}

/**
 * 把 unified diff 渲染成带行号与红绿底色的文本（纯函数，便于测试）。
 * 格式：<old> <new> │ <内容>；新增行绿底、删除行红底、上下文 dim、hunk 头 cyan。
 */
export function renderDiff(detail: string): string {
  const num = (n: number | ''): string => String(n).padStart(4);
  const gutter = chalk.gray('│');
  const out: string[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of detail.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldNo = parseInt(hunk[1], 10);
      newNo = parseInt(hunk[2], 10);
      out.push(chalk.cyan(line));
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      out.push(`${chalk.gray(num(''))} ${chalk.gray(num(newNo))} ${gutter} ${chalk.bgGreen.black(`+ ${line.slice(1)}`)}`);
      newNo++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      out.push(`${chalk.gray(num(oldNo))} ${chalk.gray(num(''))} ${gutter} ${chalk.bgRed.black(`- ${line.slice(1)}`)}`);
      oldNo++;
    } else if (line.startsWith(' ')) {
      out.push(`${chalk.gray(num(oldNo))} ${chalk.gray(num(newNo))} ${gutter} ${chalk.dim(line)}`);
      oldNo++;
      newNo++;
    } else {
      // ---/+++ 文件头、hunk 外的元信息行、截断提示等
      out.push(chalk.gray(line));
    }
  }
  return out.join('\n');
}

export function printDiff(detail: string): void {
  console.log(renderDiff(detail));
}

/** 权限确认选择：y=允许本次，a=本会话内该工具一律允许，n=拒绝 */
export type PermissionChoice = 'y' | 'a' | 'n';

const CONFIRM_OPTIONS = [
  { label: 'Yes, once' },
  { label: 'Always this tool (this session)' },
  { label: 'No' },
];

/** 箭头键选择器询问，返回用户选择（Esc/取消/非 TTY 均视为拒绝） */
export async function askConfirmation(): Promise<PermissionChoice> {
  const idx = await select('Allow?', CONFIRM_OPTIONS);
  if (idx === 0) return 'y';
  if (idx === 1) return 'a';
  return 'n';
}
