const http = require('http');
const { Server } = require('socket.io');
const createApp = require('./app');
const config = require('./config/env');
const { registerSocketHandlers } = require('./sockets/socketHandlers');
const { pool } = require('./config/db');

async function start() {
  // Fail fast with a clear message if the database is unreachable, rather
  // than starting a server that will error on every request.
  try {
    await pool.query('SELECT 1');
    console.log('Database connection OK.');
  } catch (err) {
    console.error('Could not connect to PostgreSQL:', err.message);
    console.error('Check your DATABASE_URL in .env and ensure the database is running.');
    console.error('Run `npm run migrate` after the database is reachable to create tables.');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: config.clientOrigin,
      credentials: true,
    },
    maxHttpBufferSize: 5 * 1024 * 1024, // 5MB, generous for typing/message payloads
  });

  registerSocketHandlers(io);
  app.set('io', io);

  server.listen(config.port, () => {
    console.log(`Chat server listening on port ${config.port} (${config.env} mode)`);
    console.log(`Allowed client origin: ${config.clientOrigin}`);
  });

  const shutdown = async (signal) => {
    console.log(`\nReceived ${signal}. Shutting down gracefully...`);
    server.close(async () => {
      await pool.end();
      console.log('Server closed. Bye!');
      process.exit(0);
    });
    // Force exit if it hangs.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
