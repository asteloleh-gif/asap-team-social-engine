const HOUR_MS = 60 * 60 * 1000;

const CHECKPOINT_WINDOWS = Object.freeze([
  Object.freeze({ hours: 24, toleranceHours: 2 }),
  Object.freeze({ hours: 72, toleranceHours: 6 }),
]);

function validDate(value, name) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${name}`);
  return date;
}

function checkpointBounds({ publishedAt, hours, toleranceHours }) {
  const published = validDate(publishedAt, "publishedAt");
  const targetHours = Number(hours);
  const tolerance = Number(toleranceHours);
  if (!Number.isFinite(targetHours) || targetHours <= 0) throw new Error("Invalid checkpoint hours");
  if (!Number.isFinite(tolerance) || tolerance < 0) throw new Error("Invalid checkpoint tolerance");
  const dueAt = new Date(published.getTime() + targetHours * HOUR_MS);
  return {
    publishedAt: published,
    opensAt: new Date(dueAt.getTime() - tolerance * HOUR_MS),
    dueAt,
    closesAt: new Date(dueAt.getTime() + tolerance * HOUR_MS),
  };
}

function checkpointWindowState({ publishedAt, hours, toleranceHours, now = new Date() }) {
  const observed = validDate(now, "now");
  const bounds = checkpointBounds({ publishedAt, hours, toleranceHours });
  if (observed < bounds.opensAt) return { state: "PENDING", ...bounds };
  if (observed <= bounds.closesAt) return { state: "DUE", ...bounds };
  return { state: "LATE", ...bounds };
}

function postAgeHours({ publishedAt, observedAt }) {
  const published = validDate(publishedAt, "publishedAt");
  const observed = validDate(observedAt, "observedAt");
  return Math.max(0, (observed.getTime() - published.getTime()) / HOUR_MS);
}

module.exports = {
  HOUR_MS,
  CHECKPOINT_WINDOWS,
  checkpointBounds,
  checkpointWindowState,
  postAgeHours,
};
