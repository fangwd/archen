import { Accessor, encodeFilter, AccessorOptions } from '../src/accessor';

import helper = require('./helper');
import { Schema } from '../src/model';
import { createSchema } from '../src/schema';

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

  getAliceBob({ data, onQuery }).then(rows => {
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
    return true;
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
  const onResult = (data, action, table, options, rows) => {
    return rows.filter(row => /^alice/i.test(row.firstName)).map(row => {
      row = Object.assign(row);
      delete row.status;
      return row;
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

  const accessor = new Accessor(db, callbacks);
  const field = db.table('user').model.field('email');

  const alice = accessor.load({ field }, 'alice');
  const bob = accessor.load({ field }, 'bob');

  return Promise.all([alice, bob]);
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

test('related', done => {
  const db = helper.connectToDatabase(NAME);

  const loader = new Accessor(db);
  const field = loader.db.table('group').model.field('id');

  const callbacks = {
    data: db,
    onQuery: (data, action, table, options) => {
      if (table.model.name === 'UserGroup') {
        const where = options.where || {};
        options.where = {
          and: [where, { group: { name_like: '%1' } }]
        };
      }
    },
    onResult: async (data, action, table, options, rows) => {
      // Exclude "group 1.1"
      if (table.model.name === 'UserGroup') {
        const promises = rows.map(row => loader.load({ field }, row.group.id));
        const groups = await Promise.all(promises);
        const result = [];
        for (const row of rows) {
          const group = groups.find(group => group.id === row.group.id);
          if (group.name.indexOf('1.1') === -1) {
            result.push(row);
          }
        }
        return result;
      } else if (table.model.name === 'Group') {
        // Exclude "group 1.2.1"
        return rows
          .filter(group => group.name.indexOf('1.2.1') === -1)
          .map(group => ({ ...group, name: group.name + '$' }));
      }
    }
  } as AccessorOptions;

  const accessor = new Accessor(db, callbacks);
  const schema = createSchema(helper.getExampleData(), options);

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
  graphql.graphql(schema, DATA, null, accessor).then(result => {
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
      db
        .table('user_group')
        .append({ user: users[i * 2 + j], group: groups[i] });
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
