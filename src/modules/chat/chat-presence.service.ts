import { Injectable } from '@nestjs/common';

@Injectable()
export class ChatPresenceService {
  private activeUsers = new Set<string>();

  /**
   * Register a user as online.
   */
  add(userId: string) {
    this.activeUsers.add(userId);
  }

  /**
   * Remove a user from online status.
   */
  remove(userId: string) {
    this.activeUsers.delete(userId);
  }

  /**
   * Check if a user is currently online.
   */
  isOnline(userId: string): boolean {
    return this.activeUsers.has(userId);
  }
}
