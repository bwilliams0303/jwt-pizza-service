const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

const testUser = { name: 'pizza diner', password: 'a' };
let testUserAuthToken;
let testUserId;

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

beforeAll(async () => {
  testUser.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUserId = registerRes.body.user.id;
});

test('get authenticated user', async () => {
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(meRes.status).toBe(200);
  expect(meRes.body).toMatchObject({ id: testUserId, name: testUser.name, email: testUser.email, roles: [{ role: 'diner' }] });
});

test('update own user', async () => {
  const updated = { name: randomName(), email: randomName() + '@test.com', password: 'b' };
  const updateRes = await request(app).put(`/api/user/${testUserId}`).set('Authorization', `Bearer ${testUserAuthToken}`).send(updated);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({ id: testUserId, name: updated.name, email: updated.email });
  expect(updateRes.body.token).toBeDefined();

  Object.assign(testUser, updated);
  testUserAuthToken = updateRes.body.token;
});

test('cannot update another user', async () => {
  const updateRes = await request(app)
    .put(`/api/user/${testUserId + 1000000}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'hacker' });
  expect(updateRes.status).toBe(403);
});

test('admin can update another user', async () => {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);
  const adminToken = loginRes.body.token;

  const updateRes = await request(app).put(`/api/user/${testUserId}`).set('Authorization', `Bearer ${adminToken}`).send(testUser);
  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user.id).toBe(testUserId);
});

test('delete user is not implemented', async () => {
  const deleteRes = await request(app).delete(`/api/user/${testUserId}`).set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('not implemented');
});

test('list users is not implemented', async () => {
  const listRes = await request(app).get('/api/user').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body).toMatchObject({ message: 'not implemented', users: [], more: false });
});

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = user.name + '@admin.com';

  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}
