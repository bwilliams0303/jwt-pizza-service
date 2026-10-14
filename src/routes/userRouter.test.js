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

test('delete user unauthorized', async () => {
  const deleteRes = await request(app).delete(`/api/user/${testUserId}`);
  expect(deleteRes.status).toBe(401);
});

test('delete user requires admin', async () => {
  const [user] = await registerUser(request(app));
  const deleteRes = await request(app).delete(`/api/user/${user.id}`).set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(deleteRes.status).toBe(403);
});

test('admin deletes user', async () => {
  const [user, userToken] = await registerUser(request(app));
  const adminToken = await loginAdmin();

  const deleteRes = await request(app).delete(`/api/user/${user.id}`).set('Authorization', `Bearer ${adminToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toEqual({ message: 'user deleted' });

  // The user is gone from the list, logged out, and unable to log back in
  const listUsersRes = await request(app).get('/api/user').query({ name: user.name }).set('Authorization', `Bearer ${adminToken}`);
  expect(listUsersRes.body.users).toEqual([]);
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${userToken}`);
  expect(meRes.status).toBe(401);
  const loginRes = await request(app).put('/api/auth').send({ email: user.email, password: user.password });
  expect(loginRes.status).toBe(404);
});

test('delete unknown user', async () => {
  const adminToken = await loginAdmin();
  const deleteRes = await request(app).delete('/api/user/999999999').set('Authorization', `Bearer ${adminToken}`);
  expect(deleteRes.status).toBe(404);
});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users requires admin', async () => {
  const [, userToken] = await registerUser(request(app));
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(403);
});

test('list users', async () => {
  const adminToken = await loginAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
});

test('list users returns users with roles', async () => {
  const [user] = await registerUser(request(app));
  const adminToken = await loginAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .query({ name: user.name })
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users).toEqual([{ id: user.id, name: user.name, email: user.email, roles: [{ role: 'diner' }] }]);
});

test('list users filters by name with wildcards', async () => {
  const suffix = randomName();
  const [first] = await registerUser(request(app), `alpha ${suffix}`);
  const [second] = await registerUser(request(app), `beta ${suffix}`);
  const adminToken = await loginAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .query({ name: `*${suffix}` })
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.map((u) => u.id)).toEqual([first.id, second.id]);
});

test('list users paginates', async () => {
  const suffix = randomName();
  const [first] = await registerUser(request(app), `one ${suffix}`);
  const [second] = await registerUser(request(app), `two ${suffix}`);
  const [third] = await registerUser(request(app), `three ${suffix}`);
  const adminToken = await loginAdmin();

  const page0Res = await request(app)
    .get('/api/user')
    .query({ page: 0, limit: 2, name: `*${suffix}` })
    .set('Authorization', 'Bearer ' + adminToken);
  expect(page0Res.status).toBe(200);
  expect(page0Res.body.users.map((u) => u.id)).toEqual([first.id, second.id]);
  expect(page0Res.body.more).toBe(true);

  const page1Res = await request(app)
    .get('/api/user')
    .query({ page: 1, limit: 2, name: `*${suffix}` })
    .set('Authorization', 'Bearer ' + adminToken);
  expect(page1Res.status).toBe(200);
  expect(page1Res.body.users.map((u) => u.id)).toEqual([third.id]);
  expect(page1Res.body.more).toBe(false);
});

test('list users defaults to a page of 10', async () => {
  const adminToken = await loginAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.length).toBeLessThanOrEqual(10);
});

test('list users filter with no matches', async () => {
  const adminToken = await loginAdmin();
  const listUsersRes = await request(app)
    .get('/api/user')
    .query({ name: randomName() })
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users).toEqual([]);
});

async function loginAdmin() {
  const admin = await createAdminUser();
  const loginRes = await request(app).put('/api/auth').send(admin);
  return loginRes.body.token;
}

async function registerUser(service, name = `pizza diner ${randomName()}`) {
  const testUser = {
    name,
    email: `${randomName()}@test.com`,
    password: 'a',
  };
  const registerRes = await service.post('/api/auth').send(testUser);
  registerRes.body.user.password = testUser.password;

  return [registerRes.body.user, registerRes.body.token];
}

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
