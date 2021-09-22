
import { Database } from 'sqlex';
import { Schema } from 'sqlex/dist/schema';
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

test('cursor query', async () => {
  const db = helper.connectToDatabase(NAME);
  const table = db.table('order_shipping_event');

  // 5 users, 5 orders each, dated from 1/1/2018, each with 5 events
  await createOrderShippingEvents(db);

  let options: CursorQueryOptions = {
    limit: 5,
    orderBy: ['event_time', '-orderShipping.order.code']
  };

  let result = (await cursorQuery(table, options)).rows;
  let cursor = decodeCursor(result.slice(-1)[0].__cursor);
  expect(result.length).toBe(5);
  expect(cursor[1].trim()).toBe('eve-1');
  expect(new Date(cursor[0]).getDay()).toBe(1);

  options.cursor = encodeCursor(cursor);

  result = (await cursorQuery(table, options)).rows;
  cursor = decodeCursor(result.slice(-1)[0].__cursor);

  expect(cursor[1].trim()).toBe('david-1');
  expect(new Date(cursor[0]).getDay()).toBe(1);

  db.end();
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

function createOrderShippingEvents(db: Database) {
  const users = ['alice', 'bob', 'charlie', 'david', 'eve'].map(name =>
    db.table('user').append({ email: name, firstName: name })
  );

  const products = ['apple', 'banana', 'carrot'].map(name =>
    db.table('product').append({ name, sku: name })
  );

  for (const user of users) {
    for (let i = 0; i < 5; i++) {
      const order = db.table('order').append({
        user,
        dateCreated: new Date(2018, 0, i + 1),
        code: `${user.email}-${i + 1}`,
        status: i
      });

      products.forEach((product, index) => {
        const item = db.table('order_item').append({
          order,
          product,
          quantity: 3 - index
        });
      });

      const shipping = db
        .table('order_shipping')
        .append({ order, status: 5 - i });

      for (let j = 0; j < 5; j++) {
        db.table('order_shipping_event').append({
          orderShipping: shipping,
          eventTime: new Date(2018, 0, j + 1),
          eventDescription: `Event for order ${user.email}-${i + 1} #(${j + 1})`
        });
      }
    }
  }

  const dates = [1, 2, 3, 4, 5].map(day => new Date(2018, 1, day));

  return db.flush();
}
