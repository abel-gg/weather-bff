import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isRetryable } from './api/errors';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // Coming back to a weather tab after lunch should not show lunchtime's
      // weather. staleTime is what stops that from becoming a request on every
      // tab switch.
      refetchOnWindowFocus: true,
      // Retry policy lives here rather than in each hook: it is one decision
      // about how the app treats failure, and holding it in one place means a
      // test (or a future feature flag) can replace it wholesale.
      //
      // Never retry a request that cannot succeed unchanged — a 400 retried
      // three times is three times the load for the same failure. Back off on
      // the ones that genuinely might recover.
      retry: (failureCount, error) => isRetryable(error) && failureCount < 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
