// js/landing/calc.js: pure maths for the "What could you save charging at home?" estimate (no DOM, no store, no clock).
// Owner: L3 (landing page for 180 Electrical)

/** Imperial gallon in litres: UK "miles per gallon" figures are per imperial gallon. */
export const LITRES_PER_GALLON = 4.54609;

/**
 * Example figures, shown on the page and editable there. They are round, plausible numbers for a typical UK car, NOT
 * 180 Electrical's prices and not tariff claims: the page says so next to the fields.
 */
export const CALC_DEFAULTS = Object.freeze({
  miles: 8000, // a year
  homePence: 27, // pence per kWh charging at home
  publicPence: 75, // pence per kWh at a public charger
  petrolPence: 140, // pence per litre
  mpg: 42, // petrol car, miles per gallon
  milesPerKwh: 3.5 // electric car efficiency
});

/** [min, max] each field accepts. Slider range for miles is narrower (see calculator.js); the box takes up to the max. */
export const CALC_LIMITS = Object.freeze({
  miles: [0, 100000],
  homePence: [1, 150],
  publicPence: [1, 250],
  petrolPence: [50, 300],
  mpg: [5, 150],
  milesPerKwh: [1, 8]
});

/** The plain words used in error messages. */
const FIELD_NAMES = {
  miles: 'miles a year',
  homePence: 'pence per kWh',
  publicPence: 'pence per kWh',
  petrolPence: 'pence per litre',
  mpg: 'miles per gallon',
  milesPerKwh: 'miles per kWh'
};

/** '8,000' | ' 3.5 ' | '27p' -> number, or NaN for anything that is not one clean number. */
export function parseNumber(text) {
  const raw = String(text ?? '').trim().replace(/,/g, '').replace(/(p|mi|miles)$/i, '').trim();
  if (raw === '' || !/^\d*\.?\d+$|^\d+\.$/.test(raw)) return NaN;
  return Number(raw);
}

/** '' when `text` is a number inside the limits for `key`, else a short plain message. */
export function fieldError(key, text) {
  const n = parseNumber(text);
  const [lo, hi] = CALC_LIMITS[key];
  if (!Number.isFinite(n)) return 'Enter a number.';
  if (n < lo || n > hi) return `Use a number between ${lo.toLocaleString('en-GB')} and ${hi.toLocaleString('en-GB')} ${FIELD_NAMES[key]}.`;
  return '';
}

/** The numbers actually used: each field's parsed value when valid, else its example default (so the card never shows NaN). */
export function resolveInputs(texts) {
  const out = {};
  for (const key of Object.keys(CALC_DEFAULTS)) {
    out[key] = fieldError(key, texts[key]) ? CALC_DEFAULTS[key] : parseNumber(texts[key]);
  }
  return out;
}

/**
 * The estimate. Every annual cost is rounded to whole pounds FIRST and the savings are differences of the rounded
 * figures, so what the card shows always adds up.
 *   kWh a year          = miles / miles per kWh
 *   home charging cost  = kWh x home pence / 100
 *   public charging     = kWh x public pence / 100
 *   petrol              = miles / mpg x 4.54609 litres x pence per litre / 100
 */
export function estimate(v) {
  const kwh = v.miles / v.milesPerKwh;
  const litres = (v.miles / v.mpg) * LITRES_PER_GALLON;
  const home = Math.round((kwh * v.homePence) / 100);
  const publicCost = Math.round((kwh * v.publicPence) / 100);
  const petrol = Math.round((litres * v.petrolPence) / 100);
  return {
    kwh: Math.round(kwh),
    litres: Math.round(litres),
    home,
    public: publicCost,
    petrol,
    saveVsPublic: publicCost - home,
    saveVsPetrol: petrol - home,
    // Pence per mile, one decimal, for the small print.
    perMile: {
      home: Math.round((v.homePence / v.milesPerKwh) * 10) / 10,
      public: Math.round((v.publicPence / v.milesPerKwh) * 10) / 10,
      petrol: Math.round(((v.petrolPence * LITRES_PER_GALLON) / v.mpg) * 10) / 10
    }
  };
}

/** 'save about' | 'cost about ... more' wording for one comparison, from a (rounded) saving. */
export function savingWords(saving) {
  if (saving > 0) return { tone: 'save', amount: saving };
  if (saving < 0) return { tone: 'more', amount: -saving };
  return { tone: 'same', amount: 0 };
}
