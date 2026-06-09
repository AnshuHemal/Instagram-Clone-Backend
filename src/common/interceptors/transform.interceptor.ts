import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiResponse } from '../types/api-response.type';

/**
 * Wraps every successful response in the standard ApiResponse envelope:
 *   { success: true, message: 'OK', data: <original response>, timestamp }
 *
 * If the response already contains a { data, meta } structure (from paginated
 * endpoints), it is spread as-is so the meta field is preserved.
 */
@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((response) => {
        // Allow controllers to return a pre-shaped envelope (e.g. from paginated endpoints)
        if (response && typeof response === 'object' && 'success' in response) {
          return { timestamp: new Date().toISOString(), ...response };
        }

        return {
          success: true,
          message: 'OK',
          data: response,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}
