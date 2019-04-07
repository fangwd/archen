Archen is a simple, flexible and fast GraphQL server for your existing databases.

# Installation

`$ npm install archen`

# Usage

You can try Archen by writing 0 lines of code:

```
$ npm install express express-graphql mysql archen
$ node_modules/archen/bin/archen.js --user root --password secret --database example --listen 3000
```

Now you can open a browser and go to http://localhost:3000/graphql to interact with an automatically generated GraphQL server by Archen.

# Development

## To run the tests

```
DB_USER=root DB_PASS=secret npm run test
```

## Logging MySQL queries to file

To enable logging:

```
SET global log_output = 'FILE';
SET global general_log_file='/tmp/mysqld.log';
SET global general_log = 1;
```

To disable:
SET global general_log = 0;

```
SET global general_log = 0;
```

## Creating a sqlite3 database

The following command can help remove the `auto_increment` keywords in `example/data/schema.sql`
so to make it work for sqlite3:

```
$ sed 's/\sauto_increment//ig' example/data/schema.sql
```
