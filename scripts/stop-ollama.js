const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const pidFile = path.join(rootDir, "data", "ollama.pid");

function main() {
  if (!fs.existsSync(pidFile)) {
    console.log("No Ollama PID file found.");
    return;
  }

  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (!pid) {
    fs.rmSync(pidFile, { force: true });
    console.log("Removed invalid Ollama PID file.");
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    console.log(`Stopped Ollama PID ${pid}`);
  } catch (err) {
    if (err.code === "ESRCH") console.log("Ollama process was not running.");
    else throw err;
  } finally {
    fs.rmSync(pidFile, { force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
