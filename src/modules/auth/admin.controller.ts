import {
  Controller,
  Patch,
  Param,
  Headers,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SkipAuth } from '../../common/decorators/skip-auth.decorator';

@Controller('admin')
export class AdminController {
  constructor(private readonly db: DatabaseService) {}

  private validateSecret(secret: string) {
    const adminSecret = process.env.ADMIN_SECRET || 'supersecretadminpass';
    if (secret !== adminSecret) {
      throw new ForbiddenException('Invalid admin secret');
    }
  }

  @Patch('users/:id/verify')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async verifyUser(
    @Param('id') id: string,
    @Headers('x-admin-secret') secret: string,
  ) {
    this.validateSecret(secret);

    // check if user exists
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updatedUser = await this.db.user.update({
      where: { id },
      data: { isVerified: true },
      select: {
        id: true,
        username: true,
        displayName: true,
        isVerified: true,
      },
    });

    return {
      success: true,
      message: `User ${updatedUser.username} is now verified`,
      data: updatedUser,
    };
  }

  @Patch('users/:id/unverify')
  @SkipAuth()
  @HttpCode(HttpStatus.OK)
  async unverifyUser(
    @Param('id') id: string,
    @Headers('x-admin-secret') secret: string,
  ) {
    this.validateSecret(secret);

    // check if user exists
    const user = await this.db.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const updatedUser = await this.db.user.update({
      where: { id },
      data: { isVerified: false },
      select: {
        id: true,
        username: true,
        displayName: true,
        isVerified: true,
      },
    });

    return {
      success: true,
      message: `User ${updatedUser.username} is now unverified`,
      data: updatedUser,
    };
  }
}
