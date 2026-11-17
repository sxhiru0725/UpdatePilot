import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { maintenance } from './services/jobs.js';
import { retention } from './services/retention.js';
import { logger } from './logger.js';
const server = app.listen(config.PORT, '127.0.0.1', () =>
  logger.info({ port: config.PORT }, 'UpdatePilot API listening on loopback'),
);
let busy = false;
const timer = setInterval(async () => {
  if (busy) return;
  busy = true;
  try {
    await maintenance();
    await retention();
  } catch (e) {
    logger.error(
      { error: e instanceof Error ? e.name : 'UnknownError' },
      'Background maintenance failed',
    );
  } finally {
    busy = false;
  }
}, 30000);
const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    void db.$disconnect().then(() => process.exit(0));
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
