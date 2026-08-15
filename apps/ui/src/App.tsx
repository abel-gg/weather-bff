import { useState } from 'react';
import { LocationSearch } from './components/LocationSearch';
import { EmptyState, ErrorState, WeatherSkeleton } from './components/StateViews';
import { CurrentConditionsCard, ForecastStrip, StaleNotice } from './components/WeatherPanel';
import { useWeather, type SelectedLocation } from './hooks/useWeather';
import { loadLastLocation, saveLastLocation } from './utils/location';

export function App() {
  const [location, setLocation] = useState<SelectedLocation | null>(() => loadLastLocation());
  const weather = useWeather(location);

  function select(next: SelectedLocation) {
    setLocation(next);
    saveLastLocation(next);
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Weather</h1>
        <p className="app__subtitle">Current conditions and the week ahead, anywhere.</p>
      </header>

      <LocationSearch onSelect={select} />

      <main className="app__main">{renderWeather()}</main>

      <footer className="app__footer">
        <p>
          Data from Open-Meteo, served through a caching backend-for-frontend. Readings can be up to
          ten minutes old by design.
        </p>
      </footer>
    </div>
  );

  /**
   * One explicit state machine, in priority order, rather than nested ternaries
   * scattered through the markup. Written this way the missing state is obvious
   * — which is exactly how "loading forever" and blank screens get shipped.
   */
  function renderWeather() {
    if (!location) return <EmptyState />;

    // Only show a skeleton when there is genuinely nothing to show. A refresh
    // over existing data is signalled inside the card instead.
    if (weather.isPending) return <WeatherSkeleton />;

    if (weather.isError) {
      return <ErrorState error={weather.error} onRetry={() => void weather.refetch()} />;
    }

    return (
      <>
        <StaleNotice meta={weather.data.meta} />
        <CurrentConditionsCard
          location={location}
          snapshot={weather.data.data}
          meta={weather.data.meta}
          isRefreshing={weather.isFetching}
        />
        <ForecastStrip snapshot={weather.data.data} />
      </>
    );
  }
}
