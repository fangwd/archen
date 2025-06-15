import { Accessor, encodeFilter } from '../src/accessor';

import * as  helper from './helper';
import { GraphQLSchemaBuilder } from '../src/schema';

import * as graphql from 'graphql';
import { Schema } from 'sqlex/dist/schema';

const NAME = 'accessor';

beforeAll(() => {
  return helper
    .createDatabase(NAME, false)
    .then(() => createRelatedFieldData());
});

afterAll(() => helper.dropDatabase(NAME));

test('encodeFilter', () => {
  let filter: any = { y: 'bar', z: 'baz', x: 'foo' };

  expect(encodeFilter(filter)).toEqual([
    1,
    [['x', 'foo'], ['y', 'bar'], ['z', 'baz']]
  ]);

  filter = [{ a: 1, b: 2 }, { d: 4, c: 3 }];

  expect(encodeFilter(filter)).toEqual([
    0,
    [[1, [['a', 1], ['b', 2]]], [1, [['c', 3], ['d', 4]]]]
  ]);
});

test('onQuery - data', done => {
  expect.assertions(2);

  const data = {};

  const onQuery = (context, action, table, options) => {
    expect(context).toBe(data);
    return true;
  };

  getAliceBob({ context: data, onQuery }).then(rows => {
    expect(rows.length).toBe(2);
    done();
  });
});

test('onQuery - true', done => {
  getAliceBob({ onQuery: () => true }).then(rows => {
    expect(rows.length).toBe(2);
    done();
  });
});

test('onQuery - filter', done => {
  const onQuery = (data, action, table, options) => {
    options.where = {
      and: [options.where, { firstName: 'alice' }]
    };
    return options;
  };

  getAliceBob({ onQuery }).then(rows => {
    expect(rows.filter(r => r != undefined).length).toBe(1);
    done();
  });
});

test('onQuery - false', done => {
  getAliceBob({ onQuery: () => Promise.resolve(false) }).catch(error => {
    done();
  });
});

test('onQuery - throw', done => {
  getAliceBob({
    onQuery: () => {
      throw Error('Abort');
    }
  }).catch(error => {
    done();
  });
});

test('onResult', done => {
  const onResult = (data, action, table, queryData) => {
    queryData.rows = queryData.rows
      .filter(row => /^alice/i.test(row.firstName))
      .map(row => {
        row = Object.assign(row);
        delete row.status;
        return row;
      });
    return new Promise(resolve => {
      setTimeout(() => resolve(undefined), 200);
    });
  };

  getAliceBob({ onResult }).then(result => {
    const rows = result.filter(row => row != undefined);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(undefined);
    done();
  });
});

test('get', async () => {
  expect.assertions(2);

  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'GET') {
            data.filter.status = 200;
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'GET') {
            if (data.row) {
              data.row.status = 500;
            } else {
              data.row = { fake: true };
            }
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);
  const model = db.model('user');
  const accessor = new Accessor(db, options);
  const email = helper.getId();

  await accessor.create(model, { email });

  const row = await accessor.get(model, { email });
  expect(row.fake).toBe(true);
  await accessor.update(model, { status: 200 }, { email });
  const row2 = await accessor.get(model, { email });
  expect(row2.status).toBe(500);
  db.end();
});

test('query', async () => {
  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'Group') {
          if (event === 'SELECT') {
            data.where = {
              and: [data.where, { not: { name_like: '%2%' } }]
            };
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'Group') {
          if (event === 'SELECT') {
            data.rows = data.rows.map(row => ({
              ...row,
              name: row.name + '*'
            }));
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);
  const model = db.model('group');
  const accessor = new Accessor(db, options);

  const rows = await accessor.query(model, { where: { name_like: '%1%' } });
  expect(rows.length).toBe(2);
  expect(rows[0].name.endsWith('*')).toBe(true);
  expect(rows[1].name.endsWith('*')).toBe(true);
  db.end();
});

test('cursorQuery', async () => {
  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'Group') {
          if (event === 'SELECT') {
            data.where = {
              and: [data.where, { not: { name_like: '%2%' } }]
            };
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'Group') {
          if (event === 'SELECT') {
            data.rows = data.rows.map(row => ({
              ...row,
              name: row.name + '*'
            }));
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);
  const model = db.model('group');
  const accessor = new Accessor(db, options);

  const result = await accessor.cursorQuery(model, { where: { name_like: '%1%' } }, model.pluralName);
  const edges = result.edges;
  expect(edges.length).toBe(2);
  expect(edges[0].node.name.endsWith('*')).toBe(true);
  expect(edges[1].node.name.endsWith('*')).toBe(true);
  db.end();
});

test('related', done => {
  const db = helper.connectToDatabase(NAME);

  const loader = new Accessor(db);
  const field = loader.db.table('group').model.field('id');

  const accessorOptions = {
    callbacks: {
      context: db,
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'UserGroup') {
          const where = data.where || {};
          data.where = {
            and: [where, { group: { name_like: '%1' } }]
          };
        }
      },
      onResult: async (context, event, table, data) => {
        // Exclude "group 1.1"
        if (table.model.name === 'UserGroup') {
          const rows = data.rows as any[];
          const promises = rows.map(row =>
            loader.load({ field }, row.group.id)
          );
          const groups = await Promise.all(promises);
          const result = [];
          for (const row of rows) {
            const group = groups.find(group => group.id === row.group.id);
            if (group.name.indexOf('1.1') === -1) {
              result.push(row);
            }
          }
          data.rows = result;
        } else if (table.model.name === 'Group') {
          // Exclude "group 1.2.1"
          data.rows = data.rows
            .filter(group => group.name.indexOf('1.2.1') === -1)
            .map(group => ({ ...group, name: group.name + '$' }));
        }
      }
    }
  };

  const accessor = new Accessor(db, accessorOptions);
  const builder = new GraphQLSchemaBuilder(
    new Schema(helper.getExampleData(), options)
  );
  const schema = builder.getSchema();
  const rootValue = builder.getRootValue();

  const DATA = `
    {
      users {
        email
        groups {
          name
        }
      }
    }
`;
  graphql.graphql({schema, source:DATA, rootValue, contextValue: accessor}).then(result => {
    const users = result.data!.users as any;
    const names = [
      ...users.reduce((result, user) => {
        user.groups.forEach(group => result.add(group.name));
        return result;
      }, new Set())
    ];
    expect(names.length).toBe(1);
    expect(names[0].endsWith('$')).toBe(true);
    db.end();
    done();
  });
});

