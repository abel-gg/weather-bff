import { useEffect, useState } from 'react';

/**
 * Debounces a rapidly changing value.
 *
 * On a type-ahead this is not a polish detail, it is the difference between one
 * request and one request per keystroke. "Barcelona" is nine characters: nine
 * round trips, nine cache lookups and nine potential upstream calls, to answer
 * a question the user had not finished asking. Multiply by traffic and the
 * search box becomes the most expensive thing in the product.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
