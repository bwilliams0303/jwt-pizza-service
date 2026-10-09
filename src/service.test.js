const request = require('supertest');
const app = require('./service');
const version = require('./version.json');
const { DB } = require('./database/database.js');

beforeAll(async () => {
  // Let the database finish initializing so it doesn't log after the tests complete.
  await DB.initialized;
});

test('welcome', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ message: 'welcome to JWT Pizza', version: version.version });
});

test('docs', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBe(version.version);
  expect(res.body.endpoints.length).toBeGreaterThan(0);
});

test('unknown endpoint', async () => {
  const res = await request(app).get('/api/does-not-exist');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});
