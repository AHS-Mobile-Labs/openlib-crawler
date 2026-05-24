module.exports = {
  apps: [
    {
      name: "openlib-moderation",
      script: "src/server.js",
      cwd: __dirname,
      autorestart: true,
      max_memory_restart: "350M",
      out_file: "logs/pm2-moderation.out.log",
      error_file: "logs/pm2-moderation.err.log",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openlib-crawler",
      script: "src/cli.js",
      args: "crawl",
      cwd: __dirname,
      cron_restart: "0 */6 * * *",
      autorestart: false,
      max_memory_restart: "450M",
      out_file: "logs/pm2-crawler.out.log",
      error_file: "logs/pm2-crawler.err.log",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openlib-updater",
      script: "src/cli.js",
      args: "update",
      cwd: __dirname,
      cron_restart: "20 2 * * *",
      autorestart: false,
      max_memory_restart: "450M",
      out_file: "logs/pm2-updater.out.log",
      error_file: "logs/pm2-updater.err.log",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openlib-ai",
      script: "src/cli.js",
      args: "ai",
      cwd: __dirname,
      cron_restart: "40 1 * * *",
      autorestart: false,
      max_memory_restart: "550M",
      out_file: "logs/pm2-ai.out.log",
      error_file: "logs/pm2-ai.err.log",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openlib-screenshots",
      script: "src/cli.js",
      args: "screenshots",
      cwd: __dirname,
      cron_restart: "10 3 * * 0",
      autorestart: false,
      max_memory_restart: "450M",
      out_file: "logs/pm2-screenshots.out.log",
      error_file: "logs/pm2-screenshots.err.log",
      env: {
        NODE_ENV: "production"
      }
    },
    {
      name: "openlib-sync",
      script: "src/cli.js",
      args: "sync",
      cwd: __dirname,
      cron_restart: "*/30 * * * *",
      autorestart: false,
      max_memory_restart: "250M",
      out_file: "logs/pm2-sync.out.log",
      error_file: "logs/pm2-sync.err.log",
      env: {
        NODE_ENV: "production"
      }
    }
  ]
};
