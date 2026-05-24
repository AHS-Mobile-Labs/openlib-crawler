const { sleep } = require("./time");

async function withRetry(fn, options = {}) {
  const retries = options.retries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const shouldRetry = options.shouldRetry || (() => true);
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !shouldRetry(err)) break;
      const retryAfter = Number(err.retryAfterMs || 0);
      const delay = retryAfter || baseDelayMs * Math.pow(2, attempt);
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = {
  withRetry
};
