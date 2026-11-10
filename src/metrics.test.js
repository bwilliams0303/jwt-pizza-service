const EventEmitter = require('events');
const config = require('./config.js');
const metrics = require('./metrics.js');

const PERIOD = 1000;
let timer;

beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  clearInterval(timer);
  jest.useRealTimers();
});

function sentMetrics() {
  const [url, options] = global.fetch.mock.calls.at(-1);
  return { url, options, metrics: JSON.parse(options.body).resourceMetrics[0].scopeMetrics[0].metrics };
}

test('sends cpu and memory gauges each period', () => {
  timer = metrics.sendMetricsPeriodically(PERIOD);
  expect(global.fetch).not.toHaveBeenCalled();

  jest.advanceTimersByTime(PERIOD);

  const { url, options, metrics: sent } = sentMetrics();
  expect(url).toBe(config.metrics.endpointUrl);
  expect(options.headers.Authorization).toBe(`Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`);
  const gauges = sent.filter((m) => m.unit === '%');
  expect(gauges.map((m) => m.name)).toEqual(['cpu', 'memory']);
  for (const metric of gauges) {
    expect(metric.unit).toBe('%');
    const [point] = metric.gauge.dataPoints;
    expect(point.attributes).toContainEqual({ key: 'source', value: { stringValue: config.metrics.source } });
  }
});

function trackRequest(method, durationMs, user) {
  const res = new EventEmitter();
  const next = jest.fn();
  metrics.requestTracker({ method, user }, res, next);
  expect(next).toHaveBeenCalled();
  jest.advanceTimersByTime(durationMs);
  res.emit('finish');
}

function hasAttributes(metric, attributes) {
  const pointAttributes = (metric.sum ?? metric.gauge).dataPoints[0].attributes;
  return Object.entries(attributes).every(([key, value]) => pointAttributes.some((a) => a.key === key && a.value.stringValue === value));
}

function sumValue(sent, name, attributes = {}) {
  const metric = sent.find((m) => m.name === name && hasAttributes(m, attributes));
  expect(metric.sum.aggregationTemporality).toBe('AGGREGATION_TEMPORALITY_CUMULATIVE');
  expect(metric.sum.isMonotonic).toBe(true);
  const [point] = metric.sum.dataPoints;
  return point.asInt ?? point.asDouble;
}

test('counts requests by method and totals their latency', () => {
  trackRequest('GET', 20);
  trackRequest('GET', 30);
  trackRequest('POST', 50);
  timer = metrics.sendMetricsPeriodically(PERIOD);

  jest.advanceTimersByTime(PERIOD);

  const { metrics: sent } = sentMetrics();
  expect(sumValue(sent, 'requests', { method: 'GET' })).toBe(2);
  expect(sumValue(sent, 'requests', { method: 'POST' })).toBe(1);
  expect(sumValue(sent, 'endpoint_latency')).toBe(100);
});

function trackLogin(statusCode) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  metrics.authTracker({}, res, jest.fn());
  res.emit('finish');
}

test('counts successful and failed login attempts', () => {
  trackLogin(200);
  trackLogin(200);
  trackLogin(404);
  timer = metrics.sendMetricsPeriodically(PERIOD);

  jest.advanceTimersByTime(PERIOD);

  const { metrics: sent } = sentMetrics();
  expect(sumValue(sent, 'auth_attempts', { status: 'success' })).toBe(2);
  expect(sumValue(sent, 'auth_attempts', { status: 'failure' })).toBe(1);
});

test('records pizza sales, revenue, failures, and factory latency', () => {
  metrics.pizzaPurchase(true, 120, [{ price: 0.05 }, { price: 0.0038 }]);
  metrics.pizzaPurchase(false, 30, [{ price: 1 }]);
  timer = metrics.sendMetricsPeriodically(PERIOD);

  jest.advanceTimersByTime(PERIOD);

  const { metrics: sent } = sentMetrics();
  expect(sumValue(sent, 'pizza_orders')).toBe(2);
  expect(sumValue(sent, 'pizzas_sold')).toBe(2);
  expect(sumValue(sent, 'pizza_creation_failures')).toBe(1);
  expect(sumValue(sent, 'revenue')).toBeCloseTo(0.0538);
  expect(sumValue(sent, 'pizza_latency')).toBe(150);
});

function activeUsers() {
  return sentMetrics().metrics.find((m) => m.name === 'active_users').gauge.dataPoints[0].asInt;
}

test('counts users seen in the last five minutes as active', () => {
  metrics.userActive(1);
  jest.advanceTimersByTime(4 * 60 * 1000);
  trackRequest('GET', 10, { id: 2 });
  trackRequest('GET', 10, { id: 2 });
  timer = metrics.sendMetricsPeriodically(PERIOD);

  jest.advanceTimersByTime(PERIOD);
  expect(activeUsers()).toBe(2);

  jest.advanceTimersByTime(60 * 1000);
  expect(activeUsers()).toBe(1);
});

test('logs when Grafana rejects metrics', async () => {
  global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('bad request') });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  timer = metrics.sendMetricsPeriodically(PERIOD);

  await jest.advanceTimersByTimeAsync(PERIOD);

  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('bad request'));
  consoleError.mockRestore();
});