test('create', async () => {
  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'User') {
          data.status = 200;
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'User') {
          data.firstName = 'John';
        }
      }
    }
  };
  const db = helper.connectToDatabase(NAME);
  const accessor = new Accessor(db, options);
  const row = await accessor.create(db.model('user'), { email: helper.getId() });
  expect(row.status).toBe(200);
  expect(row.firstName).toBe('John');
  db.end();
});

test('update', async () => {
  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'UPDATE') {
            data.data.status = 200;
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'UPDATE') {
            data.row.firstName = 'John';
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);

  const accessor = new Accessor(db, options);
  const model = db.model('user');

  const user = await accessor.create(model, { email: helper.getId() });
  const row = await accessor.update(model, { lastName: 'Doe' }, { email: user.email });
  expect(row.status).toBe(200);
  expect(row.firstName).toBe('John');
  expect(row.lastName).toBe('Doe');
  const record = await accessor.get(model, { email: user.email });
  expect(record.firstName).toBe(null);
  db.end();
});

test('upsert', async () => {
  expect.assertions(5);

  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'UPSERT') {
            data.create.status = 200;
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'UPSERT') {
            data.row.firstName = 'John';
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);
  const model = db.model('user');
  const accessor = new Accessor(db, options);

  const email = helper.getId();

  const row = await accessor.upsert(model, { email }, { firstName: 'Jane' });
  expect(row.status).toBe(200);
  expect(row.firstName).toBe('John');
  const record = await accessor.get(model, { email });
  expect(record.firstName).toBe(null);

  const row2 = await accessor.upsert(model, { email }, { firstName: 'Jane' });
  expect(row2.firstName).toBe('John');
  const record2 = await accessor.get(model, { email });
  expect(record2.firstName).toBe('Jane');
  db.end();
});

test('delete', async () => {
  expect.assertions(2);

  const options = {
    callbacks: {
      onQuery: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'DELETE') {
            data.filter.status = 200;
          }
        }
      },
      onResult: (context, event, table, data) => {
        if (table.model.name === 'User') {
          if (event === 'DELETE') {
            if (data.row) {
              data.row.status = 500;
            } else {
              data.row = { fake: true };
            }
          }
        }
      }
    }
  };

  const db = helper.connectToDatabase(NAME);
  const model = db.model('user');
  const accessor = new Accessor(db, options);
  const email = helper.getId();

  await accessor.create(model, { email });

  const row = await accessor.delete(model, { email });
  expect(row.fake).toBe(true);
  await accessor.update(model, { status: 200 }, { email });
  const row2 = await accessor.delete(model, { email });
  expect(row2.status).toBe(500);
  db.end();
});

async function getAliceBob(callbacks) {
  const db = helper.connectToDatabase(NAME);

  const accessor = new Accessor(db, { callbacks });
  const field = db.table('user').model.field('email');

  const alice = accessor.load({ field }, 'alice@example.com');
  const bob = accessor.load({ field }, 'bob@example.com');

  const result = await Promise.all([alice, bob]);
  db.end();
  return result;
}

function createRelatedFieldData() {
  const schema = new Schema(helper.getExampleData(), options);
  const db = helper.connectToDatabase(NAME, schema);

  // 5 users
  const users = ['alice', 'bob', 'charlie', 'david', 'eve'].map(name =>
    db.table('user').append({ email: name+'@example.com', firstName: name })
  );

  // 3 groups
  const groups = ['group 1', 'group 2', 'group 1.1', 'group 1.2.1'].map(name =>
    db.table('group').append({ name })
  );

  // [0, 1, 2], [2, 3, 4]
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      db.table('user_group').append({
        user: users[i * 2 + j],
        group: groups[i]
      });
    }
  }

  // [1, 2, 3]
  let group = groups[2];
  for (let j = 1; j < 4; j++) {
    db.table('user_group').append({ user: users[j], group });
  }

  // [ 2, 3]
  group = groups[3];
  for (let j = 2; j < 4; j++) {
    db.table('user_group').append({ user: users[j], group });
  }

  return db.flush().then(() => db.end())
}

const options = {
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
    },
    {
      table: 'user_group',
      fields: [
        {
          column: 'user_id',
          throughField: 'group_id'
        }
      ]
    }
  ]
};
