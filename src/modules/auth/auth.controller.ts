import { Controller, Post, Get, Delete, Patch, Body, Param, Query, HttpCode, HttpStatus, UseGuards, UseInterceptors, UploadedFile, BadRequestException, ParseUUIDPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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

  @Patch('profile')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update user profile details' })
  @ApiResponse({ status: 200, description: 'User profile updated successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async updateProfile(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(user.sub, dto);
  }

  @Post('profile/avatar')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upload user profile avatar image' })
  @ApiResponse({ status: 200, description: 'Avatar uploaded and profile updated successfully.' })
  @ApiResponse({ status: 400, description: 'No file uploaded or upload failed.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async uploadAvatar(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: any,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.authService.uploadAvatar(user.sub, file);
  }

  @Get('profile')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get current user profile' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getProfile(@CurrentUser() user: JwtPayload) {
    return this.authService.getProfile(user.sub);
  }

  @Get('users/suggestions')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get profile follow suggestions' })
  @ApiResponse({ status: 200, description: 'Suggestions retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getSuggestions(@CurrentUser() user: JwtPayload) {
    return this.authService.getSuggestions(user.sub);
  }

  @Get('users/search')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Search users by username or displayName' })
  @ApiResponse({ status: 200, description: 'Matched users returned.' })
  async searchUsers(
    @CurrentUser() user: JwtPayload,
    @Query('q') query: string,
  ) {
    const result = await this.authService.searchUsers(query || '', user.sub);
    return {
      success: true,
      message: 'Users retrieved',
      data: result,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('users/follow-multiple')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow multiple users' })
  @ApiResponse({ status: 200, description: 'Follow relationships created successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async followMultiple(
    @CurrentUser() user: JwtPayload,
    @Body('followingIds') followingIds: string[],
  ) {
    return this.authService.followMultiple(user.sub, followingIds);
  }

  @Post('users/:id/follow')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a user (creates FollowRequest for private accounts)' })
  @ApiResponse({ status: 200, description: 'Followed or follow request sent.' })
  async followUser(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.authService.followUser(user.sub, targetId);
  }

  @Delete('users/:id/follow-request')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel outgoing follow request' })
  async cancelFollowRequest(@CurrentUser() user: JwtPayload, @Param('id') targetId: string) {
    return this.authService.cancelFollowRequest(user.sub, targetId);
  }

  @Get('users/follow-requests')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get incoming follow requests for current user' })
  async getFollowRequests(@CurrentUser() user: JwtPayload) {
    return this.authService.getFollowRequests(user.sub);
  }

  @Patch('users/follow-requests/:id/accept')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a follow request' })
  async acceptFollowRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.authService.respondToFollowRequest(requestId, user.sub, true);
  }

  @Patch('users/follow-requests/:id/decline')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Decline a follow request' })
  async declineFollowRequest(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) requestId: string,
  ) {
    return this.authService.respondToFollowRequest(requestId, user.sub, false);
  }

  @Delete('users/:id/follow')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unfollow a user' })
  @ApiResponse({ status: 200, description: 'Unfollowed successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async unfollowUser(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.authService.unfollowUser(user.sub, targetId);
  }

  @Post('users/:id/block')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Block a user' })
  async blockUser(@CurrentUser() user: JwtPayload, @Param('id') targetId: string) {
    return this.authService.blockUser(user.sub, targetId);
  }

  @Delete('users/:id/block')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unblock a user' })
  async unblockUser(@CurrentUser() user: JwtPayload, @Param('id') targetId: string) {
    return this.authService.unblockUser(user.sub, targetId);
  }

  @Get('users/blocked')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get list of blocked users' })
  async getBlockedUsers(@CurrentUser() user: JwtPayload) {
    return this.authService.getBlockedUsers(user.sub);
  }

  @Post('users/:id/mute')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mute a user' })
  async muteUser(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
    @Body('mutePosts') mutePosts: boolean,
    @Body('muteStories') muteStories: boolean,
  ) {
    return this.authService.muteUser(user.sub, targetId, mutePosts ?? true, muteStories ?? false);
  }

  @Delete('users/:id/mute')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unmute a user' })
  async unmuteUser(@CurrentUser() user: JwtPayload, @Param('id') targetId: string) {
    return this.authService.unmuteUser(user.sub, targetId);
  }

  @Get('users/:id/mutual-followers')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get mutual followers between viewer and target user' })
  async getMutualFollowers(@CurrentUser() user: JwtPayload, @Param('id') targetId: string) {
    return this.authService.getMutualFollowers(user.sub, targetId);
  }

  @Get('users/:id/follow-status')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check follow status' })
  @ApiResponse({ status: 200, description: 'Follow status retrieved.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async getFollowStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.authService.getFollowStatus(user.sub, targetId);
  }

  @Get('users/:id/profile')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get user profile by ID' })
  @ApiResponse({ status: 200, description: 'Profile retrieved successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  @ApiResponse({ status: 404, description: 'User not found.' })
  async getUserProfile(
    @CurrentUser() user: JwtPayload,
    @Param('id') targetId: string,
  ) {
    return this.authService.getUserProfile(targetId, user.sub);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh JWT access tokens' })
  @ApiResponse({ status: 200, description: 'Tokens refreshed successfully.' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token.' })
  async refreshTokens(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }

  @Post('push-token')
  @ApiBearerAuth('JWT-auth')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register Expo push notification device token' })
  @ApiResponse({ status: 200, description: 'Push token registered successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized.' })
  async registerPushToken(
    @CurrentUser() user: JwtPayload,
    @Body('pushToken') pushToken: string,
  ) {
    return this.authService.registerPushToken(user.sub, pushToken);
  }
}
