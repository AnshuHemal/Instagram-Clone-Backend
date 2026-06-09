import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { DatabaseModule } from '../database/database.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d'),
        },
      }),
      inject: [ConfigService],
    }),
    DatabaseModule,
    MailModule,
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, AuthService],
  exports: [PassportModule, JwtModule, AuthService],
})
export class AuthModule {}
