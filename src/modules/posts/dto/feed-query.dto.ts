import { IsOptional, IsEnum } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export enum FeedType {
  FOR_YOU   = 'for_you',
  FOLLOWING = 'following',
}

export class FeedQueryDto extends PaginationDto {
  @ApiPropertyOptional({
    description: 'Feed algorithm type',
    enum: FeedType,
    default: FeedType.FOR_YOU,
  })
  @IsOptional()
  @IsEnum(FeedType)
  type: FeedType = FeedType.FOR_YOU;
}
