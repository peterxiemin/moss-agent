import { describe, it, expect, vi } from 'vitest';
import { attachMainReadline, dispatchLine } from '../src/input.js';

describe('input 分发', () => {
  it('行统一进入主循环', () => {
    const handler = vi.fn();
    attachMainReadline(handler);

    dispatchLine('git status');
    expect(handler).toHaveBeenCalledWith('git status');
  });
});
