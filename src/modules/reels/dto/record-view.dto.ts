import { IsInt, Min, Max, IsOptional, IsBoolean, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RecordViewDto {
  @ApiProperty({
    description: 'How many milliseconds the user actually watched',
    minimum: 0,
    example: 8500,
  })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  watchDurationMs: number;

  @ApiProperty({
    description: 'Did the user watch the full reel without scrolling away?',
    example: true,
  })
  @IsBoolean()
  completed: boolean;

  @ApiPropertyOptional({
    description: 'Video quality tier that was playing',
    example: '720p',
  })
  @IsOptional()
  @IsString()
  quality?: string;
}
