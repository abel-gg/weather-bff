import { ApiError, describeError } from '../api/errors';

/**
 * The three states that are not "success", kept together because they are one
 * design problem, not three afterthoughts.
 *
 * The rule applied throughout: a state must tell the user what happened, and
 * whether there is anything they can do about it. "Loading..." and "Error"
 * fail both halves.
 */

export function EmptyState() {
  return (
    <section className="panel state" aria-live="polite">
      <span className="state__icon" aria-hidden="true">
        🧭
      </span>
      <h2 className="state__title">Pick a place to start</h2>
      <p className="state__description">
        Search for a city above, or use your current location. We&apos;ll show conditions right now
        and the week ahead.
      </p>
    </section>
  );
}

/**
 * A skeleton, not a spinner.
 *
 * A spinner says "something is happening"; a skeleton says "here is the shape
 * of what is coming", reserves the layout so nothing jumps when data lands, and
 * makes the wait feel shorter for the same number of milliseconds.
 */
export function WeatherSkeleton() {
  return (
    <section
      className="panel"
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading the weather for the selected location"
    >
      <div className="skeleton skeleton--headline" />
      <div className="skeleton skeleton--temperature" />
      <div className="skeleton skeleton--line" />
      <div className="forecast" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <div className="skeleton skeleton--day" key={index} />
        ))}
      </div>
    </section>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { title, description, canRetry } = describeError(error);
  const requestId = error instanceof ApiError ? error.requestId : undefined;

  return (
    <section className="panel state state--error" role="alert">
      <span className="state__icon" aria-hidden="true">
        ⚠️
      </span>
      <h2 className="state__title">{title}</h2>
      <p className="state__description">{description}</p>

      {canRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}

      {/*
        The request id closes the loop between the UI and the logs: the user can
        quote one short string and an engineer can find the exact request in
        Loki. Without it, "it broke this morning" is the whole bug report.
      */}
      {requestId && (
        <p className="state__meta">
          Reference: <code>{requestId}</code>
        </p>
      )}
    </section>
  );
}
