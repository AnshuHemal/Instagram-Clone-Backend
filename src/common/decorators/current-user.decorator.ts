import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * @CurrentUser() — Extracts the authenticated user from the JWT payload.
 *
 * Usage:
 *   @Get('profile')
 *   getProfile(@CurrentUser() user: JwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: keyof JwtPayload | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: JwtPayload = request.user;
    return data ? user?.[data] : user;
  },
);

/**
 * Shape of the JWT payload after decoding.
 * Set by the JwtStrategy when validating the Bearer token.
 */
export interface JwtPayload {
  sub: string;    // User UUID
  username: string;
  email: string;
  iat?: number;
  exp?: number;
}
