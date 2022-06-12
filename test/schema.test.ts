import * as graphql from 'graphql';
import * as helper from './helper';

import { GraphQLSchemaBuilder } from '../src/schema';
import { Accessor } from '../src/accessor';
import { Database } from 'sqlex';
import { Schema as SchemaConfig } from 'sqlex/dist/config';
import { Schema } from 'sqlex/dist/schema';

const NAME = 'schema';

beforeAll(() => helper.createDatabase(NAME));
afterAll(() => helper.dropDatabase(NAME));

const data = helper.getExampleData();

test('create schema', () => {
  const { schema } = createSchema(data);
  // require('fs').writeFileSync('schema.graphql', graphql.printSchema(schema));
  expect(schema).not.toBe(undefined);
});

test('create simple object', done => {
  expect.assertions(6);

  const EMAIL = 'user@example.com';
  const STATUS = 200;

  const DATA = `
mutation {
  createUser(data: {email: "${EMAIL}", status: ${STATUS}}) {
    id
    email
    status
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
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
          archen.shutdown();
          done();
        });
    });
});

test('create object', done => {
  expect.assertions(5);

  const DATA = `
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

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.createOrder;
      expect(order.code).toBe('test-001');
      expect(order.orderItems.length).toBe(2);
      archen.db
        .table('OrderItem')
        .select('*', {
          where: { order: { id: order.id } },
          orderBy: ['product_id']
        })
        .then(rows => {
          expect(rows.length).toBe(2);
          expect((rows[0].product as any).id).toBe(1);
          expect((rows[1].product as any).id).toBe(3);
          archen.shutdown();
          done();
        });
    });
});

test('set foreign key null', done => {
  expect.assertions(2);

  const DATA = `
mutation {
  updateOrder(data: { user: null }, where: { code: "test-002" }) {
    id
    user {
      id
    }
  }
}
`;

  const archen = createArchen();

  archen.db
    .table('order')
    .create({
      user: { connect: { id: 1 } }, // FIXME: { id: 1 } doesn't get anything
      code: 'test-002'
    })
    .then(order => {
      expect((order.user as any).id).toBe(1);
      graphql
        .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
        .then(row => {
          const order = row.data.updateOrder;
          expect(order.user).toBe(null);
          archen.shutdown();
          done();
        });
    });
});

test('one to one - create', done => {
  const ID = 'T001';

  const DATA = `
mutation {
  createOrder(
    data: {
      code: "schema-${ID}",
      orderShipping: {
        create: {
          status: 100
        }
      }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.createOrder;
      expect(order.orderShipping.status).toBe(100);
      archen.shutdown();
      done();
    });
});

test('one to one - create #2', done => {
  const archen = createArchen();

  const CODE = 'T001A';

  createOrderAndShipping(archen.db, CODE, 100).then(id => {
    const DATA = `
mutation {
  updateOrder(
    where: {
      code: "${CODE}"
    }
    data: {
      orderShipping: { create: {  status: 200 } }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;
    graphql
      .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
      .then(row => {
        const order = row.data.updateOrder;
        expect(order.orderShipping.status).toBe(200);
        archen.shutdown();
        done();
      });
  });
});

test('one to one - connect', done => {
  const ID = '002';

  const DATA = `
mutation {
  createOrder(
    data: {
      code: "schema-${ID}",
      orderShipping: {
        connect: {
          order: { id: 2 }
        }
      }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.createOrder;
      expect(order.orderShipping.status).toBe(2);
      archen.shutdown();
      done();
    });
});

test('one to one - connect #2', done => {
  const archen = createArchen();

  const CODE_A = 'T003A';
  const CODE_B = 'T003B';
  const STATUS_A = 300;
  const STATUS_B = 500;

  createOrderAndShipping(archen.db, CODE_A, STATUS_A).then(a => {
    createOrderAndShipping(archen.db, CODE_B, STATUS_B).then(b => {
      const DATA = `
mutation {
  updateOrder(
    where: {
      code: "${CODE_A}"
    }
    data: {
      orderShipping: { connect: { order: { id: ${b} } } }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;
      graphql
        .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
        .then(row => {
          const order = row.data.updateOrder;
          expect(order.orderShipping.status).toBe(STATUS_B);
          archen.shutdown();
          done();
        });
    });
  });
});

