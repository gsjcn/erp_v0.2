import 'reflect-metadata';
import './env/bootstrap-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { exportRootPath, uploadRootPath } from './storage/upload-paths';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((item) => item.trim()).filter(Boolean);

  app.setGlobalPrefix('api');
  app.useStaticAssets(uploadRootPath(), { prefix: '/uploads/' });
  // NAS 部署时导出目录也必须在启动阶段校验和创建，避免首次导出才暴露挂载权限问题。
  exportRootPath();
  app.enableCors({
    origin: corsOrigin && corsOrigin.length > 0 ? corsOrigin : true
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true
    })
  );

  const port = Number(process.env.PORT || 3000);
  await app.listen(port);
}

void bootstrap();
