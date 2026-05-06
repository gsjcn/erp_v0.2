import dotenv from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnv() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), 'backend/.env'),
    resolve(__dirname, '../../.env')
  ];

  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      // 优先加载当前运行目录下的 .env，便于本地开发和 NAS 容器部署共用同一套启动逻辑。
      dotenv.config({ path: envPath, override: false });
    }
  }
}
