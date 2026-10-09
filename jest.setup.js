// config.js reads secrets from the environment, so load .env when it exists (local runs).
const fs = require('fs');
const path = require('path');
const { parseEnv } = require('util');

const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  Object.assign(process.env, parseEnv(fs.readFileSync(envFile, 'utf8')));
}
