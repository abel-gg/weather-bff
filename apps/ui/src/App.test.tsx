import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import {
  LOCATIONS,
  WEATHER_SNAPSHOT,
  apiResponse,
  jsonResponse,
  renderWithQuery,
} from './test-utils';

/**
 * Behavioural tests against the real component tree, with only `fetch` replaced.
 *
 * Rationale for testing here rather than unit-testing each component: the thing
 * that breaks in practice is not a card rendering the wrong degree symbol, it
 * is the *state machine* — a spinner that never resolves, an error that renders
 * blank, a stale flag nobody surfaces. Those bugs only exist in the composition,
 * so that is where the tests live. Presentational details are left to the
 * typechecker and to review.
 */

type FetchHandler = (url: string) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => Promise.resolve(handler(String(input))));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const happyPath: FetchHandler = (url) => {
  if (url.includes('/api/locations')) return jsonResponse(apiResponse(LOCATIONS));
  return jsonResponse(apiResponse(WEATHER_SNAPSHOT));
};

async function searchAndPick(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole('combobox'), 'Malaga');
  const option = await screen.findByRole('button', { name: /Málaga, Andalucía/ }, { timeout: 3000 });
  await user.click(option);
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('empty state', () => {
  it('invites the user to choose a place instead of showing an blank screen', () => {
    stubFetch(happyPath);
    renderWithQuery(<App />);

    expect(screen.getByRole('heading', { name: /pick a place to start/i })).toBeInTheDocument();
  });

  it('does not call the API before there is anything to ask about', () => {
    const fetchMock = stubFetch(happyPath);
    renderWithQuery(<App />);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('loading state', () => {
  it('reserves the layout with a skeleton rather than a spinner', async () => {
    // Never resolves: this is the state a user on a slow connection lives in.
    stubFetch((url) =>
      url.includes('/api/locations')
        ? jsonResponse(apiResponse(LOCATIONS))
        : new Promise<Response>(() => {}),
    );
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);

    const busy = await screen.findByLabelText(/loading the weather/i);
    expect(busy).toHaveAttribute('aria-busy', 'true');
  });
});

describe('success state', () => {
  it('renders current conditions and the forecast for the chosen place', async () => {
    stubFetch(happyPath);
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);

    expect(await screen.findByText('29°')).toBeInTheDocument();
    expect(screen.getByText('Mainly clear')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Málaga, Andalucía, España/ })).toBeInTheDocument();

    const forecast = screen.getByRole('region', { name: /seven day forecast/i });
    expect(within(forecast).getByText('Today')).toBeInTheDocument();
  });

  it('asks the backend for the selected coordinates', async () => {
    const fetchMock = stubFetch(happyPath);
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);
    await screen.findByText('29°');

    const weatherCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/weather'));
    expect(String(weatherCall?.[0])).toContain('latitude=36.72016');
  });

  it('skips the empty state entirely for a returning visitor', async () => {
    window.localStorage.setItem(
      'weather-bff:last-location',
      JSON.stringify({ label: 'Berlin, Germany', latitude: 52.52, longitude: 13.4 }),
    );
    stubFetch(happyPath);
    renderWithQuery(<App />);

    expect(screen.queryByRole('heading', { name: /pick a place/i })).not.toBeInTheDocument();
    expect(await screen.findByText('29°')).toBeInTheDocument();
  });
});

describe('stale state', () => {
  it('keeps showing the weather and says how old it is', async () => {
    // The provider is down, the server answered from cache. This must not look
    // like an error — the data is still useful, it is just not current.
    stubFetch((url) =>
      url.includes('/api/locations')
        ? jsonResponse(apiResponse(LOCATIONS))
        : jsonResponse(apiResponse(WEATHER_SNAPSHOT, true)),
    );
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);

    expect(await screen.findByText('29°')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/live data is unavailable/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('error state', () => {
  it('translates the server error code into words a user can act on', async () => {
    stubFetch((url) =>
      url.includes('/api/locations')
        ? jsonResponse(apiResponse(LOCATIONS))
        : jsonResponse(
            { error: { code: 'UPSTREAM_RATE_LIMITED', message: 'throttled', requestId: 'req-42' } },
            429,
          ),
    );
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/too many requests/i);
    // The reference the user can quote in a bug report.
    expect(alert).toHaveTextContent('req-42');
  });

  it('recovers when the retry succeeds', async () => {
    let weatherCalls = 0;
    stubFetch((url) => {
      if (url.includes('/api/locations')) return jsonResponse(apiResponse(LOCATIONS));
      weatherCalls += 1;
      return weatherCalls === 1
        ? jsonResponse({ error: { code: 'UPSTREAM_UNAVAILABLE', message: 'down' } }, 502)
        : jsonResponse(apiResponse(WEATHER_SNAPSHOT));
    });
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);
    await user.click(await screen.findByRole('button', { name: /try again/i }));

    expect(await screen.findByText('29°')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('reports a dead network as being offline rather than as a server fault', async () => {
    stubFetch((url) => {
      if (url.includes('/api/locations')) return jsonResponse(apiResponse(LOCATIONS));
      return Promise.reject(new TypeError('Failed to fetch'));
    });
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await searchAndPick(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/offline/i);
  });
});

describe('search', () => {
  it('waits for the user to stop typing before hitting the API', async () => {
    const fetchMock = stubFetch(happyPath);
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await user.type(screen.getByRole('combobox'), 'Malaga');

    // Six characters typed, but the debounce collapses them into one request.
    await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 3000 });
    const searchCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/locations'),
    );
    expect(searchCalls.length).toBeLessThanOrEqual(2);
  });

  it('says so when nothing matches, instead of rendering an empty dropdown', async () => {
    stubFetch((url) =>
      url.includes('/api/locations')
        ? jsonResponse(apiResponse([]))
        : jsonResponse(apiResponse(WEATHER_SNAPSHOT)),
    );
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await user.type(screen.getByRole('combobox'), 'zzzzzz');

    expect(await screen.findByText(/no places match/i, {}, { timeout: 3000 })).toBeInTheDocument();
  });

  it('never sends a query the backend would reject as too short', async () => {
    const fetchMock = stubFetch(happyPath);
    const user = userEvent.setup();
    renderWithQuery(<App />);

    await user.type(screen.getByRole('combobox'), 'M');
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
