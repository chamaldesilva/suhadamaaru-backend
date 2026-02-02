import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import express, { Request, Response } from 'express';
import { AppModule } from '../src/app.module';

let app: express.Express;

async function bootstrap(): Promise<express.Express> {
  const expressApp = express();
  const adapter = new ExpressAdapter(expressApp);

  const nestApp = await NestFactory.create(AppModule, adapter, {
    logger: ['error', 'warn'],
  });

  nestApp.use(express.json({ limit: '10mb' }));
  nestApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

  nestApp.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') || ['*'],
    credentials: true,
  });

  nestApp.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  await nestApp.init();
  return expressApp;
}

export default async function handler(req: Request, res: Response) {
  if (!app) {
    app = await bootstrap();
  }
  app(req, res);
}
