import { Schema } from '../src/model';
import { Database, Table, Record } from '../src/database';

import helper = require('./helper');
import { FlushMethod } from '../src/flush';

const NAME = 'flush';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('append', () => {
  const schema = new Schema(helper.getExampleData());
  const db = new Database(schema);
  const user = db.append('user', { email: 'user@example.com' });
  expect(user instanceof Record).toBe(true);
  expect(db.table('user').recordList.length).toBe(1);
  user.status = 200;
  expect(user.status).toBe(200);
  expect(() => (user.whatever = 200)).toThrow();
});

test('append #2', () => {
  const schema = new Schema(helper.getExampleData());
  const db = new Database(schema);
  const user = db.User({ email: 'user@example.com' });
  expect(user instanceof Record).toBe(true);
  expect(user.email).toBe('user@example.com');
  expect(user.get('email')).toBe('user@example.com');
  expect(user.__table).toBe(db.table('user'));
  expect(db.table('user').recordList.length).toBe(1);
});

test('delete', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('user');
  const id = await table.insert({ email: 'deleted@example.com' });
  const row = await table.get({ id });
  expect(row.email).toBe('deleted@example.com');
  const record = db.User({ email: 'deleted@example.com' });
  const deleted = record.delete();
  record.delete().then(async () => {
    expect(await table.get({ id })).toBe(undefined);
    done();
  });
});

test('update', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const table = db.table('user');
  const id = await table.insert({ email: 'updated@example.com', status: 100 });
  const row = await table.get({ id });
  expect(row.status).toBe(100);
  const user = db.User({ email: 'updated@example.com' });
  await user.update({ status: 200 });
  expect((await table.get({ id })).status).toBe(200);
  done();
});

test('save #1', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.User({ email: 'saved01@example.com' });
  user.save().then(async row => {
    expect(row.email).toBe('saved01@example.com');
    const user = await db.table('user').get({ email: 'saved01@example.com' });
    expect(user.id).toBe(row.id);
    done();
  });
});

test('save #2', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.User({ email: 'saved02@example.com' });
  const order = db.Order({ code: 'saved02' });
  order.user = user;
  const saved = await user.save();
  await order.save();
  const saved2 = await db.table('order').get({ code: 'saved02' });
  expect(saved2.user.id).toBe(saved.id);
  done();
});

test('save #3', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.User({ email: 'saved03@example.com' });
  const order_1 = db.Order({ code: 'saved03-1', user });
  const order_2 = db.Order({ code: 'saved03-2', user });
  await order_1.save();
  await order_2.save();
  const saved_0 = await db.table('user').get({ email: 'saved03@example.com' });
  const saved_1 = await db.table('order').get({ code: 'saved03-1' });
  const saved_2 = await db.table('order').get({ code: 'saved03-1' });
  expect(saved_1.user.id).toBe(saved_0.id);
  expect(saved_2.user.id).toBe(saved_0.id);
  done();
});

test('save #4', async done => {
  const schema = new Schema(helper.getExampleData());
  const db = helper.connectToDatabase(NAME, schema);
  const user = db.User({ email: 'saved04@example.com' });
  const order_1 = db.Order({ code: 'saved04-1', user });
  const order_2 = db.Order({ code: 'saved04-2', user });
  user.status = order_2;
  await order_1.save();
  await user.save();
  const saved_0 = await db.table('user').get({ email: 'saved04@example.com' });
  const saved_1 = await db.table('order').get({ code: 'saved04-1' });
  const saved_2 = await db.table('order').get({ code: 'saved04-2' });
  expect(saved_1.user.id).toBe(saved_0.id);
  expect(saved_2.user.id).toBe(saved_0.id);
  expect(saved_0.status).toBe(saved_2.id);
  done();
});
