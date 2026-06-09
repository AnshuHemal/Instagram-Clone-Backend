import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'john_doe', description: 'Username, email address, or phone number registered with the account' })
  @IsNotEmpty()
  @IsString()
  usernameOrEmailOrPhone: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Account password' })
  @IsNotEmpty()
  @IsString()
  password: string;
}
