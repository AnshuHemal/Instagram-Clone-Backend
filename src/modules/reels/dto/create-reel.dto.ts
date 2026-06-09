import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReelDto {
  @ApiProperty({
    description: 'Cloudinary public_id returned after direct upload',
    example: 'reels/abc123xyz',
  })
  @IsString()
  cloudinaryPublicId: string;

  @ApiPropertyOptional({
    description: 'Reel caption (max 2200 chars, same as Instagram)',
    example: 'Behind the scenes of the new collection 🎬 #fashion #reels',
    maxLength: 2200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @ApiPropertyOptional({
    description: 'Audio/music track name shown below the reel',
    example: 'Original Audio',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  audioName?: string;

  @ApiPropertyOptional({
    description: 'Hashtags (without #)',
    type: [String],
    example: ['fashion', 'reels', 'style'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  hashtags?: string[];
}
