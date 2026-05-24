const axios = require("axios");
const config = require("../config");
const logger = require("../logger");
const { sleep } = require("../utils/time");
const { withRetry } = require("../utils/retry");

class GitHubClient {
  constructor(options = {}) {
    this.client = axios.create({
      baseURL: options.apiBaseUrl || config.github.apiBaseUrl,
      timeout: options.timeoutMs || config.github.requestTimeoutMs,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": config.github.userAgent,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(config.github.token ? { Authorization: `Bearer ${config.github.token}` } : {})
      }
    });
  }

  async request(method, url, options = {}) {
    return withRetry(
      async () => {
        try {
          const response = await this.client.request({
            method,
            url,
            params: options.params,
            headers: options.headers
          });

          this.warnOnLowRateLimit(response.headers);
          return response.data;
        } catch (err) {
          this.decorateRateLimitError(err);
          throw err;
        }
      },
      {
        retries: options.retries ?? 3,
        baseDelayMs: 1500,
        shouldRetry: (err) => {
          const status = err.response?.status;
          return status === 403 || status === 429 || status >= 500 || !status;
        }
      }
    );
  }

  warnOnLowRateLimit(headers) {
    const remaining = Number(headers["x-ratelimit-remaining"]);
    if (Number.isFinite(remaining) && remaining <= 10) {
      logger.warn("github rate limit running low", {
        remaining,
        reset: headers["x-ratelimit-reset"]
      });
    }
  }

  decorateRateLimitError(err) {
    const headers = err.response?.headers || {};
    const status = err.response?.status;
    const retryAfter = Number(headers["retry-after"]);
    const remaining = Number(headers["x-ratelimit-remaining"]);
    const reset = Number(headers["x-ratelimit-reset"]);

    if (retryAfter) {
      err.retryAfterMs = Math.min(retryAfter * 1000, 15 * 60 * 1000);
      return;
    }

    if ((status === 403 || status === 429) && remaining === 0 && reset) {
      const waitMs = Math.max(1000, reset * 1000 - Date.now() + 2000);
      err.retryAfterMs = Math.min(waitMs, 15 * 60 * 1000);
    }
  }

  async searchRepositories(query, page = 1, perPage = config.github.perPage) {
    return this.request("GET", "/search/repositories", {
      params: {
        q: query,
        sort: "stars",
        order: "desc",
        per_page: perPage,
        page
      }
    });
  }

  async getRepository(owner, repo) {
    return this.request("GET", `/repos/${owner}/${repo}`);
  }

  async getReadme(owner, repo) {
    try {
      return await this.request("GET", `/repos/${owner}/${repo}/readme`, {
        headers: { Accept: "application/vnd.github.raw" },
        retries: 2
      });
    } catch (err) {
      if (err.response?.status === 404) return "";
      throw err;
    }
  }

  async getLatestRelease(owner, repo) {
    try {
      return await this.request("GET", `/repos/${owner}/${repo}/releases/latest`, { retries: 1 });
    } catch (err) {
      if (err.response?.status === 404) return null;
      throw err;
    }
  }

  async listRootContents(owner, repo) {
    try {
      return await this.request("GET", `/repos/${owner}/${repo}/contents`, { retries: 1 });
    } catch (err) {
      if (err.response?.status === 404) return [];
      throw err;
    }
  }

  async politePause() {
    await sleep(250);
  }
}

module.exports = GitHubClient;
