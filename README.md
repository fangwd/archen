Archen is a simple, flexible and fast GraphQL library written in TypeScript. It
turns an existing relational database into a full GraphQL API — queries,
mutations, relations, cursor pagination and aggregates — generated from your
tables and foreign keys.

## Install

```sh
npm install archen
# plus a driver: mysql2 | pg | sqlite3
```

## Quick example

In the simplest form, archen needs nothing more than the details to connect to
an existing database — it introspects the schema for you.

```js
const { Archen } = require('archen');

const archen = new Archen({
  database: {
    connection: {
      dialect: 'mysql',
      connection: { user: 'root', password: 'secret', database: 'example' },
    },
  },
});

await archen.bootstrap();

const data = await archen.query({
  source: `
    query {
      users(where: { status: 1 }, limit: 10) {
        id
        email
        orders { code }
      }
    }
  `,
});
```

New here? Start with the **[Getting started](./docs/getting-started.md)** guide.

## Documentation

**Getting started**
- [Getting started](./docs/getting-started.md) — install, bootstrap, first query and mutation

**Guides**
- [Configuration](./docs/configuration.md) — connection, introspection vs. explicit schema, options
- [Querying](./docs/querying.md) — lists, single rows, ordering, limits, selecting relations
- [Filtering](./docs/filtering.md) — operators, `and`/`or`/`not`, foreign-key and relation filters
- [Pagination](./docs/pagination.md) — cursor-based connections (`first`/`after`, `last`/`before`)
- [Mutations](./docs/mutations.md) — create/update/upsert/delete and nested relation writes
- [Relations](./docs/relations.md) — foreign keys, one-to-one, one-to-many, many-to-many

**Advanced**
- [Aggregates](./docs/aggregates.md) — `count`/`sum`/`avg`/`min`/`max` and `groupBy`
- [JSON fields](./docs/json-fields.md) — filtering into `json`/`jsonb` columns
- [Access control](./docs/access-control.md) — which models and operations are exposed
- [Hooks](./docs/hooks.md) — `onQuery`/`onResult`/`onError` for auth, scoping and auditing
- [Error handling](./docs/error-handling.md) — `GraphQLQueryError` and structured errors
- [Typed queries (codegen)](./docs/codegen.md) — export SDL and get typed `query()` calls
- [Accessor API](./docs/accessor.md) — the programmatic layer and per-request context

## Demo app

See the [`example`](./example) folder for a Next.js app that serves the generated
API behind a GraphiQL explorer.

## Development

### Running tests

```sh
# SQLite
DB_TYPE=sqlite3 npm test

# PostgreSQL
DB_TYPE=postgres DB_USER=postgres npm test

# MySQL
DB_TYPE=mysql DB_USER=root DB_PASS=secret npm test
```

Type-check (including the test suite) with `npm run typecheck`; build with
`npm run build`.
