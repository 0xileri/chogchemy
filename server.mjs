import { createServer } from 'node:http';
import { createApplication } from './src/application.mjs';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createSqliteFusionStore } from './src/fusion-store.mjs';
import { createImageGenerator } from './src/image-generator.mjs';
const envPath = new URL('./.env', import.meta.url);
if (existsSync(envPath)) loadEnvFile(envPath);
const fusionStore = createSqliteFusionStore(process.env.DATABASE_PATH || fileURLToPath(new URL('./data/chogchemy.sqlite', import.meta.url)));
if (process.env.NODE_ENV === 'production' && !/^https:\/\//.test(process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || '')) throw new Error('Set APP_ORIGIN to the public HTTPS address.');
const generationOptions = {
  imageGenerator: createImageGenerator(),
  dailyLimit: Number(process.env.GENERATION_DAILY_LIMIT || 10),
  holderDailyLimit: Number(process.env.GENERATION_HOLDER_DAILY_LIMIT || 2),
};
const application = createApplication({ fusionStore, generationOptions });
const server = createServer(application);
server.on('close', async () => { await application.idle(); fusionStore.close(); });
server.on('error', error => {
  console.error(error.code === 'EADDRINUSE' ? 'Port is already in use. Stop the previous Chogchemy server or set PORT and APP_ORIGIN to another port.' : error.message);
  process.exitCode = 1;
  fusionStore.close();
});
server.listen(Number(process.env.PORT || 3000), process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), () => console.log(`Chogchemy: ${process.env.APP_ORIGIN || process.env.RENDER_EXTERNAL_URL || `http://localhost:${server.address().port}`}`));
process.on('SIGTERM', () => server.close());
