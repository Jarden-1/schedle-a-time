// pm2 配置
//
// 🚨 必须单实例 fork 模式。
// 微信 access_token 缓存是进程内的：如果开 cluster / -i max，
// 每个实例会各自换一次 token，新 token 会让其他实例的 token 立即失效，
// 订阅消息就会大面积失败。
module.exports = {
  apps: [
    {
      name: 'meet-backend',
      script: 'server.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production'
      }
    }
  ]
};
