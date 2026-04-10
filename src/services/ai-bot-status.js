const {
  getCheckpointIntervalMinutes,
  getSubscriptionMonths,
} = require('../config/ai-bot');

function toTimestamp(value) {
  if (!value) {
    return Number.NaN;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NaN;
}

function addMonths(fromDate = new Date(), months = 1) {
  const safeMonths = Number.isFinite(months) && months > 0 ? Math.floor(months) : 1;
  const next = new Date(fromDate);
  next.setMonth(next.getMonth() + safeMonths);
  return next;
}

function getAIBotSubscriptionState(user, now = new Date()) {
  const verified =
    !user?.aiBotVerificationStatus || user.aiBotVerificationStatus === 'verified';
  const nowMs = now.getTime();
  const activatedAtMs = toTimestamp(user?.aiBotActivatedAt);
  const expiresAtMs = toTimestamp(user?.aiBotExpiresAt);
  const hasExpiry = Number.isFinite(expiresAtMs);
  const hasPurchased = Boolean(user?.aiBotEnabled) || Number.isFinite(activatedAtMs);
  const active = Boolean(hasPurchased) && verified && (!hasExpiry || expiresAtMs > nowMs);
  const expired = Boolean(hasPurchased) && hasExpiry && expiresAtMs <= nowMs;
  const remainingDays = hasExpiry && active
    ? Math.max(0, Math.ceil((expiresAtMs - nowMs) / (24 * 60 * 60 * 1000)))
    : 0;

  return {
    months: Number(user?.aiBotSubscriptionMonths || getSubscriptionMonths()),
    hasPurchased,
    active,
    expired,
    verified,
    remainingDays,
    expiresAt: hasExpiry ? new Date(expiresAtMs) : null,
  };
}

function ensureAIBotSubscriptionState(user, now = new Date()) {
  if (!user) {
    return false;
  }

  let changed = false;

  if (user.aiBotEnabled) {
    const activatedAtMs = toTimestamp(user.aiBotActivatedAt);
    if (!Number.isFinite(activatedAtMs)) {
      user.aiBotActivatedAt = now;
      changed = true;
    }

    const expiresAtMs = toTimestamp(user.aiBotExpiresAt);
    if (!Number.isFinite(expiresAtMs)) {
      const normalizedActivatedAtMs = toTimestamp(user.aiBotActivatedAt);
      const renewBase = Number.isFinite(normalizedActivatedAtMs)
        ? new Date(normalizedActivatedAtMs)
        : now;
      let nextExpiry = addMonths(renewBase, getSubscriptionMonths());

      if (!Number.isFinite(nextExpiry.getTime()) || nextExpiry.getTime() <= now.getTime()) {
        nextExpiry = addMonths(now, getSubscriptionMonths());
      }

      user.aiBotExpiresAt = nextExpiry;
      changed = true;
    }
  }

  const subscription = getAIBotSubscriptionState(user, now);
  if (subscription.expired && user.aiBotEnabled) {
    user.aiBotEnabled = false;
    changed = true;
  }

  return changed;
}

function requiresAIBotCheckpoint(user, now = new Date()) {
  const subscription = getAIBotSubscriptionState(user, now);

  if (!user?.aiBotEnabled || !subscription.active) {
    return false;
  }

  const nextCheckpointAtMs = toTimestamp(user.aiBotNextCheckpointAt);
  if (!Number.isFinite(nextCheckpointAtMs)) {
    return true;
  }

  return nextCheckpointAtMs <= now.getTime();
}

function getAIBotStatusLabel(user, now = new Date()) {
  const subscription = getAIBotSubscriptionState(user, now);

  if (user?.aiBotEnabled && !subscription.verified) {
    return 'Unverified';
  }

  if (user?.aiBotEnabled && subscription.expired) {
    return 'Expired';
  }

  if (user?.aiBotEnabled && subscription.active) {
    return requiresAIBotCheckpoint(user, now) ? 'Checkpoint Required' : 'Active';
  }

  if (!user?.aiBotEnabled && subscription.expired) {
    return 'Expired';
  }

  return 'Inactive';
}

function getNextCheckpointDate(fromDate = new Date()) {
  const intervalMinutes = getCheckpointIntervalMinutes();
  return new Date(fromDate.getTime() + intervalMinutes * 60 * 1000);
}

module.exports = {
  addMonths,
  ensureAIBotSubscriptionState,
  getAIBotStatusLabel,
  getAIBotSubscriptionState,
  getNextCheckpointDate,
  requiresAIBotCheckpoint,
};
