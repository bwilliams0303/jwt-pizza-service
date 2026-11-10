const os = require('os');
const config = require('./config.js');

const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

const requestsByMethod = {};
let endpointLatencyMs = 0;
const authAttempts = { success: 0, failure: 0 };
const lastSeenByUser = new Map();
const purchases = { orders: 0, pizzasSold: 0, failures: 0, revenue: 0, latencyMs: 0 };

// Express middleware that counts each request by method and adds its duration to the endpoint latency total.
function requestTracker(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    requestsByMethod[req.method] = (requestsByMethod[req.method] ?? 0) + 1;
    endpointLatencyMs += Date.now() - start;
    if (req.user) {
      userActive(req.user.id);
    }
  });
  next();
}

// Express middleware for the login route that counts the attempt as a success or failure from the response status.
function authTracker(req, res, next) {
  res.on('finish', () => {
    authAttempts[res.statusCode < 400 ? 'success' : 'failure']++;
  });
  next();
}

function userActive(userId) {
  lastSeenByUser.set(userId, Date.now());
}

// Records one pizza factory order. Successful orders add their pizzas and prices; failed orders count as creation failures.
function pizzaPurchase(success, latencyMs, items) {
  purchases.orders++;
  purchases.latencyMs += latencyMs;
  if (success) {
    purchases.pizzasSold += items.length;
    purchases.revenue += items.reduce((total, item) => total + item.price, 0);
  } else {
    purchases.failures++;
  }
}

function httpMetrics() {
  return [...Object.entries(requestsByMethod).map(([method, count]) => createMetric('requests', count, 'sum', '1', { method })), createMetric('endpoint_latency', endpointLatencyMs, 'sum', 'ms')];
}

function authMetrics() {
  return Object.entries(authAttempts).map(([status, count]) => createMetric('auth_attempts', count, 'sum', '1', { status }));
}

function purchaseMetrics() {
  return [
    createMetric('pizza_orders', purchases.orders, 'sum', '1'),
    createMetric('pizzas_sold', purchases.pizzasSold, 'sum', '1'),
    createMetric('pizza_creation_failures', purchases.failures, 'sum', '1'),
    createMetric('revenue', purchases.revenue, 'sum', '1'),
    createMetric('pizza_latency', purchases.latencyMs, 'sum', 'ms'),
  ];
}

// Active users are the distinct users seen within the last ACTIVE_USER_WINDOW_MS.
function userMetrics() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [userId, lastSeen] of lastSeenByUser) {
    if (lastSeen < cutoff) {
      lastSeenByUser.delete(userId);
    }
  }
  // A gauge with unit '1' is stored as active_users_ratio, so use a {users} annotation, which is left out of the name.
  return [createMetric('active_users', lastSeenByUser.size, 'gauge', '{users}')];
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
    sendToGrafana([...httpMetrics(), ...authMetrics(), ...userMetrics(), ...purchaseMetrics(), ...systemMetrics()]);
  }, period);
}

module.exports = { requestTracker, authTracker, userActive, pizzaPurchase, sendMetricsPeriodically };
