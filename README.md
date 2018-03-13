# Installation

`$ npm install archen`

# Usage

Archen can be used in your express app in a couple of steps as shown in the example below.

```javascript
const express = require('express');
const graphqlHTTP = require('express-graphql');

// 1. Create an express app
const app = express();

// 2. Create a database connection
const knex = require('knex')({
  client: 'sqlite3',
  connection: { filename: 'example.db' },
  useNullAsDefault: true
});

// 3. Create an archen object
const archen = require('archen')(
  require('fs').readFileSync('data/schema.json')
);

// 4. Connect archen to your express app
app.use(
  '/graphql',
  graphqlHTTP(async (request, response, params) => ({
    schema: archen.getSchema(),
    context: archen.getContext(knex)
  }))
);

// 5. Run
app.listen(3000);
```

See `example/src/app.js` for an example using MySQL.

# Development

To start the example graphql server for development using mysql:

```
$ echo 'drop database if exists example; create database example' | mysql -uroot -psecret
$ cat example/data/schema.sql example/data/data.sql | mysql -uroot -psecret example
$ npm install express express-graphql mysql
$ NODE_ENV=development nodemon example/src/app.js
```
