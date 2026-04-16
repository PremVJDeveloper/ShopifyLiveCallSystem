// PM2 Ecosystem Config — ShopifyLiveCallSystem
module.exports = {
  apps: [
    {
      name: 'livecall',
      script: 'server.js',
      cwd: '/home/ubuntu/app',

      // Always restart on crash, and on server reboot
      watch: false,
      autorestart: true,
      restart_delay: 3000,
      max_restarts: 10,

      // Environment
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },

      // Logging
      out_file: '/home/ubuntu/app/logs/out.log',
      error_file: '/home/ubuntu/app/logs/error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,

      // Memory limit — restart if over 400MB (safety net)
      max_memory_restart: '400M',

      // Graceful shutdown — wait up to 5s for connections to drain
      kill_timeout: 5000,
      listen_timeout: 8000,
    },
  ],
};
