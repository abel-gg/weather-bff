/**
 * Runs the app in a chosen failure mode so the degradation behaviour can be
 * seen rather than taken on trust.
 *
 *   npm run demo:down    provider unreachable      -> 502, error state
 *   npm run demo:slow    provider too slow         -> 504, a different message
 *   npm run demo:stale   provider dies while warm  -> cached data + stale notice
 *
 * Nothing here reaches into the application. Every mode is produced purely by
 * the environment variables the service already reads, so what you are seeing
 * is the real code path and not a demo branch that only exists for the show.
 * The one exception is `stale`, which needs an upstream that can be killed on
 * command, so this script hosts a throwaway one and points the service at it
 * through the same OPEN_METEO_FORECAST_URL any deployment would use.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

const FAKE_UPSTREAM_PORT = 4555;
const API_PORT = 3001;
const WEB_PORT = 5173;

const MODES = {
  ok: {
    title: 'NORMAL',
    steps: ['Search for a city and pick it. You should see real weather.'],
    env: {},
  },
  down: {
    title: 'PROVIDER UNREACHABLE  ->  expect a 502',
    steps: [
      'Search for a city you have NOT looked at before, and pick it.',
      '',
      'Why a new one: a successful response is sent with Cache-Control',
      'max-age=600, so your browser will happily serve a city you already',
      'viewed without asking the server at all. That is the caching layer',
      'doing its job, and it will hide this demo from you.',
      '',
      'The search itself still works — only the forecast upstream is broken.',
      'On selecting the city you should get the error panel, carrying the',
      'request id that also appears in the server log.',
    ],
    env: { OPEN_METEO_FORECAST_URL: 'http://127.0.0.1:9/unreachable' },
  },
  slow: {
    title: 'PROVIDER TOO SLOW  ->  expect a 504',
    steps: [
      'Again, pick a city you have not viewed yet.',
      '',
      'The copy differs from the "down" mode: a timeout and an unreachable',
      'host are different incidents and the UI says so.',
    ],
    env: { UPSTREAM_TIMEOUT_MS: '1' },
  },
  stale: {
    title: 'PROVIDER DIES WITH A WARM CACHE  ->  the point of the whole design',
    steps: [
      '1. Search for a city and pick it. You get normal weather, served from',
      '   a throwaway upstream this script is hosting.',
      '2. After 30 seconds the script kills that upstream and tells you.',
      '3. Reload the page.',
      '4. You still get the weather, with a notice saying how old it is.',
      '',
      'The provider is gone and the user is still served. Watch the terminal',
      'too: the failed background refresh is logged at warn, not error.',
    ],
    env: {
      WEATHER_TTL_MS: '8000',
      OPEN_METEO_FORECAST_URL: `http://127.0.0.1:${FAKE_UPSTREAM_PORT}/v1/forecast`,
    },
  },
};

const mode = (process.argv[2] ?? 'ok').toLowerCase();
const chosen = MODES[mode];

if (!chosen) {
  console.error(`Unknown mode "${mode}". Use one of: ${Object.keys(MODES).join(', ')}`);
  process.exit(1);
}

const rule = '-'.repeat(72);

/**
 * This script starts both the API and the web server itself. If either port is
 * already taken the failure is confusing rather than obvious — Vite silently
 * moves to another port and then proxies to the wrong API — so check first.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const done = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.on('connect', () => done(true));
    socket.on('error', () => done(false));
    setTimeout(() => done(false), 600);
  });
}

for (const [port, what] of [
  [API_PORT, 'the API'],
  [WEB_PORT, 'the web server'],
]) {
  if (await portInUse(port)) {
    console.error(`\n  Port ${port} is already in use (${what}).`);
    console.error('  Something else is running, most likely "npm run dev".');
    console.error('  Stop it first: this script starts both processes on its own.\n');
    process.exit(1);
  }
}

console.log(`\n${rule}\n  MODE: ${chosen.title}\n${rule}`);

let fakeUpstream = null;
if (mode === 'stale') {
  const today = new Date().toISOString().slice(0, 10);
  const payload = {
    latitude: 36.75,
    longitude: -4.4375,
    timezone: 'Europe/Madrid',
    current: {
      time: new Date().toISOString().slice(0, 16),
      interval: 900,
      temperature_2m: 27.5,
      relative_humidity_2m: 58,
      apparent_temperature: 30.1,
      is_day: 1,
      precipitation: 0,
      weather_code: 1,
      wind_speed_10m: 7.4,
    },
    daily: {
      time: [today],
      weather_code: [1],
      temperature_2m_max: [30.1],
      temperature_2m_min: [22.0],
      precipitation_probability_max: [10],
    },
  };

  fakeUpstream = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  });
  await new Promise((resolve) => fakeUpstream.listen(FAKE_UPSTREAM_PORT, resolve));
}

// shell: true is required for npm on Windows; the command is a single string
// rather than (command, args) so Node does not warn about DEP0190.
const start = (script, extraEnv = {}) =>
  spawn(`npm run ${script}`, {
    cwd: REPO_ROOT,
    shell: true,
    env: { ...process.env, ...extraEnv },
  });

const api = start('dev:api', chosen.env);
const web = start('dev:ui');

// Only surface what is worth reading: the service's own warnings and errors.
api.stdout.on('data', (chunk) => {
  for (const line of String(chunk).trim().split('\n')) {
    try {
      const log = JSON.parse(line);
      if (log.level >= 40) {
        console.log(`   [server] ${log.msg}${log.err ? ` - ${log.err}` : ''}`);
      }
    } catch {
      /* startup noise, not a log line */
    }
  }
});

setTimeout(() => {
  console.log('\n  WHAT TO DO:');
  for (const step of chosen.steps) console.log(`   ${step}`);
  console.log(`\n   OPEN:  http://localhost:${WEB_PORT}`);
  if (mode !== 'ok') {
    console.log('\n   Still seeing normal weather? Open devtools, tick "Disable cache"');
    console.log('   on the Network tab and reload — the browser is answering for us.');
  }
  console.log(`\n   Ctrl+C to stop.\n${rule}`);
}, 4000);

if (mode === 'stale') {
  let remaining = 30;
  const countdown = setInterval(() => {
    remaining -= 10;
    if (remaining > 0) console.log(`   ... killing the upstream in ${remaining}s`);
  }, 10_000);

  setTimeout(() => {
    clearInterval(countdown);
    fakeUpstream.close();
    console.log(`\n${rule}`);
    console.log('  UPSTREAM KILLED. Wait a few seconds, then reload the page.');
    console.log('  The weather should still be there, with a notice about its age.');
    console.log(rule);
  }, 30_000);
}

const stop = () => {
  api.kill();
  web.kill();
  fakeUpstream?.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
