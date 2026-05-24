if (!process.argv[2] || process.argv[2].startsWith("--")) process.argv.splice(2, 0, "update");
require("./src/cli");
