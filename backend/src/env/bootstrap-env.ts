import { loadEnv } from './load-env';

// 必须在 AppModule / Controller 装饰器加载前执行，确保 UPLOAD_DIR 等目录配置生效。
loadEnv();
