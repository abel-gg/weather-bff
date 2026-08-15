import { ApiError, type ApiErrorCode } from './errors';
import type { ApiResponse, GeoLocation, WeatherSnapshot } from './types';

/**
 * Empty in development and in the Docker image: the SPA calls /api on its own
 * origin and nginx (or the Vite dev proxy) forwards it. Same-origin everywhere
 * means CORS is not a class of bug that only appears after deploying.
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

async function request<T>(path: string, signal?: AbortSignal): Promise<ApiResponse<T>> {
  let response: Response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      headers: { accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    // An aborted request is a cancelled render, not a failure to show the user.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 0, 'The request never reached the server.');
  }

  if (!response.ok) {
    // Preserve the server's classification. If the body is not our envelope
    // (a proxy 502 page, say), fall back to something derived from the status.
    const body = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string; requestId?: string } }
      | null;

    throw new ApiError(
      (body?.error?.code as ApiErrorCode | undefined) ?? codeFromStatus(response.status),
      response.status,
      body?.error?.message ?? `Request failed with status ${response.status}.`,
      body?.error?.requestId,
    );
  }

  return (await response.json()) as ApiResponse<T>;
}

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 429) return 'UPSTREAM_RATE_LIMITED';
  if (status === 504) return 'UPSTREAM_TIMEOUT';
  if (status >= 500) return 'UPSTREAM_UNAVAILABLE';
  return 'VALIDATION_ERROR';
}

export function fetchWeather(
  coordinates: { latitude: number; longitude: number },
  signal?: AbortSignal,
): Promise<ApiResponse<WeatherSnapshot>> {
  const params = new URLSearchParams({
    latitude: String(coordinates.latitude),
    longitude: String(coordinates.longitude),
  });
  return request<WeatherSnapshot>(`/api/weather?${params.toString()}`, signal);
}

export function searchLocations(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResponse<GeoLocation[]>> {
  const params = new URLSearchParams({ q: query, limit: '6' });
  return request<GeoLocation[]>(`/api/locations?${params.toString()}`, signal);
}
