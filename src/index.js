const app = require('./service.js');
const metrics = require('./metrics.js');
const logger = require('./logger.js');

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});

metrics.sendMetricsPeriodically(10000);

// Anything thrown outside a request, including unhandled promise rejections, lands here.
// The process is in an unknown state, so log the exception and exit; ECS starts a fresh container.
process.on('uncaughtException', async (err, origin) => {
  console.error(err);
  await logger.exceptionLogger(err, { origin });
  process.exit(1);
});
