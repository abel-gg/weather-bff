/**
 * The client half of the error taxonomy.
 *
 * The server already classified the failure; throwing that classification away
 * and rendering "Something went wrong" for everything is how error states end
 * up useless. A rate limit and a dead network need different words and
 * different affordances — one is "wait a moment", the other is "check your
 * connection" — and only one of them is worth retrying automatically.
 */

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'INTERNAL_ERROR'
  /** Client-side only: fetch itself rejected, so the request never left the device. */
  | 'NETWORK_ERROR';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    readonly status: number,
    message: string,
    /** Server-issued id. Shown in the UI so a user can quote it in a report. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ErrorPresentation {
  title: string;
  description: string;
  /** Whether offering a retry button is honest, or just theatre. */
  canRetry: boolean;
}

/**
 * Maps a failure to what the user should read. Pure, so it is trivially
 * testable and the copy can be reviewed without running the app.
 */
export function describeError(error: unknown): ErrorPresentation {
  if (!(error instanceof ApiError)) {
    return {
      title: 'Something went wrong',
      description: 'An unexpected problem stopped us from loading the weather.',
      canRetry: true,
    };
  }

  switch (error.code) {
    case 'NETWORK_ERROR':
      return {
        title: 'You appear to be offline',
        description: 'We could not reach the server. Check your connection and try again.',
        canRetry: true,
      };
    case 'UPSTREAM_RATE_LIMITED':
      return {
        title: 'Too many requests right now',
        description: 'The weather service is throttling us. Give it a few seconds and retry.',
        canRetry: true,
      };
    case 'UPSTREAM_TIMEOUT':
      return {
        title: 'The weather service is slow',
        description: 'It did not respond in time. This is usually brief.',
        canRetry: true,
      };
    case 'UPSTREAM_UNAVAILABLE':
      return {
        title: 'The weather service is unavailable',
        description: 'We have no recent data for this location yet. Please try again shortly.',
        canRetry: true,
      };
    case 'VALIDATION_ERROR':
      // Retrying an identical bad request cannot succeed, so no retry button.
      return {
        title: 'That location looks wrong',
        description: 'We could not read those coordinates. Try picking the place again.',
        canRetry: false,
      };
    case 'NOT_FOUND':
      return {
        title: 'We could not find that',
        description: 'The address we asked for does not exist. Try picking the place again.',
        canRetry: false,
      };
    case 'INTERNAL_ERROR':
    default:
      return {
        title: 'Something went wrong',
        description: 'This one is on us. The team has been notified.',
        canRetry: true,
      };
  }
}

/** Retrying a 4xx just burns quota; retrying a 5xx or a dropped socket is worth it. */
export function isRetryable(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.code !== 'VALIDATION_ERROR' && error.code !== 'NOT_FOUND';
}
