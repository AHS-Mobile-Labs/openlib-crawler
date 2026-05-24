const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const binary = path.join(rootDir, "vendor", "ollama", "bin", "ollama");
const modelsDir = path.join(rootDir, "data", "ollama-models");
const pidFile = path.join(rootDir, "data", "ollama.pid");
const logFile = path.join(rootDir, "logs", "ollama.log");
const host = process.env.OLLAMA_HOST || "127.0.0.1:11434";

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}

function waitForHealth(timeoutMs = 30000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(`http://${host}/api/tags`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) return resolve();
        retry();
      });
      req.on("error", retry);
      req.setTimeout(1500, () => {
        req.destroy();
        retry();
      });
    }

    function retry() {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`Ollama did not become ready at ${host}`));
      } else {
        setTimeout(check, 1000);
      }
    }

    check();
  });
}

async function main() {
  if (!fs.existsSync(binary)) {
    throw new Error(`Missing Ollama binary at ${binary}`);
  }

  fs.mkdirSync(modelsDir, { recursive: true });
  fs.mkdirSync(path.dirname(pidFile), { recursive: true });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  if (fs.existsSync(pidFile)) {
    const existingPid = Number(fs.readFileSync(pidFile, "utf8").trim());
    if (existingPid && isRunning(existingPid)) {
      console.log(`Ollama is already running with PID ${existingPid}`);
      await waitForHealth(5000);
      return;
    }
  }

  const logFd = fs.openSync(logFile, "a");
  const child = spawn(binary, ["serve"], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", logFd, logFd],
    env: {
      ...process.env,
      OLLAMA_HOST: host,
      OLLAMA_MODELS: modelsDir
    }
  });

  child.unref();
  fs.writeFileSync(pidFile, `${child.pid}\n`);
  await waitForHealth();
  console.log(`Ollama started at http://${host} with PID ${child.pid}`);
  console.log(`Models: ${modelsDir}`);
  console.log(`Logs: ${logFile}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
