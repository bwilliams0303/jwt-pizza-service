const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config.js');

// Holds the request being handled so database and factory logs can name its user without the request being passed around.
const requestContext = new AsyncLocalStorage();

const MASK = '*****';

// Object keys whose values are never logged.
const SENSITIVE_KEY = /password|token|jwt|apikey|authorization|secret/i;

// Secrets that can show up inside free text such as SQL statements, URLs, and error messages.
const SENSITIVE_TEXT = [
  [/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, MASK],
  [/(bearer\s+)[\w.~+/=-]+/gi, `$1${MASK}`],
  [/(password\s*=\s*)'[^']*'/gi, `$1'${MASK}'`],
];

function configuredSecrets() {
  return [config.jwtSecret, config.db.connection.password, config.factory.apiKey, config.metrics.apiKey, config.logging.apiKey].filter(Boolean);
}

function sanitizeText(text) {
  for (const secret of configuredSecrets()) {
    text = text.replaceAll(secret, MASK);
  }
  for (const [pattern, replacement] of SENSITIVE_TEXT) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

// Returns a copy of the value with confidential information masked. The original is left untouched.
function sanitize(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }
  if (SENSITIVE_KEY.test(key)) {
    return MASK;
  }
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v, k)]));
  }
  return value;
}

// Express middleware that logs every request once its response is sent. Install it after express.json() so req.body is parsed.
function httpLogger(req, res, next) {
  const send = res.send;
  res.send = (resBody) => {
    res.send = send;
    log(statusToLogLevel(res.statusCode), 'http', {
      authorized: !!req.headers.authorization,
      user: describeUser(req.user),
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      reqBody: req.body,
      resBody: parseBody(resBody),
    });
    return res.send(resBody);
  };
  requestContext.run(req, next);
}

// Logs one SQL statement. Parameter values are left out because they carry password hashes and token signatures.
function dbLogger(sql) {
  log('info', 'db', { user: currentUser(), sql });
}

// Logs one call to the pizza factory. A rejected order is logged as an error.
function factoryLogger(ok, reqBody, resBody) {
  log(ok ? 'info' : 'error', 'factory', { user: currentUser(), reqBody, resBody });
}

// The authenticated user of the request being handled, or null outside a request or before authentication.
function currentUser() {
  return describeUser(requestContext.getStore()?.user);
}

function statusToLogLevel(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

// Only the fields that identify the user; null when the request is not authenticated.
function describeUser(user) {
  return user ? { id: user.id, name: user.name, email: user.email } : null;
}

// res.json hands res.send a JSON string. Parse it back so sensitive fields can be masked by key.
function parseBody(body) {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

// Sends one sanitized log event to Grafana Loki. Level and type are indexed labels; logData becomes the JSON log line.
function log(level, type, logData) {
  const labels = { component: config.logging.source, level, type };
  const values = [nowString(), JSON.stringify(sanitize(logData))];
  sendLogToGrafana({ streams: [{ stream: labels, values: [values] }] });
}

// Loki timestamps are unix epoch nanoseconds.
function nowString() {
  return `${Date.now()}000000`;
}

// Logging must never break or slow down a request, so failures are only reported to the console.
async function sendLogToGrafana(event) {
  try {
    const response = await fetch(config.logging.endpointUrl, {
      method: 'POST',
      body: JSON.stringify(event),
      headers: { Authorization: `Bearer ${config.logging.accountId}:${config.logging.apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      console.error(`Failed to send log to Grafana: ${await response.text()}`);
    }
  } catch (error) {
    console.error('Error sending log to Grafana:', error.message);
  }
}

module.exports = { httpLogger, dbLogger, factoryLogger, log, sanitize };
