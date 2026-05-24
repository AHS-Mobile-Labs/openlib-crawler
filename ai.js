if (!process.argv[2] || process.argv[2].startsWith("--")) process.argv.splice(2, 0, "ai");
require("./src/cli");
