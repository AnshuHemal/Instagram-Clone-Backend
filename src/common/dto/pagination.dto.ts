import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PaginationDto {
  @ApiPropertyOptional({
    description: 'Cursor for pagination (ID of the last item from previous page)',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Number of items to return',
    default: 10,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  @Type(() => Number)
  limit: number = 10;
}
