import {
  Controller,
  Post,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request } from 'express';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';
import { WebhooksService } from './webhooks.service';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * POST /api/webhooks/cloudinary
   *
   * Cloudinary fires this webhook when video transcoding completes (or fails).
   *
   * Security: Verifies the X-Cld-Signature header before processing.
   * The signature is HMAC-SHA1(raw_body + timestamp + api_secret).
   *
   * Raw body access requires NestJS to be bootstrapped with `rawBody: true`
   * (configured in main.ts).
   */
  @Post('cloudinary')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cloudinary upload/processing notification webhook',
    description:
      'Called by Cloudinary when HLS transcoding completes or fails. ' +
      'Validates the webhook signature before processing. ' +
      'On success: updates the reel status to READY and stores the HLS URL in Neon DB.',
  })
  @ApiResponse({ status: 200, description: 'Webhook processed successfully' })
  @ApiResponse({ status: 400, description: 'Invalid webhook signature' })
  async handleCloudinaryWebhook(
    @Body() body: any,
    @Req() req: Request,
    @Headers('x-cld-signature') signature: string,
    @Headers('x-cld-timestamp') timestamp: string,
  ) {
    if (!signature || !timestamp) {
      throw new BadRequestException('Missing Cloudinary webhook headers');
    }

    // req.rawBody is populated because main.ts sets rawBody: true
    const rawBody = (req as any).rawBody ?? JSON.stringify(body);

    this.logger.log(`Cloudinary webhook received — notification_type: ${body?.notification_type}`);

    await this.webhooksService.processCloudinaryWebhook(
      rawBody,
      signature,
      timestamp,
      body,
    );

    return { received: true };
  }
}
