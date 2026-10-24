// js/ui/reset.js: resetSavedData() and ResetDataButton, the way out of a screen that cannot recover.
// Owner: ROBUST (final gate). Every fatal and error screen offers it next to Reload: clearing this browser's saved demo data (the state, its kept-aside
// copy, the unsent funnel draft and the boot-failure marker) and loading the page again always ends in a fresh, working prototype.
import { h, useEffect, useState } from '../vendor/preact-htm.js';
import { STORAGE_KEYS } from '../core/config.js';
import { Button } from './button.js';

/** Remove what this prototype saved in this browser (never throws) and load the page again. The theme choice stays. */
export function resetSavedData() {
  try { localStorage.removeItem(STORAGE_KEYS.state); } catch (e) { /* blocked: nothing was saved */ }
  try { localStorage.removeItem(STORAGE_KEYS.backup); } catch (e) { /* blocked */ }
  try { sessionStorage.removeItem(STORAGE_KEYS.draft); } catch (e) { /* blocked */ }
  try { sessionStorage.removeItem(STORAGE_KEYS.bootFail); } catch (e) { /* blocked */ }
  try { location.reload(); } catch (e) { /* no page to reload */ }
}

/** Two taps on purpose: the first asks, the second clears. Falls back to the first label after a few seconds. */
export function ResetDataButton({ variant = 'secondary', size, class: cls, ...rest }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(t);
  }, [armed]);
  return h(Button, {
    variant, size, class: cls, 'data-testid': 'reset-saved-data',
    onClick: () => { if (armed) resetSavedData(); else setArmed(true); },
    ...rest
  }, armed ? "Tap again to clear this browser's saved data" : 'Reset saved data');
}
