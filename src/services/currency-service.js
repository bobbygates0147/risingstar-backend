const axios = require('axios');

const {
  FALLBACK_USD_RATES,
  getCountryCurrencyOptions,
} = require('../data/country-currency');

const DEFAULT_RATE_CACHE_MS = 60 * 60 * 1000;
const DEFAULT_RATE_TIMEOUT_MS = 5000;

let liveRateCache = null;

function getRateCacheMs() {
  const value = Number(process.env.CURRENCY_RATE_CACHE_MS || DEFAULT_RATE_CACHE_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RATE_CACHE_MS;
}

function getRateTimeoutMs() {
  const value = Number(process.env.CURRENCY_RATE_TIMEOUT_MS || DEFAULT_RATE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RATE_TIMEOUT_MS;
}

function sanitizeRates(input) {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const supportedCurrencies = new Set([
    ...Object.keys(FALLBACK_USD_RATES),
    ...getCountryCurrencyOptions().map((country) => country.currency),
  ]);

  return Object.entries(input).reduce((accumulator, [currency, rate]) => {
    const currencyCode = String(currency || '').trim().toUpperCase();

    if (
      supportedCurrencies.has(currencyCode) &&
      typeof rate === 'number' &&
      Number.isFinite(rate) &&
      rate > 0
    ) {
      accumulator[currencyCode] = rate;
    }

    return accumulator;
  }, {});
}

function getFallbackRateTable() {
  return {
    base: 'USD',
    rates: FALLBACK_USD_RATES,
    source: 'fallback',
    updatedAt: new Date().toISOString(),
  };
}

async function getUsdRateTable() {
  const now = Date.now();

  if (liveRateCache && now - liveRateCache.fetchedAt < getRateCacheMs()) {
    return liveRateCache.payload;
  }

  try {
    const response = await axios.get('https://open.er-api.com/v6/latest/USD', {
      timeout: getRateTimeoutMs(),
    });
    const sanitized = sanitizeRates(response.data?.rates);

    if (Object.keys(sanitized).length === 0) {
      throw new Error('Currency rate payload invalid');
    }

    const payload = {
      base: 'USD',
      rates: {
        ...FALLBACK_USD_RATES,
        ...sanitized,
      },
      source: 'live',
      updatedAt: new Date().toISOString(),
    };

    liveRateCache = {
      fetchedAt: now,
      payload,
    };

    return payload;
  } catch {
    return getFallbackRateTable();
  }
}

async function convertFromUsd(amountUsd, currencyCode) {
  const amount = Number(amountUsd);

  if (!Number.isFinite(amount)) {
    throw new Error('Valid USD amount is required');
  }

  const rateTable = await getUsdRateTable();
  const currency = String(currencyCode || 'USD').trim().toUpperCase();
  const rate = rateTable.rates[currency] || FALLBACK_USD_RATES[currency] || 1;

  return {
    amountUsd: amount,
    convertedAmount: amount * rate,
    currency,
    rate,
    source: rateTable.source,
    updatedAt: rateTable.updatedAt,
  };
}

module.exports = {
  convertFromUsd,
  getUsdRateTable,
};
