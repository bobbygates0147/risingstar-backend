const SUPPORTED_PAYMENT_METHODS = ['crypto', 'wallet'];

function toUsd(value) {
  return Number(value.toFixed(2));
}

function parsePositiveUsd(name, fallback) {
  const raw = process.env[name];
  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return toUsd(parsed);
}

function parsePaymentMethods() {
  const raw = String(process.env.REGISTRATION_PAYMENT_METHODS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  const filtered = raw.filter((item) => SUPPORTED_PAYMENT_METHODS.includes(item));

  if (filtered.length === 0) {
    return SUPPORTED_PAYMENT_METHODS;
  }

  return Array.from(new Set(filtered));
}

function parseNonEmpty(name, fallback) {
  const raw = String(process.env[name] || '').trim();
  return raw.length > 0 ? raw : fallback;
}

function getRegistrationTiers() {
  return [
    {
      id: 'tier1',
      label: 'Tier 1',
      feeUsd: parsePositiveUsd('TIER1_REGISTRATION_FEE_USD', 12.7),
    },
    {
      id: 'tier2',
      label: 'Tier 2',
      feeUsd: parsePositiveUsd('TIER2_REGISTRATION_FEE_USD', 25.4),
    },
    {
      id: 'tier3',
      label: 'Tier 3',
      feeUsd: parsePositiveUsd('TIER3_REGISTRATION_FEE_USD', 36.28),
    },
  ];
}

function normalizeTierInput(value) {
  const raw = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  if (raw === 'tier1') return 'tier1';
  if (raw === 'tier2') return 'tier2';
  if (raw === 'tier3') return 'tier3';

  return '';
}

function resolveTier(value) {
  const normalized = normalizeTierInput(value);
  if (!normalized) {
    return null;
  }

  return getRegistrationTiers().find((tier) => tier.id === normalized) || null;
}

function normalizePaymentMethod(value) {
  return String(value || '').trim().toLowerCase();
}

function isSupportedPaymentMethod(value) {
  const normalized = normalizePaymentMethod(value);
  return parsePaymentMethods().includes(normalized);
}

function isSupportedAIBotPaymentMethod(value) {
  const normalized = normalizePaymentMethod(value);
  return normalized === 'wallet' || isSupportedPaymentMethod(normalized);
}

function getSignupPricingConfig() {
  const paymentMethods = parsePaymentMethods();

  return {
    currency: 'USD',
    paymentMethods,
    tiers: getRegistrationTiers(),
    aiBotFeeUsd: parsePositiveUsd('AI_BOT_FEE_USD', 18.14),
    paymentInstructions: {
      crypto: {
        btcAddress: parseNonEmpty('CRYPTO_BTC_ADDRESS', 'bc1q9xy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'),
        ethAddress: parseNonEmpty('CRYPTO_ETH_ADDRESS', '0x83B2dB6C9aE0f1E5C4a2d5B1a9d4E6f8b9C0d1e2'),
        usdtTrc20Address: parseNonEmpty(
          'CRYPTO_USDT_TRC20_ADDRESS',
          'TQ7QK1v7n3d8S3qE8P4m4K9r2q8p5y6z7a'
        ),
        usdtErc20Address: parseNonEmpty(
          'CRYPTO_USDT_ERC20_ADDRESS',
          '0x83B2dB6C9aE0f1E5C4a2d5B1a9d4E6f8b9C0d1e2'
        ),
        usdtBep20Address: parseNonEmpty(
          'CRYPTO_USDT_BEP20_ADDRESS',
          '0x6fC2b1A9D0c3E7f8a2B4c5D6e7F8a9B0c1D2E3f4'
        ),
        solAddress: parseNonEmpty('CRYPTO_SOL_ADDRESS', '9p9d6QZ7f2rZQ5m5bS8d5oJpQw4KfVb7mL2cT8yXhV4A'),
      },
    },
  };
}

module.exports = {
  getSignupPricingConfig,
  isSupportedAIBotPaymentMethod,
  isSupportedPaymentMethod,
  normalizePaymentMethod,
  resolveTier,
  toUsd,
};
