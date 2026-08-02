// node-pty 的 npm 包中 spawn-helper 丢失了可执行权限（表现为 spawn 时报
// "posix_spawnp failed"），postinstall 时补上。非 darwin/linux 或目录不存在时忽略。
import { readdirSync, chmodSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const prebuildsDir = fileURLToPath(new URL('../node_modules/node-pty/prebuilds/', import.meta.url));
try {
  for (const platformDir of readdirSync(prebuildsDir)) {
    const helper = join(prebuildsDir, platformDir, 'spawn-helper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
} catch {
  // node-pty 未安装或结构变化：忽略
}
