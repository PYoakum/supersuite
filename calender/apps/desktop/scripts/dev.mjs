import { createServer } from 'vite';
import { spawn } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const vite = await createServer({
  configFile: resolve(root, 'vite.config.ts'),
});
await vite.listen();

const address = vite.httpServer.address();
const url = `http://localhost:${address.port}`;
console.log(`Vite dev server running at ${url}`);

const electron = spawn(
  resolve(root, 'node_modules/.bin/electron'),
  ['--require', './node_modules/tsx/dist/preflight.cjs', '--require', './node_modules/tsx/dist/loader.cjs', 'src/main/main.ts'],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  },
);

electron.on('close', () => {
  vite.close();
  process.exit();
});

process.on('SIGINT', () => {
  electron.kill();
  vite.close();
  process.exit();
});
