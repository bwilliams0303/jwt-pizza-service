const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

let adminAuthToken;
let franchisee;
let franchiseeAuthToken;
let dinerAuthToken;
let franchise;
let store;

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

beforeAll(async () => {
  const admin = await createAdminUser();
  adminAuthToken = (await request(app).put('/api/auth').send(admin)).body.token;

  franchisee = { name: 'pizza franchisee', email: randomName() + '@test.com', password: 'a' };
  const franchiseeRes = await request(app).post('/api/auth').send(franchisee);
  franchisee.id = franchiseeRes.body.user.id;

  const diner = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  dinerAuthToken = (await request(app).post('/api/auth').send(diner)).body.token;
});

test('admin can create a franchise', async () => {
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: franchisee.email }] });
  expect(createRes.status).toBe(200);
  expect(createRes.body.admins[0]).toMatchObject({ id: franchisee.id, email: franchisee.email });
  franchise = createRes.body;

  // Log the franchisee in after the franchise exists so their token carries the franchisee role.
  franchiseeAuthToken = (await request(app).put('/api/auth').send(franchisee)).body.token;
});

test('diner cannot create a franchise', async () => {
  const createRes = await request(app).post('/api/franchise').set('Authorization', `Bearer ${dinerAuthToken}`).send({ name: randomName(), admins: [] });
  expect(createRes.status).toBe(403);
  expect(createRes.body.message).toBe('unable to create a franchise');
});

test('create franchise with unknown admin fails', async () => {
  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: randomName(), admins: [{ email: randomName() + '@unknown.com' }] });
  expect(createRes.status).toBe(404);
});

test('franchisee can create a store', async () => {
  const storeRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${franchiseeAuthToken}`).send({ name: 'SLC' });
  expect(storeRes.status).toBe(200);
  expect(storeRes.body).toMatchObject({ franchiseId: franchise.id, name: 'SLC' });
  store = storeRes.body;
});

test('diner cannot create a store', async () => {
  const storeRes = await request(app).post(`/api/franchise/${franchise.id}/store`).set('Authorization', `Bearer ${dinerAuthToken}`).send({ name: 'Provo' });
  expect(storeRes.status).toBe(403);
  expect(storeRes.body.message).toBe('unable to create a store');
});

test('list franchises', async () => {
  const listRes = await request(app).get(`/api/franchise?page=0&limit=10&name=${franchise.name}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.more).toBe(false);
  expect(listRes.body.franchises[0]).toMatchObject({ id: franchise.id, name: franchise.name, stores: [{ id: store.id, name: store.name }] });
});

test('admin list franchises includes admins', async () => {
  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(listRes.status).toBe(200);
  expect(listRes.body.franchises[0].admins[0].id).toBe(franchisee.id);
});

test('get user franchises', async () => {
  const userRes = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', `Bearer ${franchiseeAuthToken}`);
  expect(userRes.status).toBe(200);
  expect(userRes.body).toEqual([expect.objectContaining({ id: franchise.id, name: franchise.name })]);
});

test("cannot see another user's franchises", async () => {
  const userRes = await request(app).get(`/api/franchise/${franchisee.id}`).set('Authorization', `Bearer ${dinerAuthToken}`);
  expect(userRes.status).toBe(200);
  expect(userRes.body).toEqual([]);
});

test('diner cannot delete a store', async () => {
  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', `Bearer ${dinerAuthToken}`);
  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body.message).toBe('unable to delete a store');
});

test('franchisee can delete a store', async () => {
  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}/store/${store.id}`).set('Authorization', `Bearer ${franchiseeAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('store deleted');
});

test('delete franchise', async () => {
  const deleteRes = await request(app).delete(`/api/franchise/${franchise.id}`).set('Authorization', `Bearer ${adminAuthToken}`);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('franchise deleted');

  const listRes = await request(app).get(`/api/franchise?name=${franchise.name}`);
  expect(listRes.body.franchises).toEqual([]);
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
