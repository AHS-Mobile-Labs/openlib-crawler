function nowIso() {
  return new Date().toISOString();
}

function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function daysBetween(a, b = new Date()) {
  const left = a instanceof Date ? a : new Date(a);
  const right = b instanceof Date ? b : new Date(b);
  if (Number.isNaN(left.getTime()) || Number.isNaN(right.getTime())) return Infinity;
  return Math.floor((right.getTime() - left.getTime()) / (24 * 60 * 60 * 1000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  nowIso,
  hoursAgo,
  daysBetween,
  sleep
};
