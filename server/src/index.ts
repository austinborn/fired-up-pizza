import { createApp } from './app';
import { loadConfig } from './config';
import { openDatabase } from './db/connection';
import { migrate } from './db/migrate';
import { seedCatalog } from './db/seed';

// The only module that opens the real database file and binds a port.
const config = loadConfig();
const db = openDatabase(config.databasePath);

// Bring the schema up to date and seed an empty catalog before the first
// request (ADR 0002 rules 3 and 4), so a clean checkout needs no setup step.
for (const name of migrate(db)) {
  console.log(`Applied database migration ${name}`);
}
if (seedCatalog(db)) {
  console.log('Seeded the starter menu catalog');
}

const app = createApp({ db });

const server = app.listen(config.port, (error?: Error) => {
  if (error) {
    console.error(`Could not start the API on port ${config.port}:`, error.message);
    process.exit(1);
  }
  console.log(`Fired Up Pizza API listening on http://localhost:${config.port}`);
});

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
