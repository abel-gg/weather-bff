import { describe, expect, it } from 'vitest';
import { ApiError, describeError, isRetryable } from './errors';

/**
 * These are the highest-value tests in the frontend relative to their cost.
 *
 * `describeError` is where a server-side classification becomes the sentence a
 * user reads and the affordance they get. It is pure, so every branch is one
 * assertion, and it is the piece most likely to rot silently as error codes get
 * added on the backend.
 */
describe('describeError', () => {
  it('tells an offline user to check their connection, not that the app is broken', () => {
    const presentation = describeError(new ApiError('NETWORK_ERROR', 0, 'no network'));

    expect(presentation.title).toMatch(/offline/i);
    expect(presentation.canRetry).toBe(true);
  });

  it('distinguishes a rate limit from a generic outage', () => {
    const rateLimited = describeError(new ApiError('UPSTREAM_RATE_LIMITED', 429, 'slow down'));
    const unavailable = describeError(new ApiError('UPSTREAM_UNAVAILABLE', 502, 'down'));

    expect(rateLimited.title).not.toBe(unavailable.title);
    expect(rateLimited.description).toMatch(/few seconds/i);
  });

  it('offers no retry for a request that can never succeed unchanged', () => {
    // A retry button that cannot work is worse than no button: it spends the
    // user's patience and our quota to reach the same failure.
    expect(describeError(new ApiError('VALIDATION_ERROR', 400, 'bad')).canRetry).toBe(false);
  });

  it('degrades to a safe message for something that is not an ApiError at all', () => {
    const presentation = describeError(new TypeError('undefined is not a function'));

    expect(presentation.title).toBe('Something went wrong');
    // The raw exception message must never become user-facing copy.
    expect(presentation.description).not.toContain('undefined is not a function');
  });
});

describe('isRetryable', () => {
  it('does not retry a 4xx, and does retry everything else', () => {
    expect(isRetryable(new ApiError('VALIDATION_ERROR', 400, 'bad'))).toBe(false);
    expect(isRetryable(new ApiError('UPSTREAM_UNAVAILABLE', 502, 'down'))).toBe(true);
    expect(isRetryable(new ApiError('NETWORK_ERROR', 0, 'offline'))).toBe(true);
  });
});
