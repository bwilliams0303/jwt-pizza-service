const request = require('supertest');
const app = require('../service');
const { Role, DB } = require('../database/database.js');

let adminAuthToken;
let dinerAuthToken;
let menuItem;

if (process.env.VSCODE_INSPECTOR_OPTIONS) {
  jest.setTimeout(60 * 1000 * 5); // 5 minutes
}

beforeAll(async () => {
  const admin = await createAdminUser();
  adminAuthToken = (await request(app).put('/api/auth').send(admin)).body.token;

  const diner = { name: 'pizza diner', email: randomName() + '@test.com', password: 'a' };
  dinerAuthToken = (await request(app).post('/api/auth').send(diner)).body.token;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('admin can add a menu item', async () => {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0001 };
  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${adminAuthToken}`).send(item);
  expect(addRes.status).toBe(200);

  menuItem = addRes.body.find((m) => m.title === item.title);
  expect(menuItem).toMatchObject(item);
});

test('diner cannot add a menu item', async () => {
  const item = { title: randomName(), description: 'test pizza', image: 'pizza1.png', price: 0.0001 };
  const addRes = await request(app).put('/api/order/menu').set('Authorization', `Bearer ${dinerAuthToken}`).send(item);
  expect(addRes.status).toBe(403);
  expect(addRes.body.message).toBe('unable to add menu item');
});

test('get menu', async () => {
  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(menuRes.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: menuItem.id })]));
});

test('create order', async () => {
  // Don't call the real pizza factory from a test.
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ reportUrl: 'http://report', jwt: 'factory.jwt.token' }) });

  const order = { franchiseId: 1, storeId: 1, items: [{ menuId: menuItem.id, description: menuItem.title, price: menuItem.price }] };
  const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`).send(order);
  expect(orderRes.status).toBe(200);
  expect(orderRes.body.order).toMatchObject(order);
  expect(orderRes.body.jwt).toBe('factory.jwt.token');
  expect(orderRes.body.followLinkToEndChaos).toBe('http://report');
});

test('create order fails when factory fails', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({ reportUrl: 'http://report' }) });

  const order = { franchiseId: 1, storeId: 1, items: [{ menuId: menuItem.id, description: menuItem.title, price: menuItem.price }] };
  const orderRes = await request(app).post('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`).send(order);
  expect(orderRes.status).toBe(500);
  expect(orderRes.body.message).toBe('Failed to fulfill order at factory');
});

test('get orders', async () => {
  const ordersRes = await request(app).get('/api/order').set('Authorization', `Bearer ${dinerAuthToken}`);
  expect(ordersRes.status).toBe(200);
  expect(ordersRes.body.orders.length).toBeGreaterThan(0);
  expect(ordersRes.body.orders[0].items[0].menuId).toBe(menuItem.id);
});

test('get orders requires auth', async () => {
  const ordersRes = await request(app).get('/api/order');
  expect(ordersRes.status).toBe(401);
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
