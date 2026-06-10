import { Injectable, ConflictException, BadRequestException, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes, randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';
import { CacheService } from '../cache/cache.service';
import { PasswordHasher } from './password-hasher';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RegisterCompleteDto } from './dto/register-complete.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { MailService } from '../mail/mail.service';
import { v2 as cloudinary } from 'cloudinary';

interface SignupSession {
  emailOrPhone: string;
  isPhone: boolean;
  verified: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
  ) {}


  /**
   * Generates a 6-digit OTP code and caches it in Redis.
   * Prints the code to console logs for local verification.
   */
  async sendOtp(dto: SendOtpDto) {
    const cleaned = dto.emailOrPhone.trim().toLowerCase();

    // Check PostgreSQL user uniqueness
    const existingUser = await this.db.user.findFirst({
      where: dto.isPhone
        ? { phone: cleaned }
        : { email: cleaned },
    });

    if (existingUser) {
      throw new ConflictException('An account already exists with this email or mobile number.');
    }

    // Generate 6-digit OTP code
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // Cache code in Redis for 5 minutes (300 seconds)
    const redisKey = `otp:reg:${cleaned}`;
    await this.cache.set(redisKey, code, 300);

    if (!dto.isPhone) {
      // Trigger actual Nodemailer SMTP email dispatch
      await this.mailService.sendOtpEmail(cleaned, code);
    } else {
      // Development Logger simulation for SMS
      this.logger.log(`\n==========================================\n[SMS OTP NOTIFICATION]\nVerification Code: ${code}\nSent to: ${dto.emailOrPhone}\n==========================================\n`);
    }

    // General verification logger for audit trail
    this.logger.log(`Verification code ${code} cached for identifier: ${cleaned}`);

    return {
      success: true,
      message: 'Verification code sent successfully.',
    };
  }

  /**
   * Verifies the OTP code and issues a transient signup session token.
   */
  async verifyOtp(dto: VerifyOtpDto) {
    const cleaned = dto.emailOrPhone.trim().toLowerCase();
    const redisKey = `otp:reg:${cleaned}`;

    const cachedCode = await this.cache.get<string>(redisKey);

    if (!cachedCode || cachedCode !== dto.code) {
      throw new BadRequestException('Invalid or expired verification code.');
    }

    // Clear verification code
    await this.cache.del(redisKey);

    // Generate transient signup token
    const signupToken = `sec_tok_${randomUUID()}`;

    // Store signup session context in Redis for 15 minutes (900 seconds)
    const sessionKey = `signup_session:${signupToken}`;
    const sessionData: SignupSession = {
      emailOrPhone: cleaned,
      isPhone: !cleaned.includes('@'), // Auto-detect mode or infer from context
      verified: true,
    };
    await this.cache.set(sessionKey, sessionData, 900); // Wait, cache.set takes (key, value, ttl) or (value, key, ttl)?
    // Let's check cache.service.ts generic operations signature:
    // async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>
    // Ah! It is key first, value second: set(key, value, ttlSeconds)! 
    // Let's call: await this.cache.set(sessionKey, sessionData, 900);

    return {
      success: true,
      signupToken,
    };
  }

  /**
   * Checks if username is taken and generates suggestions if unavailable.
   */
  async checkUsername(username: string) {
    const cleaned = username.trim().toLowerCase();

    if (cleaned.length < 3) {
      return {
        available: false,
        suggestions: [],
      };
    }

    const existingUser = await this.db.user.findUnique({
      where: { username: cleaned },
    });

    if (existingUser) {
      // Generate 3 suggestions
      const suggestions = [
        `${cleaned}${Math.floor(Math.random() * 90) + 10}`,
        `${cleaned}${Math.floor(Math.random() * 900) + 100}`,
        `${cleaned}_${Math.floor(Math.random() * 1000)}`,
      ];
      return {
        available: false,
        suggestions,
      };
    }

    return {
      available: true,
      suggestions: [],
    };
  }

  /**
   * Completes account creation, hashing passwords and creating the user in database.
   */
  async registerComplete(dto: RegisterCompleteDto) {
    const sessionKey = `signup_session:${dto.signupToken}`;
    const session = await this.cache.get<SignupSession>(sessionKey);

    if (!session || !session.verified) {
      throw new BadRequestException('Registration session expired or invalid. Please request a new verification code.');
    }

    const cleanedUsername = dto.username.trim().toLowerCase();

    // Verify username availability
    const existingUser = await this.db.user.findUnique({
      where: { username: cleanedUsername },
    });
    if (existingUser) {
      throw new ConflictException(`The username '${dto.username}' is already taken.`);
    }

    // Hash the password
    const passwordHash = PasswordHasher.hash(dto.password);

    // Create the user in Neon DB using database service
    const user = await this.db.user.create({
      data: {
        username: cleanedUsername,
        email: session.isPhone ? `${cleanedUsername}@example.com` : session.emailOrPhone,
        phone: session.isPhone ? session.emailOrPhone : null,
        passwordHash,
        birthday: new Date(dto.birthday),
        displayName: dto.name,
      },
    });

    // Invalidate the signup session token
    await this.cache.del(sessionKey);

    // Sign Access Token
    const accessToken = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      email: user.email,
    });

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  /**
   * Validates user credentials and issues session JWT tokens.
   */
  async login(dto: LoginDto) {
    const identifier = dto.usernameOrEmailOrPhone.trim().toLowerCase();

    // Query Neon database
    const user = await this.db.user.findFirst({
      where: {
        OR: [
          { username: identifier },
          { email: identifier },
          { phone: dto.usernameOrEmailOrPhone }, // Keep raw phone matching
        ],
      },
    });

    if (!user) {
      throw new UnauthorizedException('Incorrect login identifier or password.');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'Password authentication is not configured for this account. Please log in using JWT externally.',
      );
    }

    // Verify password hash
    const isPasswordValid = PasswordHasher.verify(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Incorrect login identifier or password.');
    }

    // Sign Access Token
    const accessToken = this.jwtService.sign({
      sub: user.id,
      username: user.username,
      email: user.email,
    });

    return {
      success: true,
      accessToken,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
      },
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.db.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { displayName: dto.name }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
    });

    return {
      success: true,
      message: 'Profile updated successfully.',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        bio: user.bio,
      },
    };
  }

  async uploadAvatar(userId: string, file: any) {
    try {
      // Upload file buffer directly to Cloudinary
      const uploadResult = await new Promise<any>((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'avatars',
            resource_type: 'image',
            transformation: [{ width: 300, height: 300, crop: 'fill', gravity: 'face' }],
          },
          (error, result) => {
            if (error) return reject(error);
            resolve(result);
          }
        );
        uploadStream.end(file.buffer);
      });

      const avatarUrl = uploadResult.secure_url;

      // Update in Neon database
      const user = await this.db.user.update({
        where: { id: userId },
        data: { avatarUrl },
      });

      return {
        success: true,
        message: 'Avatar uploaded successfully.',
        avatarUrl,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          bio: user.bio,
        },
      };
    } catch (error) {
      this.logger.error('Failed to upload avatar to Cloudinary:', error);
      throw new BadRequestException('Failed to upload image. Please try again.');
    }
  }

  async getSuggestions(userId: string) {
    // Fetch users excluding the current user
    const users = await this.db.user.findMany({
      where: {
        id: { not: userId },
      },
      take: 20,
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Get the list of users the current user is already following
    const following = await this.db.follow.findMany({
      where: {
        followerId: userId,
      },
      select: {
        followingId: true,
      },
    });

    const followingIds = new Set(following.map(f => f.followingId));

    return users.map(user => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150',
      verified: user.isVerified,
      checked: followingIds.has(user.id),
    }));
  }

  async followMultiple(userId: string, followingIds: string[]) {
    if (!Array.isArray(followingIds) || followingIds.length === 0) {
      return { success: true, count: 0 };
    }

    let count = 0;
    for (const fid of followingIds) {
      try {
        await this.db.follow.upsert({
          where: {
            followerId_followingId: {
              followerId: userId,
              followingId: fid,
            },
          },
          update: {},
          create: {
            followerId: userId,
            followingId: fid,
          },
        });
        count++;
      } catch (err) {
        this.logger.error(`Error following user ${fid}:`, err);
      }
    }

    return {
      success: true,
      count,
    };
  }
}
