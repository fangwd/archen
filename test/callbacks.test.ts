import { Schema } from '../src/model';
import { createSchema } from '../src/schema';
import { Accessor } from '../src/accessor';
import * as graphql from 'graphql';
import helper = require('./helper');

const NAME = 'callbacks';

// beforeAll(() => {
//   return helper
//     .createDatabase(NAME, false)
//     .then(() => createRelatedFieldData());
// });
//afterAll(() => helper.dropDatabase(NAME));

/*
test('onQuery - data', done => {
  expect.assertions(2);

  const data = {};

  const onQuery = (context, action, table, options) => {
    expect(context).toBe(data);
  };

  getAliceBob({ data, onQuery }).then(rows => {
    expect(rows.length).toBe(2);
    done();
  });
});

test('onQuery - default', done => {
  getAliceBob({ onQuery: () => undefined }).then(rows => {
    expect(rows.length).toBe(2);
    done();
  });
});

test('onQuery - filter', done => {
  const onQuery = (data, action, table, queryData) => {
    const options = queryData.options;
    options.where = {
      and: [options.where, { firstName: 'Alice' }]
    };
    return queryData;
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
    const rows = queryData.rows
      .filter(row => /^alice/i.test(row.firstName))
      .map(row => {
        row = Object.assign(row);
        delete row.status;
        return row;
      });
    queryData.rows = rows;
  };

  getAliceBob({ onResult }).then(result => {
    const rows = result.filter(row => row != undefined);
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe(undefined);
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

  db.callbacks = {
    data: db,
    onQuery: (data, queryType, table, queryData) => {
      if (table.model.name === 'UserGroup') {
        const where = queryData.options.where || {};
        queryData.options.where = {
          and: [where, { group: { name_like: '%1' } }]
        };
      }
    },
    onResult: (data, queryType, table, queryData) => {
      // Exclude "group 1.1"
      if (table.model.name === 'UserGroup') {
        const rows = queryData.rows;
        return new Promise(async resolve => {
          const groups = await db
            .table('group')
            .select('*', { where: { id: rows.map(row => row.group.id) } });
          const result = [];
          for (const row of rows) {
            const group = groups.find(group => group.id === row.group.id);
            if (group && group.name.indexOf('1.1') === -1) {
              result.push(row);
            }
          }
          queryData.rows = result;
          resolve(queryData);
        });
      } else if (table.model.name === 'Group') {
        // Exclude "group 1.2.1"
        queryData.rows = queryData.rows
          .filter(group => group.name.indexOf('1.2.1') === -1)
          .map(group => ({ ...group, name: group.name + '$' }));
      }
    }
  };

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

  const accessor = new Accessor(db);

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

test('get', done => {
  const onQuery = (data, action, table, queryData) => {
    const where = queryData.options.where || {};
    where.status = -1;
    queryData.options.where = where;
  };
  const db = helper.connectToDatabase(NAME);
  db
    .table('user')
    .get({ email: 'alice' })
    .then(row => {
      expect(!!row).toBe(true);
      db.callbacks = { onQuery };
      db
        .table('user')
        .get({ email: 'alice' })
        .then(row => {
          expect(!!row).toBe(false);
          done();
        });

      done();
    });
});

test('create', done => {
  const onQuery = (data, action, table, queryData) => {
    if (table.model.name === 'User') {
      queryData.status = 200;
    }
  };
  const db = helper.connectToDatabase(NAME);
  db.callbacks = { onQuery };
  db
    .table('user')
    .create({ email: helper.getId() })
    .then(row => {
      expect(row.status).toBe(200);
      done();
    });
});
*/

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

function getAliceBob(callbacks) {
  const db = helper.connectToDatabase(NAME);
  db.callbacks = callbacks;
  return db
    .table('user')
    .select('*', { where: { email_in: ['alice', 'bob'] } });
}
