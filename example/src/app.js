const Archen = require('./index');

const knex = require('knex')({
  client: 'mysql',
  connection: {
    host: '127.0.0.1',
    user: 'root',
    password: 'secret',
    database: 'newpro',
  },
  pool: { min: 0, max: 7 },
});

const fileName = require('path').join(__dirname, 'schema.json');

const server = new Archen(require('fs').readFileSync(fileName), knex);

server.start(3000, () => console.log('Example server running on port 3000'));
