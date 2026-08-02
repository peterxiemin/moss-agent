import { Tool } from './types.js';
import { readFileTool } from './readFile.js';
import { writeFileTool } from './writeFile.js';
import { editFileTool } from './editFile.js';
import { bashTool } from './bash.js';
import { globTool } from './glob.js';
import { grepTool } from './grep.js';
import { createTodoTool, TodoList } from './todo.js';

export function createTools(todoList: TodoList): Tool[] {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    bashTool,
    globTool,
    grepTool,
    createTodoTool(todoList),
  ];
}

/** 转成 OpenAI function calling 的 tools 参数 */
export function toOpenAITools(tools: Tool[]) {
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
