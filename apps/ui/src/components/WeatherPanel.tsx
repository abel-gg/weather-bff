import type { ResponseMeta, WeatherSnapshot } from '../api/types';
import type { SelectedLocation } from '../hooks/useWeather';
import { formatForecastDay, formatRelativeTime, formatTemperature } from '../utils/time';

export function StaleNotice({ meta }: { meta: ResponseMeta }) {
  if (!meta.stale) return null;

  /*
   * Stale data is a degraded state, not a failure, and the UI treats it that
   * way: a quiet strip above real content rather than an error screen that
   * throws away a working page. The user keeps the information; they are simply
   * told how old it is and left to judge it.
   */
  return (
    <p className="stale-notice" role="status">
      <span aria-hidden="true">🕓</span> Live data is unavailable — showing the last reading from{' '}
      <strong>{formatRelativeTime(meta.fetchedAt)}</strong>.
    </p>
  );
}

export function CurrentConditionsCard({
  location,
  snapshot,
  meta,
  isRefreshing,
}: {
  location: SelectedLocation;
  snapshot: WeatherSnapshot;
  meta: ResponseMeta;
  isRefreshing: boolean;
}) {
  const { current } = snapshot;

  return (
    <section className="panel current" aria-label={`Current weather in ${location.label}`}>
      <header className="current__header">
        <div>
          <h2 className="current__place">{location.label}</h2>
          <p className="current__timezone">{snapshot.timezone.replace('_', ' ')}</p>
        </div>
        {/*
          A background refresh gets a small inline hint instead of a skeleton.
          Replacing content the user is reading, to show them the same content a
          moment later, is a worse experience than a slightly stale number.
        */}
        {isRefreshing && (
          <span className="current__refreshing" role="status">
            Updating…
          </span>
        )}
      </header>

      <div className="current__reading">
        <span className="current__icon" aria-hidden="true">
          {current.condition.icon}
        </span>
        <p className="current__temperature">
          {formatTemperature(current.temperatureC)}
          <span className="current__unit">C</span>
        </p>
        <p className="current__condition">{current.condition.label}</p>
      </div>

      <dl className="metrics">
        <Metric label="Feels like" value={`${formatTemperature(current.apparentTemperatureC)}C`} />
        <Metric label="Humidity" value={`${Math.round(current.humidityPct)}%`} />
        <Metric label="Wind" value={`${Math.round(current.windSpeedKmh)} km/h`} />
        <Metric label="Precipitation" value={`${current.precipitationMm.toFixed(1)} mm`} />
      </dl>

      <p className="current__footnote">Updated {formatRelativeTime(meta.fetchedAt)}</p>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <dt className="metric__label">{label}</dt>
      <dd className="metric__value">{value}</dd>
    </div>
  );
}

export function ForecastStrip({ snapshot }: { snapshot: WeatherSnapshot }) {
  if (snapshot.forecast.length === 0) {
    // The provider can answer with current conditions and no daily block. That
    // is a partial success: show what we have rather than failing the screen.
    return null;
  }

  return (
    <section className="panel" aria-label="Seven day forecast">
      <h2 className="section-title">Next days</h2>
      <ol className="forecast">
        {snapshot.forecast.map((day, index) => (
          <li className="forecast__day" key={day.date}>
            <p className="forecast__name">{formatForecastDay(day.date, index)}</p>
            <span className="forecast__icon" aria-hidden="true">
              {day.condition.icon}
            </span>
            <span className="visually-hidden">{day.condition.label}</span>
            <p className="forecast__temps">
              <strong>{formatTemperature(day.maxTemperatureC)}</strong>{' '}
              <span className="forecast__min">{formatTemperature(day.minTemperatureC)}</span>
            </p>
            <p className="forecast__rain" title="Chance of precipitation">
              💧 {Math.round(day.precipitationProbabilityPct)}%
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
