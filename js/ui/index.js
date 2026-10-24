// js/ui/index.js: barrel that re-exports the whole UI kit (import everything from here).
// Owner: B3 (was WP2); V3 components added by B3, documented in docs/V3-UI.md
export { ICONS, ICON_NAMES } from './icons.js';
export { cx, uid, copyText, saveFile, failureMessage, STORAGE_FULL_TEXT, pageHref, pageTarget, focusTitle } from './util.js';
export { useStore, useNow, useMediaQuery, useBrand, shallowEqual } from './hooks.js';
export {
  Icon, BrandMark, Chip, StatusPill, SampleTag, Card, Avatar, EmptyState, Stat, Banner, Skeleton, PageHeader, TextLink
} from './display.js';
export { Button, IconButton } from './button.js';
export { Field, Input, Select, Textarea, Switch, Segmented, Stepper, MoneyInput } from './form.js';
export { Sheet, ConfirmDialog } from './sheet.js';
export { toast, dismissToast, showUndoToast, ToastHost } from './toast.js';
export { WhatsAppBubble, PhoneMock } from './whatsapp.js';
export { PrototypeNotice } from './notice.js';
export { StorageNote } from './storage-note.js';
export { ResetDataButton, resetSavedData } from './reset.js';
export { isCleanMode, initClean } from './clean.js';
export { ThemeToggle, getTheme, setThemeChoice, applyTheme, initTheme } from './theme.js';
export { bootApp } from './boot.js';
export { loadCss } from './load-css.js';
// V3 kit
export { Wizard } from './wizard.js';
export { CopyField, CodeBlock } from './copy.js';
export { StatusDot, ConnectionBadge, connectionState, Timeline, Meter, ProgressRing } from './status.js';
export { Tabs, TabPanel } from './tabs.js';
export { QrCode, makeQr, qrSvgMarkup } from './qr.js';
export { ConsentSheet } from './consent.js';
export { SimBanner, RealBuildNote, Disclosure } from './sim.js';
export { ListRow, DataTable, KeyValueList } from './rows.js';
// T11
export { startEdgeFade } from './edge-fade.js';
