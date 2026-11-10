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
  expect(sent.map((m) => m.name)).toEqual(['cpu', 'memory']);
  for (const metric of sent) {
    expect(metric.unit).toBe('%');
    const [point] = metric.gauge.dataPoints;
    expect(point.attributes).toContainEqual({ key: 'source', value: { stringValue: config.metrics.source } });
  }
});

test('logs when Grafana rejects metrics', async () => {
  global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('bad request') });
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  timer = metrics.sendMetricsPeriodically(PERIOD);

  await jest.advanceTimersByTimeAsync(PERIOD);

  expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('bad request'));
  consoleError.mockRestore();
});
