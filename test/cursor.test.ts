import { Schema } from 'datalink';

import {
  cursorQuery,
  encodeCursor,
  decodeCursor,
  matchUniqueKey,
  CursorQueryOptions
} from '../src/cursor';

import helper = require('./helper');

const NAME = 'cursor';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

test('cursor query', async done => {
  const db = helper.connectToDatabase(NAME);
  const table = db.table('order_shipping_event');

  // 5 users, 5 orders each, dated from 1/1/2018, each with 5 events
  await helper.createOrderShippingEvents(db);

  let options: CursorQueryOptions = {
    limit: 5,
    orderBy: ['event_time', 'orderShipping.order.code desc']
  };

  let result = (await cursorQuery(table, options)).rows;
  let cursor = decodeCursor(result.slice(-1)[0].__cursor);
  expect(result.length).toBe(5);
  expect(cursor[1]).toBe('eve-1');
  expect(new Date(cursor[0]).getDay()).toBe(1);

  options.cursor = encodeCursor(cursor);

  result = (await cursorQuery(table, options)).rows;
  cursor = decodeCursor(result.slice(-1)[0].__cursor);

  expect(cursor[1]).toBe('david-1');
  expect(new Date(cursor[0]).getDay()).toBe(1);

  done();
});

test('matchUniqueKey', () => {
  const schema = new Schema(helper.getExampleData());
  const item = schema.model('OrderItem');
  expect(matchUniqueKey(item, ['id']).length).toBe(1);
  expect(matchUniqueKey(item, ['product'])).toBe(null);
  expect(matchUniqueKey(item, ['product', 'order.code']).length).toBe(2);
  expect(matchUniqueKey(item, ['product', 'order.user.email'])).toBe(null);

  const event = schema.model('OrderShippingEvent');
  {
    const spec = ['orderShipping.order.dateCreated', 'eventTime'];
    expect(matchUniqueKey(event, spec)).toBe(null);
  }
  {
    const spec = ['eventTime', 'orderShipping.order.code', 'eventDescription'];
    expect(matchUniqueKey(event, spec).length).toBe(2);
  }
});