test('one to one - update', done => {
  const CODE = 'T004';
  const STATUS = 3;

  const DATA = `
mutation {
  updateOrder(
    where: {
      code: "${CODE}"
    }
    data: {
      orderShipping: { update: { status: ${STATUS + 1} } }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

  const archen = createArchen();

  createOrderAndShipping(archen.db, CODE, STATUS).then(id => {
    graphql
      .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
      .then(row => {
        const order = row.data.updateOrder;
        expect(order.orderShipping.status).toBe(STATUS + 1);
        archen.shutdown();
        done();
      });
  });
});

test('one to one - upsert', done => {
  const CODE = 'T005';

  const DATA = `
mutation {
  updateOrder(
    where: {
      code: "${CODE}"
    }
    data: {
      orderShipping: {
        upsert: {
          create: { status: 200 },
          update: { status: 300 }
        }
      }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

  const archen = createArchen();

  createOrderAndShipping(archen.db, CODE, 100).then(id => {
    graphql
      .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
      .then(row => {
        const order = row.data.updateOrder;
        expect(order.orderShipping.status).toBe(300);
        archen.shutdown();
        done();
      });
  });
});

test('one to one - delete', done => {
  expect.assertions(2);

  const ID = 'T006';

  const DATA = `
mutation {
  createOrder(
    data: {
      code: "schema-${ID}",
      orderShipping: {
        create: {
          status: 100
        }
      }
    }) {
    id
    code
    orderShipping { status }
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.createOrder;
      expect(order.orderShipping.status).toBe(100);
      archen.shutdown();
      const DATA = `
mutation {
  updateOrder(
    where: {
      code: "schema-${ID}"
    }
    data: {
      orderShipping: null
    }) {
    id
    code
    orderShipping { status }
  }
}
`;
      // To clear data loader which happens in practice
      const archen2 = createArchen();
      graphql
        .graphql(archen2.schema, DATA, archen2.rootValue, archen2.accessor)
        .then(row => {
          const order = row.data.updateOrder;
          expect(order.orderShipping).toBe(null);
          archen2.shutdown();
          done();
        });
    });
});

test('many to many #1', done => {
  expect.assertions(1);

  const DATA = `
{
  products {
    name
    categorySet(where: { name: "Apple" }) {
      id
      name
     }
  }
}
`;

  const CONFIG = {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet'
          }
        ]
      }
    ]
  };

  const archen = createArchen(CONFIG);

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(result => {
      const products = result.data.products.filter(
        p => p.categorySet.length > 0
      );
      expect(products.length).toBe(2);
      archen.shutdown();
      done();
    });
});

test('many to many #2', done => {
  expect.assertions(1);

  const DATA = `
{
  products {
    name
    categorySet(where: { name: "Apple" }) {
      id
      name
     }
  }
}
`;

  const CONFIG = {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'category_id',
            throughField: 'product_id'
          },
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet'
          }
        ]
      }
    ]
  };

  const archen = createArchen(CONFIG);

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(result => {
      const products = result.data.products.filter(
        p => p.categorySet.length > 0
      );
      expect(products.length).toBe(2);
      archen.shutdown();
      done();
    });
});

test('update child', done => {
  expect.assertions(2);

  const code = 'test-009';

  const DATA = `
mutation {
  updateOrder(where: {
    code: "${code}"
  },
  data: {
    orderItems: {
      update: [
        {
          data: { quantity: 200 },
          where: { product: { id: 1 } }
        }
      ]
    }
  }) {
    code
    orderItems {
      product {
        id
      }
      quantity
    }
  }
}
`;

  const archen = createArchen();

  function _createItems(): Promise<any> {
    return archen.db
      .table('order')
      .insert({ code })
      .then((order :any) => {
        return archen.db
          .table('order_item')
          .insert({ order, product: 1, quantity: 10 })
          .then(() => {
            archen.db
              .table('order_item')
              .insert({ order, product: 2, quantity: 20 });
          });
      });
  }

  _createItems().then(result => {
    graphql
      .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
      .then(result => {
        const order = result.data.updateOrder;
        const p1 = order.orderItems.find(x => x.product.id === 1);
        expect(p1.quantity).toBe(200);
        const p2 = order.orderItems.find(x => x.product.id === 2);
        expect(p2.quantity).toBe(20);
        archen.shutdown();
        done();
      });
  });
});

test('update date', done => {
  expect.assertions(1);

  const date = '2019-04-06T16:17:27.000Z';

  const DATA = `
mutation {
  updateOrder(where: {id: 1}, data: {dateCreated: "${date}"}) {
    id
    dateCreated
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.updateOrder;
      expect(order.dateCreated).toBe(date);
      archen.shutdown();
      done();
    });
});

test('order by', done => {
  expect.assertions(1);

  const archen = createArchen();

  const DATA = `
{
  orderItems(
      where: { quantity_gt: 1 },
      orderBy: ["-order.code", "order.user.email", "quantity"]
  ) {
    order {
      code
      user {
        email
      }
    }
    product {
      name
    }
    quantity
  }
}
`;

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(result => {
      const orderItems = result.data.orderItems;
      let ordered = true;
      for (let i = 1; i < orderItems.length; i++) {
        const code = orderItems[i].order.code;
        const prev = orderItems[i - 1].order.code;
        if (prev < code) {
          ordered = false;
          break;
        }
      }
      expect(ordered).toBe(true);
      archen.shutdown();
      done();
    });
});

test('update parent', done => {
  expect.assertions(1);

  const DATA = `
mutation{
  updateOrder(where: {id: 1}, data: {
    user: {
      update: {
        lastName: "updated-last-name"
      }
    }
  }) {
    code
    user {
      id
      lastName
    }
  }
}
`;

  const archen = createArchen();

  graphql
    .graphql(archen.schema, DATA, archen.rootValue, archen.accessor)
    .then(result => {
      const order = result.data.updateOrder;
      expect(order.user.lastName).toBe('updated-last-name');
      archen.shutdown();
      done();
    });
});

test('user field type', done => {
  expect.assertions(2);

  const data = `
mutation {
  updateOrder(data: { isDeleted: true }, where: { id: 1 }) {
    id
    isDeleted
  }
}
`;

  const config = {
    models: [
      {
        table: 'order',
        fields: [
          {
            column: 'is_deleted',
            userType: 'boolean'
          }
        ]
      }
    ]
  };

  const archen = createArchen(config);

  graphql
    .graphql(archen.schema, data, archen.rootValue, archen.accessor)
    .then(row => {
      const order = row.data.updateOrder;
      expect(order.isDeleted).toBe(true);
      const data2 = data.replace(/\btrue\b/, 'false');
      graphql
        .graphql(archen.schema, data2, archen.rootValue, archen.accessor)
        .then(row => {
          const order = row.data.updateOrder;
          expect(order.isDeleted).toBe(false);
          archen.shutdown();
          done();
        });
    });
});

test('like', async () => {
  const archen = createArchen();
  const DATA = `
{
  groups(where: { name_ilike: "adm%" }) {
    name
  }
}
`;

  const result = await graphql.graphql(archen.schema, DATA, archen.rootValue, archen.accessor);
  const group = result.data.groups[0];
  expect(group.name).toBe('ADMIN');
  archen.shutdown();
});

function createArchen(config?: SchemaConfig) {
  const domain = new Schema(data, config);
  const db = helper.connectToDatabase(NAME);
  const accessor = new Accessor(db);
  const { schema, rootValue } = createSchema(domain);

  return { domain, db, accessor, schema, rootValue, shutdown: () => db.end() };
}

function createOrderAndShipping(
  db: Database,
  code: string,
  status: number
): Promise<any> {
  return db
    .table('order')
    .insert({ code })
    .then((order: any) => {
      return db
        .table('order_shipping')
        .insert({ order, status })
        .then(() => order);
    });
}

function createSchema(data, config?: SchemaConfig) {
  const schema = data instanceof Schema ? data : new Schema(data, config);
  const builder = new GraphQLSchemaBuilder(schema, {
    getAccessor: context => {
      return context;
    }
  });
  return { schema: builder.getSchema(), rootValue: builder.getRootValue() };
}
