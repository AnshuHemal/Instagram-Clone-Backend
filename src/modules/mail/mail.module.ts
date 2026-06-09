import { Module } from '@nestjs/common';
import { MailerModule } from '@nestjs-modules/mailer';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailService } from './mail.service';

@Module({
  imports: [
    MailerModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        transport: {
          host: config.getOrThrow<string>('SMTP_HOST'),
          port: config.getOrThrow<number>('SMTP_PORT'),
          secure: config.get<number>('SMTP_PORT', 587) === 465, // true for port 465, false for 587 or others
          auth: {
            user: config.getOrThrow<string>('SMTP_USER'),
            pass: config.getOrThrow<string>('SMTP_PASS'),
          },
        },
        defaults: {
          from: config.getOrThrow<string>('SMTP_FROM'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
