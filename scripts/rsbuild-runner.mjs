import { createRsbuild } from '@rsbuild/core';
import config from '../rsbuild.config.mjs';

const mode = process.argv[2] ?? 'build';

async function run() {
  const rsbuild = await createRsbuild({ cwd: process.cwd(), rsbuildConfig: config });
  if (mode === 'dev') {
    const server = await rsbuild.startDevServer();
    // 保持进程常驻，直到收到终止信号
    const shutdown = () => {
      void server.close();
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } else {
    await rsbuild.build();
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
