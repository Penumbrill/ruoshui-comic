import { spawn } from 'node:child_process';
import { startServer } from '../server/index.mjs';
await startServer({port: 4319});
const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js'], {stdio: 'inherit'});
process.on('SIGINT', () => {child.kill(); process.exit();});
