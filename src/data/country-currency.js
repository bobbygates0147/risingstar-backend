const countryData = require('./country-data.koinfu.json');
const countryMetadata = require('./country-metadata.koinfu.json');

function resolveCurrencyName(currencyCode) {
  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'currency' });
    return displayNames.of(currencyCode) || currencyCode;
  } catch {
    return currencyCode;
  }
}

function resolveCurrencySymbol(currencyCode, locale = 'en-US') {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      currency: currencyCode,
      style: 'currency',
    });
    const symbol = formatter
      .formatToParts(0)
      .find((part) => part.type === 'currency')?.value;

    return symbol || currencyCode;
  } catch {
    return currencyCode;
  }
}

function createFallbackCountryCode(countryName) {
  const letters = String(countryName || '').replace(/[^A-Za-z]/g, '').toUpperCase();
  const first = letters.slice(0, 1) || 'C';
  const second = letters.slice(1, 2) || 'X';
  return `${first}${second}`;
}

function normalizeCountryCode(value) {
  return String(value || '').trim().toUpperCase();
}

const metadataByName = new Map(countryMetadata.map((entry) => [entry.name, entry]));

const dedupedByCountryName = countryData.reduce((accumulator, row) => {
  const name = String(row.name || '').trim();
  const currency = String(row.currencyCode || '').trim().toUpperCase();

  if (!name || !currency) {
    return accumulator;
  }

  if (!accumulator.has(name)) {
    accumulator.set(name, { name, currency });
  }

  return accumulator;
}, new Map());

const COUNTRY_CURRENCY_OPTIONS = Array.from(dedupedByCountryName.values())
  .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  .map((row) => {
    const metadata = metadataByName.get(row.name);
    const locale = metadata?.locale || 'en-US';

    return {
      code: metadata?.code || createFallbackCountryCode(row.name),
      name: row.name,
      currency: row.currency,
      currencyName: resolveCurrencyName(row.currency),
      currencySymbol: resolveCurrencySymbol(row.currency, locale),
      locale,
      phoneCode: metadata?.phoneCode || '+',
    };
  });

const DEFAULT_COUNTRY_CODE = 'US';
const COUNTRY_BY_CODE = new Map(COUNTRY_CURRENCY_OPTIONS.map((country) => [country.code, country]));
const COUNTRY_BY_NAME = new Map(
  COUNTRY_CURRENCY_OPTIONS.map((country) => [country.name.toLowerCase(), country])
);

const fallbackRateBase = COUNTRY_CURRENCY_OPTIONS.reduce((accumulator, country) => {
  accumulator[country.currency] = 1;
  return accumulator;
}, {});

const FALLBACK_USD_RATES = {
  ...fallbackRateBase,
  USD: 1,
  NGN: 1550,
  GBP: 0.79,
  EUR: 0.92,
  CAD: 1.36,
  AUD: 1.53,
  INR: 83.2,
  KES: 129.3,
  ZAR: 18.4,
  BRL: 5.1,
  JPY: 152.8,
  AED: 3.67,
  SAR: 3.75,
  GHS: 15.2,
  EGP: 48.5,
  MXN: 17.1,
  SGD: 1.35,
  CNY: 7.24,
  CHF: 0.9,
  TRY: 32.2,
};

function getCountryCurrencyOptions() {
  return COUNTRY_CURRENCY_OPTIONS;
}

function getCountryOptionByCode(countryCode) {
  return COUNTRY_BY_CODE.get(normalizeCountryCode(countryCode)) || COUNTRY_BY_CODE.get(DEFAULT_COUNTRY_CODE);
}

function resolveCountrySelection({ countryCode, country, currency } = {}) {
  const normalizedCountryCode = normalizeCountryCode(countryCode);
  const cleanCountry = String(country || '').trim();
  const requestedCurrency = String(currency || '').trim().toUpperCase();

  let option = normalizedCountryCode ? COUNTRY_BY_CODE.get(normalizedCountryCode) : null;

  if (!option && cleanCountry) {
    option =
      COUNTRY_BY_NAME.get(cleanCountry.toLowerCase()) ||
      COUNTRY_BY_CODE.get(normalizeCountryCode(cleanCountry));
  }

  if (!option && !normalizedCountryCode && !cleanCountry) {
    option = getCountryOptionByCode(DEFAULT_COUNTRY_CODE);
  }

  if (!option) {
    throw new Error('Valid country is required');
  }

  if (requestedCurrency && requestedCurrency !== option.currency) {
    throw new Error(`Currency must be ${option.currency} for ${option.name}`);
  }

  return option;
}

module.exports = {
  DEFAULT_COUNTRY_CODE,
  FALLBACK_USD_RATES,
  getCountryCurrencyOptions,
  getCountryOptionByCode,
  resolveCountrySelection,
};
