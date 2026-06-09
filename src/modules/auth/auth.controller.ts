import { Controller, Post, Get, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
@ApiResponse({ status: 500, description: 'Internal Server Error' })
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register/send-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send registration OTP code to email or phone number' })
  @ApiResponse({ status: 200, description: 'OTP verification code generated and dispatched successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid email or phone payload.' })
  @ApiResponse({ status: 409, description: 'Account already registered.' })
  async sendOtp(@Body() dto: SendOtpDto) {
    return this.authService.sendOtp(dto);
  }

  @Post('register/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify user registration OTP code' })
  @ApiResponse({ status: 200, description: 'OTP verified successfully. Returns transient signupToken.' })
  @ApiResponse({ status: 400, description: 'Invalid or expired OTP code.' })
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Get('check-username')
  @ApiOperation({ summary: 'Check username availability' })
  @ApiResponse({ status: 200, description: 'Returns availability status and alternatives suggestions if taken.' })
  async checkUsername(@Query('username') username: string) {
    return this.authService.checkUsername(username);
  }

  @Post('register/complete')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Complete account creation registration' })
  @ApiResponse({ status: 201, description: 'Account registered successfully. Returns JWT access tokens.' })
  @ApiResponse({ status: 400, description: 'Invalid signup session token.' })
  @ApiResponse({ status: 409, description: 'Username is taken.' })
  async registerComplete(@Body() dto: RegisterCompleteDto) {
    return this.authService.registerComplete(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in with credentials' })
  @ApiResponse({ status: 200, description: 'Successfully authenticated. Returns JWT access tokens.' })
  @ApiResponse({ status: 401, description: 'Incorrect username/email/phone or password.' })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
