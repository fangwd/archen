import helper = require('./helper');
import { Schema } from '../src/model';

const NAME = 'tree';

beforeAll(() => helper.createDatabase(NAME, false));

afterAll(() => helper.dropDatabase(NAME));

test('create', async done => {
  const table = getDatabase().table('category');

  const root = await table.create({
    name: 'All',
    parent: null
  });

  const fruit = await table.create({
    name: 'Fruit',
    parent: { connect: { id: root.id } }
  });

  const apple = await table.create({
    name: 'Apple',
    parent: { connect: { id: fruit.id } }
  });

  const fuji = await table.create({
    name: 'Fuji',
    parent: { connect: { id: apple.id } }
  });

  const gala = await table.create({
    name: 'Gala',
    parent: { connect: { id: apple.id } }
  });

  let rows;

  rows = await table.getDescendants(root.id);
  expect(rows.length).toBe(5);

  rows = await table.getAncestors(apple.id);
  expect(rows.length).toBe(3);

  rows = await table.getDescendants(apple.id);
  expect(rows.length).toBe(3);

  done();
});

function createRootCategory() {
  const db = helper.connectToDatabase(NAME);
  const root = db.table('category').append({
    //id: 1,
    name: 'All',
    parent: null
  });
  return db.flush().then(() => root);
}

function getDatabase() {
  const data = helper.getExampleData();
  const config = {
    models: [
      {
        table: 'category',
        closureTable: {
          name: 'category_tree'
        }
      }
    ]
  };
  const schema = new Schema(helper.getExampleData(), config);
  return helper.connectToDatabase(NAME, schema);
}
