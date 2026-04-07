function parseNonNegativeInteger(name, fallback) {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw) || raw < 0) {
    return fallback;
  }

  return Math.floor(raw);
}

function getCheckpointIntervalMinutes() {
  const value = parseNonNegativeInteger('AI_BOT_CHECKPOINT_INTERVAL_MINUTES', 1440);
  return value > 0 ? value : 1440;
}

function getDailyMaxRuns() {
  return parseNonNegativeInteger('AI_BOT_DAILY_MAX_RUNS', 0);
}

function toDayKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

module.exports = {
  getCheckpointIntervalMinutes,
  getDailyMaxRuns,
  toDayKey,
};
