import { Global, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

/**
 * DatabaseModule provides PrismaService (Neon DB connection) globally.
 * @Global() ensures any module can inject it without re-importing.
 */
@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
