import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global HTTP exception filter.
 * Normalizes all errors (NestJS HttpExceptions + unhandled errors) into
 * the standard ApiResponse error envelope:
 *   { success: false, message, error, statusCode, path, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string;
    let errors: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const resp = exceptionResponse as Record<string, unknown>;
        message = (resp.message as string) || exception.message;
        errors = Array.isArray(resp.message) ? resp.message : undefined;
      } else {
        message = exception.message;
      }
    } else {
      // Unhandled/unexpected error — log full stack in dev
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';

      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      message,
      errors: errors ?? undefined,
      path: request.url,
      method: request.method,
      timestamp: new Date().toISOString(),
    });
  }
}
