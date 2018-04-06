import * as graphql from 'graphql';
import * as helper from './helper';

import { createSchema } from '../src/schema';
import { Accessor } from '../src/accessor';
import { Schema } from '../src/model';

const NAME = 'schema';

beforeAll(() => helper.createDatabase(NAME));
//afterAll(() => helper.dropDatabase(NAME));

const data = helper.getExampleData();

test('create schema', () => {
  const schema = createSchema(data);
  require('fs').writeFileSync('schema.graphql', graphql.printSchema(schema));
  expect(schema).not.toBe(undefined);
});

const EMAIL = 'user@example.com';
const STATUS = 200;

const CREATE_USER = `
mutation {
  createUser(data: {email: "${EMAIL}", status: ${STATUS}}) {
    id
    email
    status
  }
}
`;

test('create simple object', done => {
  expect.assertions(6);

  const archen = createArchen();

  graphql.graphql(archen.schema, CREATE_USER, null, archen).then(row => {
    const user = row.data.createUser;
    expect(user.email).toBe(EMAIL);
    expect(user.status).toBe(STATUS);
    archen.db
      .table('user')
      .select('*', { where: { email: EMAIL } })
      .then(rows => {
        expect(rows.length).toBe(1);
        const row = rows[0];
        expect(row.id).toBe(user.id);
        expect(row.email).toBe(EMAIL);
        expect(row.status).toBe(STATUS);
        done();
      });
  });
});

const CREATE_ORDER = `
mutation {
  createOrder(data: {
    code: "test-001",
    orderItems: {
      create: [
        {
          product: { connect: { id: 1 } },
          quantity: 2
        },
        {
          product: { connect: { id: 3 } },
          quantity: 2
        },
      ]
    }
  }) {
    id
    code
    orderItems {
      product {
        id
        name
      }
      id
    }
  }
}
`;

test('create object', done => {
  expect.assertions(5);

  const archen = createArchen();

  graphql.graphql(archen.schema, CREATE_ORDER, null, archen).then(row => {
    const order = row.data.createOrder;
    expect(order.code).toBe('test-001');
    expect(order.orderItems.length).toBe(2);
    archen.db
      .table('OrderItem')
      .select('*', {
        where: { order: { id: order.id } },
        orderBy: 'product_id'
      })
      .then(rows => {
        expect(rows.length).toBe(2);
        expect(rows[0].product.id).toBe(1);
        expect(rows[1].product.id).toBe(3);
        done();
      });
  });
});

const SET_NULL = `
mutation {
  updateOrder(data: { user: null }, where: { code: "test-002" }) {
    id
    user {
      id
    }
  }
}
`;

test('set foreign key null', done => {
  expect.assertions(2);

  const archen = createArchen();

  archen.db
    .table('order')
    .create({
      user: { connect: { id: 1 } }, // FIXME: { id: 1 } doesn't get anything
      code: 'test-002'
    })
    .then(order => {
      expect(order.user.id).toBe(1);
      graphql.graphql(archen.schema, SET_NULL, null, archen).then(row => {
        const order = row.data.updateOrder;
        expect(order.user).toBe(null);
        done();
      });
    });
});

const ONE2ONE_CREATE = `
mutation {
  createOrder(
    data: {
      code: "one2one-001",
      orderShipping: {
        create: {
          status: 1
        }
      }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

const ONE2ONE_DELETE = `
mutation {
  updateOrder(
    data: {
      orderShipping: null
    },
    where: {
      code: "one2one-001",
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

test('one to one - create/disconnect', done => {
  expect.assertions(2);

  const archen = createArchen();

  graphql.graphql(archen.schema, ONE2ONE_CREATE, null, archen).then(row => {
    const order = row.data.createOrder;
    expect(order.orderShipping.status).toBe(1);
    graphql.graphql(archen.schema, ONE2ONE_DELETE, null, archen).then(row => {
      const order = row.data.updateOrder;
      expect(order.orderShipping).toBe(null);
      done();
    });
  });
});

function createArchen() {
  const domain = new Schema(data);
  const db = helper.connectToDatabase(NAME);
  const accessor = new Accessor(domain, db);
  const schema = createSchema(domain);

  return { domain, db, accessor, schema };
}
