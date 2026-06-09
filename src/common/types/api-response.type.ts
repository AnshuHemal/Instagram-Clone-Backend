/**
 * Typed API response wrapper.
 * All endpoints return { success, data, message, meta? }
 */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
  meta?: PaginationMeta;
  timestamp: string;
}

export interface PaginationMeta {
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
