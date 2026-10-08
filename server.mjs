import { createServer } from 'node:http';
import { createApplication } from './src/application.mjs';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSqliteFusionStore } from './src/fusion-store.mjs';
const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) loadEnvFile(envPath);
const fusionStore = createSqliteFusionStore(process.env.DATABASE_PATH || fileURLToPath(new URL('./data/chogchemy.sqlite', import.meta.url)));
const server = createServer(createApplication({ fusionStore }));
server.on('close', () => fusionStore.close());
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port is already in use. Stop the previous Chogchemy server or set PORT and APP_ORIGIN to another port.' : error.message);
  process.exitCode = 1;
  fusionStore.close();
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Chogchemy: http://localhost:${server.address().port}`));
