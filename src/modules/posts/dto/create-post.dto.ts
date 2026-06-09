import { IsString, IsOptional, IsArray, MaxLength, ValidateNested, IsIn, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PostMediaDto {
  @ApiProperty({
    description: 'Direct Cloudinary HTTPS URL or path',
    example: 'https://res.cloudinary.com/dplnpodex/image/upload/v12345/posts/image.jpg',
  })
  @IsString()
  mediaUrl: string;

  @ApiProperty({
    description: 'Type of media: IMAGE or VIDEO',
    enum: ['IMAGE', 'VIDEO'],
    example: 'IMAGE',
  })
  @IsString()
  @IsIn(['IMAGE', 'VIDEO'])
  mediaType: string;

  @ApiPropertyOptional({
    description: 'Zero-indexed order in carousel layout',
    example: 0,
  })
  @IsOptional()
  @IsNumber()
  orderIndex?: number;
}

export class CreatePostDto {
  @ApiPropertyOptional({
    description: 'Post caption text (max 2200 chars)',
    example: 'Beautiful Sunday morning! ☀️ #sunday #goodvibes',
    maxLength: 2200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @ApiPropertyOptional({
    description: 'Geotagged location name',
    example: 'Brooklyn Bridge, NY',
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;

  @ApiProperty({
    description: 'List of media files associated with the post (min 1 carousel item)',
    type: [PostMediaDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PostMediaDto)
  media: PostMediaDto[];
}
