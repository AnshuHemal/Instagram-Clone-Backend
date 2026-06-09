import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { CloudinaryService, CloudinaryWebhookPayload } from '../cloudinary/cloudinary.service';
import { ReelsService } from '../reels/reels.service';

/**
 * WebhooksService — processes Cloudinary async notifications.
 *
 * Notification types handled:
 * - `upload`  → Video uploaded successfully (eager transcoding started)
 * - `eager`   → Eager HLS transformation completed → mark reel READY
 * - `error`   → Transcoding failed → mark reel FAILED
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly cloudinary: CloudinaryService,
    private readonly reels:      ReelsService,
  ) {}

  async processCloudinaryWebhook(
    rawBody:   Buffer | string,
    signature: string,
    timestamp: string,
    payload:   CloudinaryWebhookPayload,
  ): Promise<void> {
    // ── Step 1: Verify signature ───────────────────────────────────────────
    try {
      this.cloudinary.verifyWebhookSignature(rawBody, signature, timestamp);
    } catch (err) {
      this.logger.warn(`Webhook signature verification failed: ${err.message}`);
      throw new BadRequestException(`Webhook signature invalid: ${err.message}`);
    }

    this.logger.log(`[Webhook Service] Processing webhook: "${payload.notification_type}" for public_id: "${payload.public_id}"`);

    // ── Step 2: Route by notification type ─────────────────────────────────
    switch (payload.notification_type) {
      case 'upload':
        // Initial upload complete — eager HLS transcoding has started
        this.logger.log(`Asset uploaded: ${payload.public_id} — HLS transcoding in progress`);
        break;

      case 'eager':
        // Eager HLS transformation completed
        await this.handleEagerComplete(payload);
        break;

      case 'error':
        // Transcoding failed
        await this.reels.markReelFailed(
          payload.public_id,
          payload.error?.message ?? 'Unknown Cloudinary error',
        );
        break;

      default:
        this.logger.log(`[Webhook Service] Unhandled notification type: ${payload.notification_type}`);
    }
  }

  private async handleEagerComplete(payload: CloudinaryWebhookPayload): Promise<void> {
    const { public_id, eager, duration } = payload;
    this.logger.log(`[Webhook Service] handleEagerComplete initiated for public_id: "${public_id}"`);

    // The HLS master playlist URL is in eager[0].secure_url
    const rawHlsUrl = eager?.[0]?.secure_url ?? this.cloudinary.buildHlsUrl(public_id);
    const hlsUrl = rawHlsUrl.replace('.mp4.m3u8', '.m3u8');

    // Thumbnail from Cloudinary's auto-generated cover frame
    const rawThumbnailUrl = payload.thumbnail_url ?? this.cloudinary.buildThumbnailUrl(public_id);
    const thumbnailUrl = rawThumbnailUrl.replace('.mp4.jpg', '.jpg');

    this.logger.log(`[Webhook Service] Calling reelsService.markReelReady for public_id: "${public_id}"`);

    await this.reels.markReelReady(
      public_id,
      hlsUrl,
      thumbnailUrl,
      duration ?? 0,
    );

    this.logger.log(
      `[Webhook Service] Completed handleEagerComplete for public_id: ${public_id}`,
    );
  }
}
