const { Archen, Database, Document } = require('../../index');

const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'archen_test',
  },
  pool: { min: 0, max: 7 },
});

const generateSchemaFromDatabase = () => {
  const fileName = require('path').join(__dirname, 'schema.json');
  return new Database(JSON.parse(require('fs').readFileSync(fileName)));
}

const generateFromGraphql = () => {
  const fileName = require('path').join(__dirname, 'schema.graphql');
  return new Document(require('fs').readFileSync(fileName));
}

const schema = generateSchemaFromDatabase();

const server = new Archen(schema, knex);
server.start(3000, () => console.log('Example server running on port 3000'));
