require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../src/models/User');
const {
  normalizeStoredRegistrationStatus,
  resolveRegistrationVerificationStatus,
} = require('../src/services/registration-state');
const { resolveTier, normalizePaymentMethod, toUsd } = require('../src/config/pricing');

function normalizeTierLabel(value) {
  const tier = resolveTier(value);
  return tier ? tier.label : String(value || 'Tier 1').trim() || 'Tier 1';
}

function normalizePositiveAmount(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? toUsd(amount) : 0;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizePaymentField(value) {
  const normalized = normalizePaymentMethod(value);
  return normalized || null;
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const users = await User.find().sort({ createdAt: 1 });
  const summary = {
    scanned: users.length,
    updated: 0,
    registrationStatusFixed: 0,
    paymentFieldsFixed: 0,
    tierLabelsFixed: 0,
    feeFieldsFixed: 0,
  };

  for (const user of users) {
    let changed = false;

    const normalizedTier = normalizeTierLabel(user.tier);
    if (user.tier !== normalizedTier) {
      user.tier = normalizedTier;
      summary.tierLabelsFixed += 1;
      changed = true;
    }

    const normalizedRegistrationMethod = normalizePaymentField(user.registrationPaymentMethod);
    if ((user.registrationPaymentMethod || null) !== normalizedRegistrationMethod) {
      user.registrationPaymentMethod = normalizedRegistrationMethod;
      summary.paymentFieldsFixed += 1;
      changed = true;
    }

    const normalizedUpgradeMethod = normalizePaymentField(user.tierUpgradePaymentMethod);
    if ((user.tierUpgradePaymentMethod || null) !== normalizedUpgradeMethod) {
      user.tierUpgradePaymentMethod = normalizedUpgradeMethod;
      summary.paymentFieldsFixed += 1;
      changed = true;
    }

    const registrationFeeUsd = normalizePositiveAmount(user.registrationFeeUsd);
    const registrationPaymentAmountUsd = normalizePositiveAmount(user.registrationPaymentAmountUsd);
    const tierUpgradePaymentAmountUsd = normalizePositiveAmount(user.tierUpgradePaymentAmountUsd);

    const repairedRegistrationFeeUsd =
      registrationFeeUsd || registrationPaymentAmountUsd || 0;
    const repairedRegistrationPaymentAmountUsd =
      registrationPaymentAmountUsd || registrationFeeUsd || 0;

    if (Number(user.registrationFeeUsd || 0) !== repairedRegistrationFeeUsd) {
      user.registrationFeeUsd = repairedRegistrationFeeUsd;
      summary.feeFieldsFixed += 1;
      changed = true;
    }

    if (Number(user.registrationPaymentAmountUsd || 0) !== repairedRegistrationPaymentAmountUsd) {
      user.registrationPaymentAmountUsd = repairedRegistrationPaymentAmountUsd;
      summary.feeFieldsFixed += 1;
      changed = true;
    }

    if (Number(user.tierUpgradePaymentAmountUsd || 0) !== tierUpgradePaymentAmountUsd) {
      user.tierUpgradePaymentAmountUsd = tierUpgradePaymentAmountUsd;
      summary.feeFieldsFixed += 1;
      changed = true;
    }

    const storedStatus = normalizeStoredRegistrationStatus(user.registrationVerificationStatus);
    const paidAt = normalizeDate(user.registrationPaidAt);
    const verifiedAt = normalizeDate(user.registrationVerifiedAt);
    const submittedAt = normalizeDate(user.registrationPaymentSubmittedAt);
    const createdAt = normalizeDate(user.createdAt) || new Date();

    let nextStatus = storedStatus;
    let nextPaidAt = paidAt;
    let nextVerifiedAt = verifiedAt;

    if (user.role === 'admin') {
      nextStatus = 'verified';
      nextPaidAt = null;
      nextVerifiedAt = verifiedAt || createdAt;
    } else if (storedStatus === 'rejected') {
      nextPaidAt = null;
      nextVerifiedAt = verifiedAt || new Date();
    } else if (paidAt || storedStatus === 'verified') {
      nextStatus = 'verified';
      nextPaidAt = paidAt || verifiedAt || submittedAt || createdAt;
      nextVerifiedAt = verifiedAt || nextPaidAt;
    } else {
      nextStatus = 'pending';
      nextPaidAt = null;
      nextVerifiedAt = null;
    }

    if (resolveRegistrationVerificationStatus(user) !== nextStatus) {
      summary.registrationStatusFixed += 1;
    }

    if ((user.registrationVerificationStatus || '') !== nextStatus) {
      user.registrationVerificationStatus = nextStatus;
      changed = true;
    }

    const currentPaidAtIso = user.registrationPaidAt ? new Date(user.registrationPaidAt).toISOString() : '';
    const nextPaidAtIso = nextPaidAt ? nextPaidAt.toISOString() : '';
    if (currentPaidAtIso !== nextPaidAtIso) {
      user.registrationPaidAt = nextPaidAt;
      changed = true;
    }

    const currentVerifiedAtIso = user.registrationVerifiedAt ? new Date(user.registrationVerifiedAt).toISOString() : '';
    const nextVerifiedAtIso = nextVerifiedAt ? nextVerifiedAt.toISOString() : '';
    if (currentVerifiedAtIso !== nextVerifiedAtIso) {
      user.registrationVerifiedAt = nextVerifiedAt;
      changed = true;
    }

    if (changed) {
      await user.save();
      summary.updated += 1;
    }
  }

  console.log(JSON.stringify(summary, null, 2));
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
