import { Schema } from '../src/model';
import { encodeFilter, QueryBuilder, splitKey } from '../src/filter';
import { DefaultEscape } from '../src/misc';

import helper = require('./helper');

const NAME = 'filter';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const data = helper.getExampleData();
const domain = new Schema(data);

test('split name and operator', () => {
  let [name, op] = splitKey('orders_some');
  expect(name).toBe('orders');
  expect(op).toBe('some');
  [name, op] = splitKey('orders');
  expect(name).toBe('orders');
  expect(op).toBe(undefined);
});

/*
-- To get user -> order -> item -> products:
select u.email, o.date_created, p.name, p.stock_quantity
from product p
  join order_item oi on p.id=oi.product_id
  join `order` o on o.id=oi.order_id
  join user u on u.id=o.user_id;
*/
test('example query', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  const model = domain.model('user');
  const args = {
    email: 'grace@example.com',
    orders_some: {
      dateCreated: '2018-03-21T00:00:00.000Z',
      orderItems_none: {
        product: {
          name_like: '%Lamb%',
          stockQuantity: [null, 0],
        },
      },
    },
  };

  db
    .table('user')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].email).toBe(args.email);
      done();
    });
});

test('foreign key column filter', () => {
  const model = domain.model('OrderItem');

  const args = {
    order: {
      user: {
        id_gt: 2,
      },
      dateCreated: '2018-3-21',
    },
    product: {
      id: [1, 2, 3],
    },
  };
  const condition = encodeFilter(args, model, DefaultEscape);
  expect(condition.indexOf('`product_id` in (1, 2, 3)')).not.toBe(-1);
  expect(condition.indexOf('`user_id` > 2')).not.toBe(-1);
});

/*
-- To retrieve a 3-level category tree:
SELECT t1.name AS L1, t2.name as L2, t3.name as L3
FROM category AS t1
LEFT JOIN category AS t2 ON t2.parent_id = t1.id
LEFT JOIN category AS t3 ON t3.parent_id = t2.id
WHERE t1.name = 'All';

-- To get product categories:
select c.name, p.name
from product_category pc
  join product p on pc.product_id=p.id
  join category c on c.id=pc.category_id
order by c.name;
*/
test('many to many', done => {
  expect.assertions(2);

  const options = {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'category_id',
            throughField: 'product_id',
          },
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet',
          },
        ],
      },
    ],
  };

  const domain = new Schema(data, options);

  const args = {
    categories: {
      name_like: 'Apple%',
      products: {
        name_like: '%Apple%',
      },
    },
  };

  const db = helper.connectToDatabase(NAME, domain);
  db
    .table('category')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Fruit');
      done();
    });
});

test('and', done => {
  expect.assertions(2);

  const db = helper.connectToDatabase(NAME);
  const model = domain.model('user');
  const args = { and: [{ name_like: '%Apple%' }, { price_lt: 6 }] };

  db
    .table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(1);
      expect(rows[0].name).toBe('Australian Apple');
      done();
    });
});

test('or', done => {
  expect.assertions(1);

  const db = helper.connectToDatabase(NAME);
  const model = domain.model('user');
  const args = {
    or: [
      { name_like: '%Apple%' },
      {
        categories_some: { name: 'Banana' },
      },
    ],
  };
  db
    .table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(4);
      done();
    });
});

test('not', done => {
  expect.assertions(1);

  const db = helper.connectToDatabase(NAME);
  const model = domain.model('user');
  const args = {
    and: [
      { name_like: '%Australian%' },
      {
        not: [
          { name_like: '%Apple%' },
          {
            categories_some: { name: 'Banana' },
          },
        ],
      },
    ],
  };

  db
    .table('product')
    .select('*', { where: args })
    .then(rows => {
      expect(rows.length).toBe(2);
      done();
    });
});

test('order by', () => {
  const model = domain.model('OrderItem');
  const args = {
    where: { quantity_gt: 1 },
    orderBy: ['order.code desc', 'order.user.email', 'quantity'],
  };
  const builder = new QueryBuilder(model, DefaultEscape);
  const sql = builder.select('*', args.where, args.orderBy);
  expect(/`t\d\`.`email`\s+ASC/i.test(sql)).toBe(true);
  expect(/`t\d\`.`code`\s+DESC/i.test(sql)).toBe(true);
});
