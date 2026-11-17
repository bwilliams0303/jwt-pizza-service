const config = require('./config.js');
const logger = require('./logger.js');

const MASK = '*****';

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

function sentLog() {
  const [url, options] = global.fetch.mock.calls.at(-1);
  const [stream] = JSON.parse(options.body).streams;
  const [[timestamp, line]] = stream.values;
  return { url, options, labels: stream.stream, timestamp, data: JSON.parse(line) };
}

test('log pushes a labeled JSON line to Loki', () => {
  const before = Date.now();
  logger.log('info', 'http', { path: '/api/order/menu' });

  const { url, options, labels, timestamp, data } = sentLog();
  expect(url).toBe(config.logging.endpointUrl);
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe(`Bearer ${config.logging.accountId}:${config.logging.apiKey}`);
  expect(labels).toEqual({ component: config.logging.source, level: 'info', type: 'http' });
  expect(timestamp).toMatch(/^\d{19}$/);
  expect(Number(timestamp.slice(0, 13))).toBeGreaterThanOrEqual(before);
  expect(data).toEqual({ path: '/api/order/menu' });
});

test('log sanitizes the data it sends', () => {
  logger.log('info', 'http', { reqBody: { email: 'd@jwt.com', password: 'diner' } });

  expect(sentLog().data).toEqual({ reqBody: { email: 'd@jwt.com', password: MASK } });
});

test('sanitize masks sensitive keys at any depth', () => {
  const data = {
    name: 'pizza diner',
    password: 'diner',
    token: 'abc',
    resBody: { user: { id: 1 }, jwt: 'xyz', apiKey: 'k' },
    headers: [{ Authorization: 'Bearer abc' }],
  };

  expect(logger.sanitize(data)).toEqual({
    name: 'pizza diner',
    password: MASK,
    token: MASK,
    resBody: { user: { id: 1 }, jwt: MASK, apiKey: MASK },
    headers: [{ Authorization: MASK }],
  });
});

test('sanitize does not change the original object', () => {
  const data = { user: { password: 'diner' } };
  logger.sanitize(data);
  expect(data.user.password).toBe('diner');
});

test('sanitize masks secrets inside text', () => {
  expect(logger.sanitize("UPDATE user SET password='$2b$10$hash', email='d@jwt.com' WHERE id=3")).toBe(`UPDATE user SET password='${MASK}', email='d@jwt.com' WHERE id=3`);
  expect(logger.sanitize('token eyJhbGciOi.eyJpZCI6MX0.sig-nature_1 rejected')).toBe(`token ${MASK} rejected`);
  expect(logger.sanitize('authorization: Bearer abc.def')).toBe(`authorization: Bearer ${MASK}`);
});

test('sanitize masks configured secrets wherever they appear', () => {
  const original = config.factory.apiKey;
  config.factory.apiKey = 'factory-secret-key';
  try {
    expect(logger.sanitize({ reportUrl: 'https://factory/report?apiKey=factory-secret-key&fixCode=1' })).toEqual({ reportUrl: `https://factory/report?apiKey=${MASK}&fixCode=1` });
  } finally {
    config.factory.apiKey = original;
  }
});

test('sanitize leaves non-sensitive values alone', () => {
  expect(logger.sanitize({ count: 2, ok: true, missing: null, authorized: false, items: [1, 'veggie'] })).toEqual({ count: 2, ok: true, missing: null, authorized: false, items: [1, 'veggie'] });
});

test('a rejected log is reported without throwing', async () => {
  global.fetch.mockResolvedValue({ ok: false, text: () => Promise.resolve('bad request') });
  logger.log('info', 'http', {});
  await new Promise(process.nextTick);
  expect(console.error).toHaveBeenCalledWith('Failed to send log to Grafana: bad request');
});

test('a network failure is reported without throwing', async () => {
  global.fetch.mockRejectedValue(new Error('offline'));
  logger.log('info', 'http', {});
  await new Promise(process.nextTick);
  expect(console.error).toHaveBeenCalledWith('Error sending log to Grafana:', 'offline');
});

function sendThroughHttpLogger(req, statusCode, body) {
  const originalSend = jest.fn();
  const res = { statusCode: 200, send: originalSend };
  const next = jest.fn();
  logger.httpLogger({ headers: {}, ...req }, res, next);
  expect(next).toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();

  res.statusCode = statusCode;
  res.send(body);
  expect(originalSend).toHaveBeenCalledWith(body);
  expect(res.send).toBe(originalSend);
  return sentLog();
}

test('httpLogger logs the request and response once the response is sent', () => {
  const req = { method: 'PUT', originalUrl: '/api/auth', body: { email: 'd@jwt.com', password: 'diner' } };
  const resBody = JSON.stringify({ user: { id: 3, email: 'd@jwt.com' }, token: 'abc' });

  const { labels, data } = sendThroughHttpLogger(req, 200, resBody);

  expect(labels).toMatchObject({ level: 'info', type: 'http' });
  expect(data).toEqual({
    authorized: false,
    user: null,
    method: 'PUT',
    path: '/api/auth',
    statusCode: 200,
    reqBody: { email: 'd@jwt.com', password: MASK },
    resBody: { user: { id: 3, email: 'd@jwt.com' }, token: MASK },
  });
});

test('httpLogger identifies the authenticated user', () => {
  const user = { id: 3, name: 'pizza diner', email: 'd@jwt.com', roles: [{ role: 'diner' }], iat: 1 };
  const req = { method: 'GET', originalUrl: '/api/order', headers: { authorization: 'Bearer abc' }, user };

  const { data } = sendThroughHttpLogger(req, 200, { orders: [] });

  expect(data.authorized).toBe(true);
  expect(data.user).toEqual({ id: 3, name: 'pizza diner', email: 'd@jwt.com' });
  expect(data.resBody).toEqual({ orders: [] });
});

test.each([
  [200, 'info'],
  [404, 'warn'],
  [500, 'error'],
])('httpLogger logs status %i at level %s', (statusCode, level) => {
  const { labels, data } = sendThroughHttpLogger({ method: 'GET', originalUrl: '/' }, statusCode, 'plain text');

  expect(labels.level).toBe(level);
  expect(data.statusCode).toBe(statusCode);
  expect(data.resBody).toBe('plain text');
});

test('dbLogger logs the SQL statement with the user of the current request', async () => {
  const user = { id: 3, name: 'pizza diner', email: 'd@jwt.com' };
  const req = { headers: {}, user: undefined };
  const sql = 'SELECT * FROM menu';

  await new Promise((resolve) => {
    logger.httpLogger(req, { send: jest.fn() }, async () => {
      // The user is set by a later middleware, after an asynchronous token check.
      await Promise.resolve();
      req.user = user;
      logger.dbLogger(sql);
      resolve();
    });
  });

  const { labels, data } = sentLog();
  expect(labels).toMatchObject({ level: 'info', type: 'db' });
  expect(data).toEqual({ user, sql });
});

test('dbLogger logs a null user outside a request', () => {
  logger.dbLogger("UPDATE user SET password='$2b$10$hash' WHERE id=3");

  expect(sentLog().data).toEqual({ user: null, sql: `UPDATE user SET password='${MASK}' WHERE id=3` });
});
