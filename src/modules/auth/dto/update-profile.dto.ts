import { IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateProfileDto {
  @ApiProperty({ example: 'John Doe', description: 'Full name display name', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  name?: string;

  @ApiProperty({ example: 'New bio description...', description: 'User biography description', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  bio?: string;

  @ApiProperty({ example: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', description: 'URL of the profile picture/avatar', required: false })
  @IsOptional()
  @IsString()
  avatarUrl?: string;

  @ApiProperty({ example: true, description: 'Has the user finished onboarding?', required: false })
  @IsOptional()
  @IsBoolean()
  isOnboarded?: boolean;

  @ApiProperty({ example: 'PROFILE_PICTURE', description: 'Current step in onboardings funnel', required: false })
  @IsOptional()
  @IsString()
  onboardingStep?: string;
}
