// js/ui/storage-note.js: StorageNote, the calm "this browser is not saving anything" line shown where it matters.
// Owner: ROBUST (final gate). Private windows, blocked site data and a refused write all drop the store to memory mode (see core/store.js);
// the pages keep working, and this says so plainly in the place where the person would otherwise lose something.
import { h } from '../vendor/preact-htm.js';
import { getStorageStatus } from '../core/store.js';
import { useStore } from './hooks.js';
import { Banner } from './display.js';

const selectMode = () => getStorageStatus().mode;

const COPY = {
  dashboard: 'This browser is not saving anything (a private window, or site data is blocked). What you do here is kept only while this tab stays open and is gone when you close or reload it. Use a normal window, or allow site data for this page, to keep your work.',
  confirmation: (phone) => `This browser is not saving anything, so this page is gone if you close or reload it. To be sure we have your enquiry, send it on WhatsApp from the top of this page${phone ? `, or call ${phone}` : ''}.`,
  quote: 'This browser is not saving anything, so this page will not remember your reply if you close or reload it. Your message only reaches us once you send it in WhatsApp.'
};

/**
 * Renders nothing while the store is persisting. `where`: 'dashboard' | 'confirmation' | 'quote'. `phone` (confirmation only) is the number to call.
 * Re-renders by itself if a write is refused mid-session and the store drops to memory mode.
 */
export function StorageNote({ where = 'dashboard', phone = '', class: cls, ...rest }) {
  const mode = useStore(selectMode);
  if (mode === 'local') return null;
  const text = typeof COPY[where] === 'function' ? COPY[where](phone) : COPY[where] || COPY.dashboard;
  return h(Banner, { tone: 'warn', icon: 'info', class: cls, 'data-testid': 'storage-note', 'data-where': where, ...rest }, text);
}
