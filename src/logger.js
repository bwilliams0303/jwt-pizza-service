const config = require('./config.js');

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

module.exports = { log, sanitize };
