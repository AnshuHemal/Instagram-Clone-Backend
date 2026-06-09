import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { ExpressAdapter } from '@nestjs/platform-express';
import compression from 'compression';
import morgan from 'morgan';
import helmet from 'helmet';
import express from 'express';

import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

let cachedServer: express.Express | null = null;

export async function bootstrap(expressInstance: express.Express) {
  const adapter = new ExpressAdapter(expressInstance);
  const app = await NestFactory.create(AppModule, adapter, {
    // Suppress verbose NestJS logs in production
    logger: process.env.NODE_ENV === 'production'
      ? ['error', 'warn']
      : ['log', 'debug', 'error', 'verbose', 'warn'],
    // Expose raw body for Cloudinary webhook signature verification
    rawBody: true,
  });

  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const apiPrefix = config.get<string>('API_PREFIX', 'api');
  const nodeEnv = config.get<string>('NODE_ENV', 'development');

  // ── Security ──────────────────────────────────────────────────────────────
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allow Cloudinary CDN resources
  }));

  // ── CORS ──────────────────────────────────────────────────────────────────
  const corsOrigins = config.get<string>('CORS_ORIGINS', '*').split(',');
  app.enableCors({
    origin: nodeEnv === 'production' ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    credentials: true,
  });

  // ── Compression ───────────────────────────────────────────────────────────
  app.use(compression());

  // ── HTTP Request Logging ──────────────────────────────────────────────────
  app.use(morgan(nodeEnv === 'production' ? 'combined' : 'dev'));

  // ── Global Prefix & Versioning ────────────────────────────────────────────
  app.setGlobalPrefix(apiPrefix);
  app.enableVersioning({ type: VersioningType.URI });

  // ── Global Validation Pipe ────────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,            // Strip unknown properties
      forbidNonWhitelisted: false, // Don't throw on unknown properties
      transform: true,            // Auto-transform DTOs (e.g. string→number)
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Global Exception Filter ───────────────────────────────────────────────
  app.useGlobalFilters(new HttpExceptionFilter());

  // ── Global Response Transform ─────────────────────────────────────────────
  app.useGlobalInterceptors(new TransformInterceptor());

  // ── Swagger API Documentation ─────────────────────────────────────────────
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Instagram Reels API')
      .setDescription(
        `Production-level REST API for Instagram Reels.\n\n` +
        `**Stack:** NestJS · Cloudinary (HLS streaming + CDN) · Neon DB · Upstash Redis\n\n` +
        `**Key Features:**\n` +
        `- Zero-delay reel playback via Cloudinary HLS + CDN pre-fetching\n` +
        `- Cursor-based pagination for infinite scroll\n` +
        `- View/Like count batching via Redis (30s flush to DB)\n` +
        `- Real-time reel status updates via SSE\n` +
        `- Cloudinary signed uploads (video never passes through NestJS server)`,
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', name: 'JWT', in: 'header' },
        'JWT-auth',
      )
      .addTag('reels', 'Reel feed, upload, engagement')
      .addTag('webhooks', 'Cloudinary async processing callbacks')
      .addTag('health', 'Health & readiness checks')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        filter: true,
        showRequestDuration: true,
      },
      customCssUrl: 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui.min.css',
      customJs: [
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui-bundle.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.9.0/swagger-ui-standalone-preset.min.js',
      ],
    });
  }

  await app.init();
  return { app, port, apiPrefix, nodeEnv };
}

// Support running locally (NestJS server)
if (!process.env.VERCEL) {
  const localServer = express();
  bootstrap(localServer).then(({ port, apiPrefix, nodeEnv }) => {
    localServer.listen(port, () => {
      console.log(`\n🚀 Instagram Reels API running locally on: http://localhost:${port}/${apiPrefix}`);
      console.log(`🌍 Environment: ${nodeEnv}`);
      console.log(`📚 Swagger docs: http://localhost:${port}/api/docs`);
    });
  });
}
