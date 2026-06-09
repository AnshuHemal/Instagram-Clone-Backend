import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — Neon DB connection wrapper.
 *
 * Extends PrismaClient to hook into NestJS lifecycle:
 * - Connects on module initialization
 * - Gracefully disconnects on shutdown
 *
 * Uses the DATABASE_URL from .env (should be the Neon PgBouncer pooler URL
 * to prevent connection exhaustion in this long-running NestJS server).
 */
@Injectable()
export class DatabaseService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(DatabaseService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'stdout', level: 'error' },
              { emit: 'stdout', level: 'warn' },
            ]
          : [{ emit: 'stdout', level: 'error' }],
      // Connection pool configuration optimized for Neon's serverless pooler
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
    });

    // Log all queries in development for debugging
    if (process.env.NODE_ENV === 'development') {
      (this as any).$on('query', (e: any) => {
        this.logger.debug(`Query: ${e.query} | Params: ${e.params} | Duration: ${e.duration}ms`);
      });
    }
  }

  async onModuleInit(): Promise<void> {
    this.logger.log('Connecting to Neon DB...');
    await this.$connect();
    this.logger.log('✅ Neon DB connected');
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting from Neon DB...');
    await this.$disconnect();
  }

  /**
   * Executes multiple Prisma operations in a single transaction.
   * Useful for write operations that must succeed atomically
   * (e.g. create reel + update user stats).
   */
  async executeInTransaction<T>(
    fn: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(fn);
  }
}
