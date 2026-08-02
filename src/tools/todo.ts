import { Tool, ToolError } from './types.js';
import { ui } from '../ui.js';

export interface TodoItem {
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
}

/** 会话内的 todo 列表（agent.ts 持有实例并注入） */
export class TodoList {
  items: TodoItem[] = [];

  set(items: TodoItem[]): void {
    const inProgress = items.filter((i) => i.status === 'in_progress');
    if (inProgress.length > 1) {
      throw new ToolError('only one item can be in_progress at a time');
    }
    this.items = items;
    ui.info('\n📋 Task list:');
    ui.todoList(items);
  }

  render(): string {
    if (!this.items.length) return '(empty todo list)';
    return this.items.map((i) => `- [${i.status}] ${i.content}`).join('\n');
  }
}

export function createTodoTool(list: TodoList): Tool {
  return {
    name: 'todo',
    description:
      'Manage your task list. Use it to plan multi-step work and track progress. Rewrite the whole list on each call, updating statuses as you go. Mark exactly one item in_progress while working on it.',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'The full task list (replaces the previous one)',
          items: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'Task description' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed'],
              },
            },
            required: ['content', 'status'],
          },
        },
      },
      required: ['items'],
    },
    mutating: false,
    summarize: (args) => `${(args.items as unknown[])?.length ?? 0} items`,
    async execute(args) {
      const items = args.items as TodoItem[];
      if (!Array.isArray(items)) throw new ToolError('items must be an array');
      list.set(items);
      return `todo list updated:\n${list.render()}`;
    },
  };
}
