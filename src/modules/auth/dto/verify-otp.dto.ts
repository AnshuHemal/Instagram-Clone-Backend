import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({ example: 'user@example.com', description: 'Email address or mobile phone number that requested OTP' })
  @IsNotEmpty()
  @IsString()
  emailOrPhone: string;

  @ApiProperty({ example: '123456', description: '6-digit OTP code received by user' })
  @IsNotEmpty()
  @IsString()
  code: string;
}
