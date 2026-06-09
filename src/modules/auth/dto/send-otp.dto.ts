import { IsNotEmpty, IsString, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOtpDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address or mobile phone number' })
  @IsNotEmpty()
  @IsString()
  emailOrPhone: string;

  @ApiProperty({ example: false, description: 'True if registering via phone number, false if email' })
  @IsNotEmpty()
  @IsBoolean()
  isPhone: boolean;
}
