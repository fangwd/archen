# Getting started

Archen turns an existing relational database into a full GraphQL API. Point it
at a connection, and it generates queries, mutations, relations, pagination and
aggregates from your tables and foreign keys — no schema file to write or keep
in sync.

## Install

```sh
npm install archen
```

Archen builds on [sqlex](https://github.com/fangwd/sqlex), which talks to
**MySQL**, **PostgreSQL** and **SQLite**. Install the driver for your database:

```sh
npm install mysql2     # MySQL
npm install pg         # PostgreSQL
npm install sqlite3    # SQLite
```

## Bootstrap

Create an `Archen` instance with your connection details and call `bootstrap()`.
By default archen **introspects** the database to discover tables, columns and
relations.

```js
import { Archen } from 'archen';

const archen = new Archen({
  database: {
    connection: {
      dialect: 'mysql',
      connection: {
        host: '127.0.0.1',
        user: 'root',
        password: 'secret',
        database: 'example',
      },
    },
  },
});

await archen.bootstrap();
```

Bootstrap is asynchronous and only needs to run once. Reuse the instance across
requests rather than rebuilding it each time (see
[Embedding in a server](#embedding-in-a-server)).

## Run a query

`archen.query()` executes a GraphQL document against the generated schema.

```js
const source = `
  query {
    users(where: { status: 1 }, orderBy: ["email"], limit: 10) {
      id
      email
      orders {
        code
      }
    }
  }
`;

const data = await archen.query({ source });
// data.users -> [{ id, email, orders: [...] }, ...]
```

Pass a second argument to unwrap a single top-level field:

```js
const users = await archen.query({ source }, 'users');
```

Variables work as usual:

```js
await archen.query({
  source: `query ($id: Int!) { users(where: { id: $id }) { email } }`,
  variableValues: { id: 1 },
});
```

## Run a mutation

The same `query()` method runs mutations:

```js
await archen.query({
  source: `
    mutation {
      createUser(data: { email: "alice@example.com", firstName: "Alice" }) {
        id
      }
    }
  `,
});
```

## Embedding in a server

Build the API once and reuse it. A minimal request handler:

```js
import { Archen } from 'archen';

let ready;
function getArchen() {
  if (!ready) {
    const archen = new Archen({ database: { connection: { /* ... */ } } });
    ready = archen.bootstrap().then(() => archen);
  }
  return ready;
}

export async function handler(req, res) {
  const archen = await getArchen();
  const { query: source, variables } = req.body;
  const data = await archen.query({ source, variableValues: variables });
  res.json({ data });
}
```

See the [`example`](../example) folder for a complete Next.js app that serves
the generated API behind a GraphiQL explorer.

## Next steps

- [Configuration](./configuration.md) — connection, introspection vs. explicit
  schema, options
- [Querying](./querying.md) — lists, single rows, ordering, limits
- [Filtering](./filtering.md) — operators, `and`/`or`/`not`, relation filters
- [Pagination](./pagination.md) — cursor-based connections
- [Mutations](./mutations.md) — create/update/upsert/delete and nested writes
- [Relations](./relations.md) — foreign keys, one-to-many, many-to-many
- [Aggregates](./aggregates.md) — `count`/`sum`/`avg`/`min`/`max` and `groupBy`
- [JSON fields](./json-fields.md) — filtering into `json`/`jsonb` columns
- [Access control](./access-control.md) — which models and operations are exposed
- [Hooks](./hooks.md) — `onQuery`/`onResult`/`onError` callbacks
- [Error handling](./error-handling.md) — how errors surface from `query()`
- [Typed queries (codegen)](./codegen.md) — export SDL for typed `query()` calls
- [Accessor API](./accessor.md) — the programmatic layer beneath GraphQL
