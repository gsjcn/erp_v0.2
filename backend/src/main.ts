import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadEnv } from './env/load-env';

loadEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigin = process.env.CORS_ORIGIN?.split(',').map((item) => item.trim()).filter(Boolean);

  app.setGlobalPrefix('api');
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
