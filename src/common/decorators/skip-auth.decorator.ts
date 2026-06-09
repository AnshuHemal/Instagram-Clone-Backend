import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @SkipAuth() — Marks a route as public, bypassing JWT authentication.
 *
 * Usage:
 *   @SkipAuth()
 *   @Get('feed')
 *   getFeed() { ... }
 */
export const SkipAuth = () => SetMetadata(IS_PUBLIC_KEY, true);
