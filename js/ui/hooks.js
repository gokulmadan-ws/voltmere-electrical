// js/ui/hooks.js: Preact bindings for the store and the browser (useStore, useNow, useMediaQuery, useBrand).
// Owner: WP2
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from '../vendor/preact-htm.js';
import { getState, subscribe } from '../core/store.js';
import { now } from '../core/clock.js';
import { selectBrand } from '../core/selectors.js';

/** Equal when same value, or arrays with the same elements, or plain objects with the same values (by reference). */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!Object.prototype.hasOwnProperty.call(b, k) || !Object.is(a[k], b[k])) return false;
  return true;
}

/**
 * Subscribe a component to a slice of the store. `selector(state)` should be a stable function
 * (declared outside the component). Re-renders only when the selected value changes (shallow).
 * Works in any Preact root, including Sheet content (it never uses context).
 */
export function useStore(selector, isEqual = shallowEqual) {
  const [, force] = useReducer((n) => n + 1, 0);
  const selectorRef = useRef(selector);
  const equalRef = useRef(isEqual);
  selectorRef.current = selector;
  equalRef.current = isEqual;
  const next = selector(getState());
  const last = useRef(next);
  // Keep the previous reference while the value is "equal", so props passed down stay stable.
  if (!isEqual(last.current, next)) last.current = next;
  useLayoutEffect(() => {
    const check = (state) => {
      const value = selectorRef.current(state);
      if (!equalRef.current(last.current, value)) { last.current = value; force(); }
    };
    const unsubscribe = subscribe(check);
    check(getState()); // the store may have changed between render and subscribe
    return unsubscribe;
  }, []);
  return last.current;
}

/** The current Date from the (possibly overridden) clock, refreshed every `intervalMs`. */
export function useNow(intervalMs = 30000) {
  const [value, setValue] = useState(() => now());
  useEffect(() => {
    const tick = () => setValue(now());
    const id = setInterval(tick, intervalMs);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [intervalMs]);
  return value;
}

/** True while the media query matches. */
export function useMediaQuery(query) {
  const read = () => (typeof matchMedia === 'function' ? matchMedia(query).matches : false);
  const [matches, setMatches] = useState(read);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return undefined;
    const mql = matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    if (mql.addEventListener) mql.addEventListener('change', onChange); else mql.addListener(onChange);
    return () => { if (mql.removeEventListener) mql.removeEventListener('change', onChange); else mql.removeListener(onChange); };
  }, [query]);
  return matches;
}

/** The live brand (name, phone, owner first name and so on) from the store. */
export function useBrand() {
  return useStore(selectBrand);
}
