import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { appConfig } from './modules/config/app.config';
import { PrismaModule } from './modules/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { AssessmentModule } from './modules/assessment/assessment.module';
import { AiModule } from './modules/ai/ai.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
            : undefined,
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        customProps: () => ({ service: 'api-core' }),
      },
    }),
    ThrottlerModule.forRoot([
      // Global IP-level fallback; per-user limits live on specific routes.
      { ttl: 60_000, limit: 100 },
    ]),
    PrismaModule,
    HealthModule,
    IamModule,
    CatalogModule,
    AssessmentModule,
    AiModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
