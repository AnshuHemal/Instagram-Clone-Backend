import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import * as crypto from 'crypto';

export interface UploadSignatureResult {
  signature: string;
  apiKey: string;
  cloudName: string;
  timestamp: number;
  folder: string;
  uploadPreset: string;
  /** Eager transformation string to request HLS on upload */
  eager: string;
  /** Notification URL for the Cloudinary webhook */
  notificationUrl: string;
}

export interface CloudinaryWebhookPayload {
  public_id: string;
  secure_url: string;
  duration?: number;
  width?: number;
  height?: number;
  format?: string;
  resource_type?: string;
  status?: string;
  notification_type?: string;
  eager?: Array<{
    secure_url: string;
    transformation: string;
  }>;
  thumbnail_url?: string;
  error?: { message: string };
  timestamp?: string;
  signature?: string;
}

/**
 * CloudinaryService — handles all Cloudinary interactions.
 *
 * Key responsibilities:
 * 1. Generates signed upload parameters (video never passes through our server)
 * 2. Builds CDN URLs for HLS playback and thumbnails
 * 3. Verifies webhook signatures for security
 * 4. Deletes assets when reels are removed
 */
@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly reelsFolder: string;
  private readonly webhookUrl: string;

  constructor(private readonly config: ConfigService) {
    this.cloudName = config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME');
    this.apiKey    = config.getOrThrow<string>('CLOUDINARY_API_KEY');
    this.apiSecret = config.getOrThrow<string>('CLOUDINARY_API_SECRET');
    this.reelsFolder = config.get<string>('CLOUDINARY_REELS_FOLDER', 'reels');
    this.webhookUrl  = config.get<string>('CLOUDINARY_WEBHOOK_URL', '');
  }

  onModuleInit(): void {
    cloudinary.config({
      cloud_name: this.cloudName,
      api_key:    this.apiKey,
      api_secret: this.apiSecret,
      secure:     true,
    });
    this.logger.log('✅ Cloudinary SDK configured');
  }

  // ── Upload Signature ──────────────────────────────────────────────────────

  /**
   * Generates a short-lived signed upload signature.
   * The mobile app uses these params to upload the raw video directly
   * to Cloudinary, bypassing our NestJS server entirely.
   *
   * The `eager` transformation tells Cloudinary to immediately start
   * HLS transcoding after the upload completes.
   */
  generateUploadSignature(userId: string, resourceType: 'video' | 'image' = 'video'): UploadSignatureResult {
    const timestamp = Math.round(Date.now() / 1000);

    const folder = resourceType === 'video'
      ? this.reelsFolder
      : this.config.get<string>('CLOUDINARY_POSTS_FOLDER', 'posts');

    const uploadPreset = resourceType === 'video'
      ? this.config.get<string>('CLOUDINARY_UPLOAD_PRESET', 'reels_preset')
      : this.config.get<string>('CLOUDINARY_IMAGE_UPLOAD_PRESET', 'posts_preset');

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      resource_type:        resourceType,
      upload_preset:        uploadPreset,
      context:              `user_id=${userId}`,
    };

    let eagerTransformation = '';
    if (resourceType === 'video') {
      // HLS adaptive streaming eager transformation:
      // sp_hd = streaming profile "high definition" (includes 360p/480p/720p/1080p tiers)
      eagerTransformation = 'sp_hd/fl_attachment';
      paramsToSign.eager = eagerTransformation;
      paramsToSign.eager_async = 'true';
      paramsToSign.notification_url = this.webhookUrl;
      paramsToSign.eager_notification_url = this.webhookUrl;
    }

    // Build the string to sign: alphabetically sorted key=value pairs
    const stringToSign = Object.keys(paramsToSign)
      .sort()
      .map((key) => `${key}=${paramsToSign[key]}`)
      .join('&');

    const signature = crypto
      .createHash('sha1')
      .update(stringToSign + this.apiSecret)
      .digest('hex');

    this.logger.debug(`Upload signature generated for user: ${userId} (${resourceType})`);

    return {
      signature,
      apiKey:        this.apiKey,
      cloudName:     this.cloudName,
      timestamp,
      folder,
      uploadPreset,
      eager:         eagerTransformation,
      notificationUrl: resourceType === 'video' ? this.webhookUrl : '',
    };
  }

  // ── URL Builders ──────────────────────────────────────────────────────────

  private cleanPublicId(publicId: string): string {
    if (!publicId) return '';
    return publicId.endsWith('.mp4') ? publicId.slice(0, -4) : publicId;
  }

  /**
   * Builds the Cloudinary HLS master playlist URL for a reel.
   * This URL is served from Cloudinary's global CDN (200+ edge nodes).
   *
   * Pattern: https://res.cloudinary.com/{cloud}/{resource_type}/upload/{transformation}/{public_id}.m3u8
   */
  buildHlsUrl(publicId: string): string {
    const cleanedId = this.cleanPublicId(publicId);
    return cloudinary.url(cleanedId, {
      resource_type: 'video',
      format:        'm3u8',
      streaming_profile: 'hd',
      secure:        true,
    });
  }

  /**
   * Builds the thumbnail URL for a reel.
   * Cloudinary auto-generates a JPEG thumbnail at the 1-second mark.
   */
  buildThumbnailUrl(publicId: string, width = 480, height = 854): string {
    const cleanedId = this.cleanPublicId(publicId);
    return cloudinary.url(cleanedId, {
      resource_type: 'video',
      format:        'jpg',
      transformation: [
        { start_offset: '1', width, height, crop: 'fill', gravity: 'center' },
        { quality: 'auto:good', fetch_format: 'auto' },
      ],
      secure: true,
    });
  }

  /**
   * Builds a lower-quality thumbnail for the feed list.
   * Smaller image for faster loading in the scroll-based feed.
   */
  buildFeedThumbnailUrl(publicId: string): string {
    return this.buildThumbnailUrl(publicId, 200, 356);
  }

  // ── Webhook Signature Verification ───────────────────────────────────────

  /**
   * Validates that an incoming webhook request originated from Cloudinary.
   *
   * Cloudinary signs all webhooks using:
   *   SHA-1( body_bytes + timestamp + api_secret )
   *
   * The signature is sent in the X-Cld-Signature header.
   * Requests older than 2 minutes are rejected (replay attack prevention).
   *
   * @throws Error if signature is invalid or request is too old
   */
  verifyWebhookSignature(
    rawBody: Buffer | string,
    signature: string,
    timestamp: string,
  ): void {
    const isDev = this.config.get('NODE_ENV') === 'development';
    const now = Math.round(Date.now() / 1000);
    const requestTime = parseInt(timestamp, 10);

    // Reject requests older than 2 minutes (prevent replay attacks)
    if (Math.abs(now - requestTime) > 120) {
      if (isDev) {
        this.logger.warn('⚠️ Webhook signature expired — request is too old (bypassed in development mode)');
        return;
      }
      throw new Error('Webhook signature expired — request is too old');
    }

    const expectedSignature = crypto
      .createHash('sha1')
      .update(rawBody + timestamp + this.apiSecret)
      .digest('hex');

    if (expectedSignature !== signature) {
      if (isDev) {
        this.logger.warn('⚠️ Invalid webhook signature (bypassed in development mode)');
        return;
      }
      throw new Error('Invalid webhook signature');
    }
  }

  // ── Asset Management ──────────────────────────────────────────────────────

  /**
   * Deletes a video asset from Cloudinary.
   * Called when a reel is deleted by the user.
   */
  async deleteAsset(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'video' });
      this.logger.log(`Deleted Cloudinary asset: ${publicId}`);
    } catch (err) {
      this.logger.error(`Failed to delete Cloudinary asset ${publicId}:`, err);
    }
  }

  /**
   * Gets metadata about a Cloudinary asset.
   * Useful for verifying upload completion.
   */
  async getAssetInfo(publicId: string): Promise<UploadApiResponse | null> {
    try {
      return await cloudinary.api.resource(publicId, { resource_type: 'video' }) as any;
    } catch {
      return null;
    }
  }
}
