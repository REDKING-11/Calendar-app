const { createApp } = require('./app');
const { main: runMigrations } = require('./db/migrate');

async function main() {
  await runMigrations();
  const app = createApp();
  await app.listen({
    host: app.config.host,
    port: app.config.port,
  });
  app.log.info({
    host: app.config.host,
    port: app.config.port,
    publicBaseUrl: app.config.publicBaseUrl,
  }, 'SelfHdb listening');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { main };
