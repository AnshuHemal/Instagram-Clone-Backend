import { Module } from '@nestjs/common';
import { FlushStatsJob } from './flush-stats.job';

@Module({
  providers: [FlushStatsJob],
})
export class JobsModule {}
