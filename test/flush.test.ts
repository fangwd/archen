import { Schema } from '../src/model';
import { Database, Table, Record } from '../src/database';

import helper = require('./helper');

const NAME = 'flush';

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
