import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: any) {
    const userId = payload.sub;

    if (!userId) {
      return null;
    }

    // Check if the user exists in Neon DB
    let user = await this.db.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      // Auto-create a mock user in database to satisfy foreign key constraints
      user = await this.db.user.create({
        data: {
          id: userId,
          username: payload.username || `user_${userId.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10)}`,
          email: payload.email || `${userId}@example.com`,
          displayName: payload.displayName || `User ${userId.substring(0, 4)}`,
        },
      });
    }

    return {
      sub: user.id,
      username: user.username,
      email: user.email,
    };
  }
}
