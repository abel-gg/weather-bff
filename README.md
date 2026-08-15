# Weather

Current conditions and a seven-day forecast for any location. A React SPA in
front of a small Fastify service that caches aggressively and keeps working when
the weather provider does not.

```bash
npm ci
npm run dev                  # API on :3001, SPA on :5173
```

Or the way it actually ships:

```bash
docker compose up --build    # http://localhost:8080
```

No API keys and no `.env` needed to run it.

```bash
npm test        # 88 tests
npm run typecheck
npm run build
```

## How it works

```
  Browser ──▶ nginx ──▶ Fastify BFF ──▶ Open-Meteo
    │           │            │
    │           │            └── in-memory cache: TTL + stale-while-revalidate
    │           │                                 + single-flight
    │           └── static bundle, immutable assets, same-origin /api
    └── TanStack Query
```

The browser never talks to the weather provider. That single decision is what
the rest of the code is shaped around.

The context I designed for is a weather widget embedded in a retail site — not a
weather product, but a personalisation signal ("it's raining in Hamburg, lead
with coats") rendered across a very large number of page views. In that shape the
provider's quota is a finite shared resource and the cache hit ratio *is* the
product. Calling the provider straight from the browser would mean one upstream
request per user per page view, an API key in the bundle, no control over payload
size, and no way to survive a provider outage.

### The cache

| Concern | Mechanism |
| --- | --- |
| Key explosion | Coordinates rounded to 2 decimals (~1.1 km) |
| Freshness | 10-minute TTL |
| Thundering herd | Single-flight |
| Provider outage | Stale-while-revalidate, flagged in the response |
| Memory | LRU bound (`CACHE_MAX_ENTRIES`) |
| Downstream caches | `Cache-Control`, shortened when serving stale |

Two of those numbers came from probing the API rather than guessing. Open-Meteo
stamps `"interval": 900` on current conditions, so it recomputes every fifteen
minutes — which sets the scale for the TTL without setting the value. Ours sits
below that period on purpose: we cannot see the provider's phase, so what we
serve ages by the time since its last recompute *plus* our TTL. Matching fifteen
would push the worst case to half an hour and leave our refresh cycle running at
exactly their period, which can lock onto an unlucky phase and keep refreshing
just before each recompute. Ten costs roughly a third of refreshes returning
identical numbers, which is the price of bounding how old the answer can get. And
asking it for `36.72,-4.42` returns a payload stamped `36.75,-4.4375`: it snaps
every request onto a model grid of roughly 0.06°, about 6 km. Rounding our cache
key an order of magnitude finer than that discards no information at all, while
collapsing everyone in a neighbourhood onto one entry and therefore one upstream
call. Without it, raw GPS coordinates from mobile clients would produce a nearly
unique key per user and the hit ratio would approach zero exactly when traffic
peaks.

Single-flight matters for the same reason from the other direction: when a hot
key expires under load, N concurrent misses collapse into one upstream request.
Without it, the busiest moment is also the moment we hit the provider hardest.

Past the TTL a request gets the previous value immediately while a refresh runs
behind it. The trade-off is explicit — a caller just past the TTL sees data up to
ten minutes old — and for weather it is the right one. A ten-minute-old
temperature is still true; a spinner never is. If the background refresh fails,
the old value keeps being served and the response carries `meta.stale`.

The response model is ours rather than the provider's reshaped a little, so
swapping Open-Meteo for a paid provider is one adapter behind the
`WeatherProvider` port. That matters here: Open-Meteo's free tier is
non-commercial, so anything real would need a contract with someone.

## The API

| Endpoint | |
| --- | --- |
| `GET /api/weather?latitude&longitude` | Current conditions + 7-day forecast |
| `GET /api/locations?q&limit` | Place search |
| `GET /health/live` | Is the process wedged? |
| `GET /health/ready` | Should this instance receive traffic? |
| `GET /metrics` | Prometheus exposition |

Successful responses are `{ data, meta: { fetchedAt, stale } }`. Failures are
`{ error: { code, message, requestId } }`, including 404s — one envelope, always.

## When things go wrong

The failure states are the visible surface of everything above, so they are
treated as one design problem rather than three afterthoughts. The rule
throughout: a state has to say what happened and whether the user can do anything
about it.

Loading is a skeleton shaped like the real content, not a spinner, so nothing
jumps when data arrives. A refresh over data already on screen shows a small
inline hint instead — replacing something a person is reading, to show them the
same thing a moment later, is worse than a slightly stale number.

Errors keep the server's classification instead of collapsing into "something
went wrong". A rate limit, a timeout, an offline device and a validation failure
get different words and different affordances, and a validation error gets no
retry button at all, because retrying an identical bad request spends the user's
patience and our quota to reach the same failure. The `requestId` is rendered so
that a user can quote one short string and an engineer can find the exact log
line.

Stale data is not an error. It gets a quiet strip above real content — "showing
the last reading from 11 minutes ago" — and the user keeps the information.

A search that matched nothing returns 200 with an empty list and an empty state.
404 is for a resource that should have been there; a search that found nothing
succeeded.

Accessibility runs through the same seams: `role="alert"` for errors,
`role="status"` for stale and refresh notices, `aria-busy` on the skeleton, and a
real combobox with arrow-key navigation for the search.

### Seeing it for yourself

These paths are hard to trigger by hand — the provider is usually up — so they
are reachable from a script:

```bash
npm run demo:down     # provider unreachable, cold cache  -> 502 and the error state
npm run demo:slow     # provider too slow                 -> 504, different copy
npm run demo:stale    # provider dies with a warm cache   -> cached data + stale notice
```

Each starts the app with nothing but the environment variables the service
already reads, so what you see is the real code path rather than a demo branch
that only exists to be demonstrated. `demo:stale` is the one worth watching: it
hosts a throwaway upstream, lets you load a city, then kills it and tells you
when to reload.

One caveat the script repeats, because it will otherwise hide its own point:
pick a city you have not viewed yet. A successful response carries
`Cache-Control: max-age=600`, so the browser will answer a repeat visit itself
without ever reaching the server.

## Operating it

Logs are structured JSON through pino. Every request carries a `requestId` taken
from an inbound `X-Request-Id` when there is one — nginx generates it at the edge
— so a trace survives across hops, and it comes back on every response.

Coordinates are rounded before they reach a log line. A precise latitude and
longitude pair is personal data: it is where someone physically is. Logs get
shipped, indexed and retained far longer than any request, so full-precision
coordinates sitting in an aggregator are a GDPR finding waiting to be made. They
are rounded to the same grid as the cache key, which keeps the logs useful for
debugging while dropping the precision that identifies a person.

Expected failures log at `warn` and unexpected ones at `error`, which is what
makes the error stream worth alerting on.

The Prometheus metrics answer three questions in priority order. Is the cache
working — `cache_events_total`, whose hit ratio is the leading indicator, since
when it drops upstream load rises proportionally. Is the provider healthy —
`upstream_duration_seconds`, kept separate from our own latency so their
regression is never misread as ours. Are users being served —
`http_request_duration_seconds`. Every label has bounded cardinality: HTTP
metrics are labelled by route *pattern*, never URL, because a label per
coordinate pair would take Prometheus down long before traffic took us down.

Liveness and readiness are separate because a failed probe means different
things. Readiness deliberately does not check the weather provider — this service
is built to survive a provider outage, so making readiness depend on it would
pull every instance out of the load balancer at exactly the moment the fallback
was doing its job.

Alerting would follow the same logic: page on what users feel — 5xx served, hit
ratio outside its band, p99 — and not on the provider failing, which this service
is designed to absorb.

## Tests

The cache is tested hardest, because it is the component whose failure is silent
and expensive. Time is injected rather than faked globally, so the policy tests
have no timers and no flake. They prove that fifty concurrent misses on a cold
key produce one upstream call, that a stale value is served while a refresh runs
behind it, that a provider outage keeps the last good value flowing instead of
raising, that a failed cold load does not poison the in-flight map, and that
eviction is least-recently-*used*.

The upstream adapter is tested against a payload captured verbatim from the live
API. Hand-written fixtures test the shape you assumed; captured ones test the
shape you were actually sent, which is how the grid snapping and the columnar
`daily` arrays got handled at all.

HTTP tests run through `app.inject` — real router, real schemas, real error
handler, real cache, with only the network replaced. On the frontend they target
the state machine rather than individual components, because what breaks in
practice is a spinner that never resolves or an error that renders blank, not a
card with the wrong degree symbol; those bugs only exist in the composition.

## Deployment

Two images, both built from the repository root. The API image is multi-stage
with production dependencies only and a non-root user; its entrypoint is `node`
rather than `npm`, because npm swallows signals and SIGTERM would never reach the
process, turning every deploy into a SIGKILL instead of the graceful shutdown the
service implements. The SPA is built with Node and served by nginx, so its
runtime image contains no Node at all.

nginx serves the bundle, proxies `/api` same-origin so CORS never enters the
production path, caches fingerprinted assets for a year and explicitly does not
cache `index.html`.

CI runs `npm ci` — not `install`, so a drifted lockfile fails the build rather
than quietly resolving a different tree — then typecheck, tests and build,
cheapest first. It builds both images on every PR and pushes none. A third job
starts the compose stack and smoke-tests the topology itself, which no unit or
integration test covers and which is exactly the part that only fails once
deployed. Its proxy assertion uses an endpoint that makes no upstream call, so
the job tests our wiring rather than a third party's uptime.

The release process I would use around this is trunk-based: images tagged with
the commit SHA, staging on merge, production as a manual promotion of an
already-built artifact rather than a rebuild, so the thing tested is the thing
shipped. Rollback is redeploying the previous SHA, which stays simple precisely
because the service holds no persistent state.

## Configuration

Every value is optional; see [`.env.example`](.env.example) for the full list and
[`apps/api/src/config.ts`](apps/api/src/config.ts) for the defaults. Invalid
configuration crashes the process at boot rather than on the first request that
happens to need it.

## Known limitations

The cache is per-instance, so horizontal scaling costs hit ratio — ten instances
mean up to ten upstream calls per key instead of one. The fix is a shared tier
(Redis) with the in-process cache kept as L1, and `TtlCache` is the seam it slots
into. Single-flight has the same boundary: it deduplicates within one process,
and across a fleet you would need coalescing at the shared tier.

There is no infrastructure as code here: a half-written Terraform module that
cannot `plan` is worse than none, because it looks like infrastructure and is
not. What I would codify
first is what costs money and hurts to rebuild by hand: the runtime — this is a
stateless HTTP service with a health check, so a managed container runtime rather
than a Kubernetes cluster for two containers — then the alerts and dashboards,
in this same repository, since alerts defined by hand in a console drift from the
code emitting the metrics and nobody notices until the page that should have
fired didn't. Any caching layer in front of the service belongs there too, for
the same reason the caching inside it was worth this much attention: it is the
part that decides how much traffic ever reaches the provider.

There is no end-to-end test; one Playwright spec against `docker compose up`
covering search → select → render, plus a forced-outage run proving the stale
banner appears, is what I would add first. Nor is there a load test, which is the
honest gap given that the whole design is about behaviour under load — the
single-flight and hit-ratio claims are proven by unit tests, not by a k6 run
driving a realistic key distribution.

[`apps/ui/src/api/types.ts`](apps/ui/src/api/types.ts) is a hand-maintained
mirror of the API contract — the weakest seam in the repository. The fix is
generating it from the Fastify JSON schemas via OpenAPI so the two sides cannot
drift silently. Upstream payloads are validated with hand-rolled type guards for
the same reason they are validated at all; Zod or TypeBox is what I would use in
production.

The service does no rate limiting of its own. The cache absorbs the load this was
designed against, but a public endpoint at scale needs it, and it belongs at the
ingress. `/metrics` is likewise exposed in the compose setup and would sit on an
internal port behind an ingress rule.

## A note on the lockfile

The platform binaries pinned in the root `optionalDependencies` look odd until
you hit the reason: Rollup and esbuild ship one native package per platform, and
npm records only the current platform's when it writes a lockfile
([npm/cli#4828](https://github.com/npm/cli/issues/4828)) — so a lockfile
generated on Windows cannot `npm ci` on Linux. Declaring them all forces each
into the lockfile with its own `os`/`cpu` constraint, and npm installs only the
one that matches. `.npmrc` pins `legacy-peer-deps=false` so the tree does not
depend on a developer's `~/.npmrc` either.
