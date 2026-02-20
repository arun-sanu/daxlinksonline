const PROJECT_ROOT = '/opt/daxlinks/backend/backend';

const config = {
  apps: [
    {
      name: 'backend',
      cwd: PROJECT_ROOT,
      script: 'src/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.PORT || '8000'
      },
      time: true
    },
    {
      name: 'mexc-bot',
      cwd: `${PROJECT_ROOT}/python-bot`,
      script: '/usr/bin/python3',
      args: `${PROJECT_ROOT}/python-bot/mexc_bot.py`,
      interpreter: 'none',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      env: {
        PYTHONUNBUFFERED: '1',
        MEXC_API_KEY: process.env.MEXC_API_KEY,
        MEXC_API_SECRET: process.env.MEXC_API_SECRET,
        BACKEND_URL: process.env.BACKEND_URL || 'http://localhost:8000',
        INTERNAL_BOT_TOKEN: process.env.INTERNAL_BOT_TOKEN,
        BOT_INSTANCE_ID: process.env.BOT_INSTANCE_ID || 'cmexamplebotinstanceid',
        WORKSPACE_ID: process.env.WORKSPACE_ID || '',
        BOT_ID: process.env.BOT_ID || '',
        SYMBOL: process.env.SYMBOL || 'BTCUSDC',
        BASE_QUANTITY: process.env.BASE_QUANTITY || '0.001',
        MACD_FAST: process.env.MACD_FAST || '12',
        MACD_SLOW: process.env.MACD_SLOW || '26',
        MACD_SIGNAL: process.env.MACD_SIGNAL || '9',
        BB_LENGTH: process.env.BB_LENGTH || '20',
        BB_MULT: process.env.BB_MULT || '2.0',
        STOP_LOSS_PCT: process.env.STOP_LOSS_PCT || '2.0',
        RISK_REWARD: process.env.RISK_REWARD || '5',
        CHECK_INTERVAL: process.env.CHECK_INTERVAL || '60',
        LOG_LEVEL: process.env.LOG_LEVEL || 'INFO',
        LOG_FILE: process.env.LOG_FILE || '/var/log/mexc-bot.log',
        REPORT_RETRIES: process.env.REPORT_RETRIES || '3',
        ORDER_RETRIES: process.env.ORDER_RETRIES || '3',
        REQUEST_TIMEOUT: process.env.REQUEST_TIMEOUT || '20',
        HEALTH_INTERVAL: process.env.HEALTH_INTERVAL || '300',
        MEXC_RECV_WINDOW: process.env.MEXC_RECV_WINDOW || '5000',
        MEXC_WS_URL: process.env.MEXC_WS_URL || 'wss://wbs.mexc.com/ws',
        MEXC_REST_URL: process.env.MEXC_REST_URL || 'https://api.mexc.com',
        ALLOW_SHORTS: process.env.ALLOW_SHORTS || 'false',
        RESOLVE_EXCHANGE_FROM_BACKEND: process.env.RESOLVE_EXCHANGE_FROM_BACKEND || 'true',
        BACKEND_RUNTIME_PATH: process.env.BACKEND_RUNTIME_PATH || '/api/v1/internal/bot/runtime-config',
        RUNTIME_RETRIES: process.env.RUNTIME_RETRIES || '3'
      },
      time: true,
      kill_timeout: 10000
    }
  ]
};

export default config;
