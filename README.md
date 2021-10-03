Archen is a simple, flexible and fast GraphQL library written in Typescript.

# Installation

`$ npm install archen`

# Usage

Archen is ridiculously easy to use. In the simplest form, it requires nothing more than the details to connect to an existing database. Below is an example to add GraphQL API to a MySQL database:


```js
const { Archen } = require('archen');

const archen = new Archen({
  database: {
    connection: {
      dialect: 'postgres',
      connection: {
        user: 'root',
        password: 'secret',
        database: 'example'
      }
    }
  }
});

await archen.bootstrap();

const source = `
  query {
    users {
      id
      email
    }
  }
`;

const result = await archen.query({ source });

// console.log(result.users);
```

## Command line

Archen provides a command line tool that lets you add GraphQL API to your existing databases without writing any code:

```
$ npm install express express-graphql mysql archen
$ node_modules/archen/bin/archen.js --user root --password secret --database example --listen 3000
```

Now you can open a browser and go to http://localhost:3000/graphql to interact with an automatically generated GraphQL server by Archen.

# Configuration

Archen can be configured using an [`ArchenConfig`](https://github.com/fangwd/archen/blob/master/src/index.ts) object.

## Exporting models to GraphQL API

By default, archen exports all models and fields to the GraphQL API. To stop a model from being exported, add an entry in `graphql.models` field and set it to false. The following config shows how to export all models except for `User`:

```js
{
  graphql: {
    models: {
      User: false
    }
  }
}
```

Setting `graphql.allowAll` to `false` stops all models being exported to the API by default. The following config exports only `Product` and `Category` to the API:

```js
{
  graphql: {
    allowAll: false,
    models: {
      Product: true,
      Category: true
    }
  }
}
```

## Customising accessibility

The following config forbids creating `User` objects via the generated API:
```js
{
  graphql: {
    models: {
      User: {
        create: false,
      },
    }
  }
}
```

# Development

## Running tests

```
# Test for SQLite
$ DB_TYPE=sqlite3 npm run test

# Test for Postgres
$ DB_TYPE=postgres DB_USER=postgres npm run test

# Test for MySQL
$ DB_TYPE=mysql DB_USER=root DB_PASS=secret npm run test
```
