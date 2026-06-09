import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly mailerService: MailerService) {}

  /**
   * Dispatches the 6-digit verification code to the user's email.
   */
  async sendOtpEmail(email: string, code: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: `${code} is your Instagram verification code`,
        html: this.getOtpEmailTemplate(code, email),
      });
      this.logger.log(`OTP verification email sent successfully to: ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}:`, error);
      throw error;
    }
  }

  /**
   * Generates a clean, professional Instagram-styled HTML email.
   */
  private getOtpEmailTemplate(code: string, email: string): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Confirm Your Email</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #FAFAFA; margin: 0; padding: 0; }
          .wrapper { width: 100%; table-layout: fixed; background-color: #FAFAFA; padding-bottom: 40px; padding-top: 40px; }
          .container { max-width: 480px; margin: 0 auto; background-color: #FFFFFF; border: 1px solid #DBDBDB; border-radius: 12px; padding: 32px; text-align: center; }
          .logo { width: 140px; margin: 0 auto 28px auto; display: block; }
          .title { font-size: 20px; font-weight: 700; color: #262626; margin-bottom: 16px; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
          .message { font-size: 14px; color: #737373; line-height: 22px; margin-bottom: 24px; text-align: left; }
          .code-box-container { text-align: center; margin: 24px 0; }
          .code-box { font-size: 32px; font-weight: 700; color: #0095F6; letter-spacing: 6px; padding: 16px 28px; background-color: #F8F9FA; border-radius: 8px; display: inline-block; border: 1px dashed #B2DFFC; }
          .divider { border: 0; height: 1px; background-color: #EAEAEA; margin: 32px 0 16px 0; }
          .footer { font-size: 11px; color: #A8A8A8; line-height: 16px; text-align: left; }
          .footer-logo { font-weight: bold; color: #737373; margin-top: 8px; letter-spacing: 0.5px; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="container">
            <img src="https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Instagram_logo.svg/1200px-Instagram_logo.svg.png" class="logo" alt="Instagram" />
            <h2 class="title">Confirm your email address</h2>
            <p class="message">
              Someone entered your email address to create an account on Instagram Clone. 
              Use the verification code below to complete registration:
            </p>
            <div class="code-box-container">
              <div class="code-box">${code}</div>
            </div>
            <p class="message" style="margin-bottom: 32px;">
              If you did not request this code, you can safely ignore this email. Someone else might have typed your email address by mistake.
            </p>
            <hr class="divider" />
            <div class="footer">
              This message was sent to ${email} as part of registration.
              <div class="footer-logo">from META</div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}
