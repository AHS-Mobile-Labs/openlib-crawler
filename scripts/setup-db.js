const { db, initializeDatabase } = require("../src/db");

initializeDatabase(db)
  .then(async () => {
    await db.close();
    console.log("OpenLib crawler database is ready.");
  })
  .catch(async (err) => {
    console.error(err.stack || err.message);
    await db.close();
    process.exit(1);
  });
