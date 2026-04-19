import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';

/**
 * Global filter that converts every uncaught error into the API error shape
 * described in docs/api/api-design-principles.md §5. Every response carries
 * a correlation_id that is also echoed in X-Correlation-Id so support can
 * trace an issue back to server logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const correlationId =
      (req.headers['x-correlation-id'] as string | undefined) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal_error';
    let message = 'Something went wrong. Please try again.';
    let details: Record<string, unknown> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const resp = exception.getResponse();
      if (typeof resp === 'string') {
        message = resp;
      } else if (typeof resp === 'object' && resp !== null) {
        const obj = resp as Record<string, unknown>;
        message = typeof obj.message === 'string' ? obj.message : message;
        code = typeof obj.code === 'string' ? obj.code : statusToCode(status);
        if (obj.details && typeof obj.details === 'object') {
          details = obj.details as Record<string, unknown>;
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(`${exception.message}`, exception.stack);
    }

    res.setHeader('X-Correlation-Id', correlationId);
    res.status(status).json({
      error: {
        code: code === 'internal_error' ? statusToCode(status) : code,
        message,
        details,
        correlation_id: correlationId,
      },
    });
  }
}

function statusToCode(status: number): string {
  switch (status) {
    case 400:
      return 'bad_request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden_by_policy';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation_failed';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'error';
  }
}
