/**
 * Error taxonomy.
 *
 * The point of this file is that the rest of the codebase never decides on an
 * HTTP status code. Handlers throw a domain error, one error handler maps it.
 * That keeps "what went wrong" (a domain concern) separate from "how do we
 * tell HTTP about it" (a transport concern), and it means the client always
 * receives the same response envelope.
 */

/**
 * NOT_FOUND means the route does not exist. It deliberately does NOT cover a
 * search that matched nothing: a search with zero results is a *successful*
 * search — it returns 200 with an empty list and the UI renders an empty state.
 * Reserving 404 for things that genuinely should have been there keeps the
 * error channel meaningful.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ErrorResponseBody {
  error: {
    code: ErrorCode;
    message: string;
    /** Echoed back so a user can quote it in a bug report and we can find the log line. */
    requestId: string;
  };
}

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly statusCode: number,
    message: string,
    /**
     * Whether the client should be told to try again. Drives Retry-After and
     * lets the frontend distinguish "broken" from "busy, come back".
     */
    readonly retryable: boolean = false,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request itself is malformed. Retrying it unchanged will never work. */
export class ValidationError extends AppError {
  constructor(message: string) {
    super('VALIDATION_ERROR', 400, message, false);
  }
}

/** We gave up waiting on the weather provider. */
export class UpstreamTimeoutError extends AppError {
  constructor(message = 'The weather provider did not respond in time.') {
    super('UPSTREAM_TIMEOUT', 504, message, true);
  }
}

/**
 * We burned through the provider's quota. This is the failure mode that
 * actually matters at scale, which is why it gets its own code instead of
 * being flattened into a generic 502.
 */
export class UpstreamRateLimitedError extends AppError {
  constructor(message = 'The weather provider rejected the request: rate limit reached.') {
    super('UPSTREAM_RATE_LIMITED', 429, message, true);
  }
}

/** The provider answered, but with something we cannot use. */
export class UpstreamUnavailableError extends AppError {
  constructor(message = 'The weather provider is currently unavailable.') {
    super('UPSTREAM_UNAVAILABLE', 502, message, true);
  }
}

export function toErrorResponse(error: AppError, requestId: string): ErrorResponseBody {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId,
    },
  };
}
