const logger = require("../logger");
const { db, initializeDatabase } = require("../db");
const { processSyncQueue } = require("../services/syncService");

class SyncWorker {
  constructor(options = {}) {
    this.db = options.db || db;
  }

  async run(options = {}) {
    await initializeDatabase(this.db);
    try {
      const result = await processSyncQueue(this.db, options.limit);
      logger.info("sync worker finished", result);
      return result;
    } catch (err) {
      logger.error("sync worker failed", { error: err.message });
      throw err;
    }
  }
}

module.exports = SyncWorker;
