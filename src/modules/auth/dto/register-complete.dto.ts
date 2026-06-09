import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterCompleteDto {
  @ApiProperty({ example: 'sec_tok_123', description: 'Transient signup session token from OTP verification step' })
  @IsNotEmpty()
  @IsString()
  signupToken: string;

  @ApiProperty({ example: 'SecurePassword123!', description: 'Plaintext password chosen by user' })
  @IsNotEmpty()
  @IsString()
  password: string;

  @ApiProperty({ example: '2000-06-08T00:00:00.000Z', description: 'ISO date string of user birthday' })
  @IsNotEmpty()
  @IsString()
  birthday: string;

  @ApiProperty({ example: 'John Doe', description: 'Full name display of user' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'john_doe', description: 'Unique username chosen by user' })
  @IsNotEmpty()
  @IsString()
  username: string;
}
