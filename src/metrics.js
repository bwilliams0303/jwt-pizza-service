const os = require('os');
const config = require('./config.js');

const requestsByMethod = {};
let endpointLatencyMs = 0;

// Express middleware that counts each request by method and adds its duration to the endpoint latency total.
function requestTracker(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    requestsByMethod[req.method] = (requestsByMethod[req.method] ?? 0) + 1;
    endpointLatencyMs += Date.now() - start;
  });
  next();
}

function httpMetrics() {
  return [...Object.entries(requestsByMethod).map(([method, count]) => createMetric('requests', count, 'sum', '1', { method })), createMetric('endpoint_latency', endpointLatencyMs, 'sum', 'ms')];
}

function getCpuUsagePercentage() {
  const cpuUsage = os.loadavg()[0] / os.cpus().length;
  return Number((cpuUsage * 100).toFixed(2));
}

function getMemoryUsagePercentage() {
  const totalMemory = os.totalmem();
  const usedMemory = totalMemory - os.freemem();
  return Number(((usedMemory / totalMemory) * 100).toFixed(2));
}

function systemMetrics() {
  return [createMetric('cpu', getCpuUsagePercentage(), 'gauge', '%'), createMetric('memory', getMemoryUsagePercentage(), 'gauge', '%')];
}

// Builds one OTel metric. Sums are cumulative counters that only go up.
function createMetric(name, value, type, unit, attributes = {}) {
  const dataPoint = {
    [Number.isInteger(value) ? 'asInt' : 'asDouble']: value,
    timeUnixNano: Date.now() * 1000000,
    attributes: Object.entries({ ...attributes, source: config.metrics.source }).map(([key, stringValue]) => ({ key, value: { stringValue: String(stringValue) } })),
  };

  const metric = { name, unit, [type]: { dataPoints: [dataPoint] } };
  if (type === 'sum') {
    metric.sum.aggregationTemporality = 'AGGREGATION_TEMPORALITY_CUMULATIVE';
    metric.sum.isMonotonic = true;
  }
  return metric;
}

async function sendToGrafana(metrics) {
  const body = JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics }] }] });
  try {
    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      body,
      headers: { Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error(`Failed to push metrics to Grafana: ${await response.text()}`);
    }
  } catch (error) {
    console.error('Error pushing metrics:', error);
  }
}

function sendMetricsPeriodically(period) {
  return setInterval(() => {
    sendToGrafana([...httpMetrics(), ...systemMetrics()]);
  }, period);
}

module.exports = { requestTracker, sendMetricsPeriodically };
