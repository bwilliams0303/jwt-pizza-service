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
  const [url, options] = global.fetch.mock.calls[0];
  return { url, options, metrics: JSON.parse(options.body).resourceMetrics[0].scopeMetrics[0].metrics };
}

test('sends cpu and memory gauges each period', () => {
  timer = metrics.sendMetricsPeriodically(PERIOD);
  expect(global.fetch).not.toHaveBeenCalled();

  jest.advanceTimersByTime(PERIOD);

  const { url, options, metrics: sent } = sentMetrics();
  expect(url).toBe(config.metrics.endpointUrl);
  expect(options.headers.Authorization).toBe(`Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`);
  const gauges = sent.filter((m) => m.gauge);
  expect(gauges.map((m) => m.name)).toEqual(['cpu', 'memory']);
  for (const metric of gauges) {
    expect(metric.unit).toBe('%');
    const [point] = metric.gauge.dataPoints;
    expect(point.attributes).toContainEqual({ key: 'source', value: { stringValue: config.metrics.source } });
  }
});

function trackRequest(method, durationMs) {
  const res = new EventEmitter();
  const next = jest.fn();
  metrics.requestTracker({ method }, res, next);
  expect(next).toHaveBeenCalled();
  jest.advanceTimersByTime(durationMs);
  res.emit('finish');
}

function sumValue(sent, name, method) {
  const metric = sent.find((m) => m.name === name && (!method || m.sum.dataPoints[0].attributes.some((a) => a.key === 'method' && a.value.stringValue === method)));
  expect(metric.sum.aggregationTemporality).toBe('AGGREGATION_TEMPORALITY_CUMULATIVE');
  expect(metric.sum.isMonotonic).toBe(true);
  return metric.sum.dataPoints[0].asInt;
}

test('counts requests by method and totals their latency', () => {
  trackRequest('GET', 20);
  trackRequest('GET', 30);
  trackRequest('POST', 50);
  timer = metrics.sendMetricsPeriodically(PERIOD);

  jest.advanceTimersByTime(PERIOD);

  const { metrics: sent } = sentMetrics();
  expect(sumValue(sent, 'requests', 'GET')).toBe(2);
  expect(sumValue(sent, 'requests', 'POST')).toBe(1);
  expect(sumValue(sent, 'endpoint_latency')).toBe(100);
});

test('logs when Grafana rejects metrics', async () => {
  global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('bad request') });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  timer = metrics.sendMetricsPeriodically(PERIOD);

  await jest.advanceTimersByTimeAsync(PERIOD);

  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('bad request'));
  consoleError.mockRestore();
});
