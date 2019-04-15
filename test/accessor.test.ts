import { Accessor, encodeFilter } from '../src/accessor';

import helper = require('./helper');
import { Schema } from 'sqlex';
import { GraphQLSchemaBuilder } from '../src/schema';

import * as graphql from 'graphql';

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
      and: [options.where, { firstName: 'Alice' }]
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
      setTimeout(() => resolve(), 200);
    });
  };

  getAliceBob({ onResult }).then(result => {
    const rows = result.filter(row => row != undefined);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(undefined);
    done();
  });
});

function getAliceBob(callbacks) {
  const db = helper.connectToDatabase(NAME);

  const accessor = new Accessor(db, { callbacks });
  const field = db.table('user').model.field('email');

  const alice = accessor.load({ field }, 'alice');
  const bob = accessor.load({ field }, 'bob');

  return Promise.all([alice, bob]);
}

test('get', async done => {
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

  accessor.get(model, { email }).then(async row => {
    expect(row.fake).toBe(true);
    await accessor.update(model, { status: 200 }, { email });
    accessor.get(model, { email }).then(row => {
      expect(row.status).toBe(500);
      done();
    });
  });
});

test('query', async done => {
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

  accessor.query(model, { where: { name_like: '%1%' } }).then(async rows => {
    expect(rows.length).toBe(2);
    expect(rows[0].name.endsWith('*')).toBe(true);
    expect(rows[1].name.endsWith('*')).toBe(true);
    done();
  });
});

test('cursorQuery', async done => {
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

  accessor
    .cursorQuery(model, { where: { name_like: '%1%' } }, model.pluralName)
    .then(async result => {
      const edges = result.edges;
      expect(edges.length).toBe(2);
      expect(edges[0].node.name.endsWith('*')).toBe(true);
      expect(edges[1].node.name.endsWith('*')).toBe(true);
      done();
    });
});

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
  graphql.graphql(schema, DATA, rootValue, accessor).then(result => {
    const users = result.data.users;
    const names = [
      ...users.reduce((result, user) => {
        user.groups.forEach(group => result.add(group.name));
        return result;
      }, new Set())
    ];
    expect(names.length).toBe(1);
    expect(names[0].endsWith('$')).toBe(true);
    done();
  });
});

test('create', done => {
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
  accessor.create(db.model('user'), { email: helper.getId() }).then(row => {
    expect(row.status).toBe(200);
    expect(row.firstName).toBe('John');
    done();
  });
});

test('update', async done => {
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
  accessor
    .update(model, { lastName: 'Doe' }, { email: user.email })
    .then(async row => {
      expect(row.status).toBe(200);
      expect(row.firstName).toBe('John');
      expect(row.lastName).toBe('Doe');
      const record = await accessor.get(model, { email: user.email });
      expect(record.firstName).toBe(null);
      done();
    });
});

test('upsert', async done => {
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

  function _create() {
    return accessor
      .upsert(model, { email }, { firstName: 'Jane' })
      .then(async row => {
        expect(row.status).toBe(200);
        expect(row.firstName).toBe('John');
        const record = await accessor.get(model, { email });
        expect(record.firstName).toBe(null);
      });
  }

  function _update() {
    return accessor
      .upsert(model, { email }, { firstName: 'Jane' })
      .then(async row => {
        expect(row.firstName).toBe('John');
        const record = await accessor.get(model, { email });
        expect(record.firstName).toBe('Jane');
      });
  }

  _create()
    .then(() => _update())
    .then(() => done());
});

test('delete', async done => {
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

  accessor.delete(model, { email }).then(async row => {
    expect(row.fake).toBe(true);
    await accessor.update(model, { status: 200 }, { email });
    accessor.delete(model, { email }).then(row => {
      expect(row.status).toBe(500);
      done();
    });
  });
});

function createRelatedFieldData() {
  const schema = new Schema(helper.getExampleData(), options);
  const db = helper.connectToDatabase(NAME, schema);

  // 5 users
  const users = ['alice', 'bob', 'charlie', 'david', 'eve'].map(name =>
    db.table('user').append({ email: name, firstName: name })
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

  return db.flush();
}
