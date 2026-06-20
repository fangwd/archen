# Accessor API

The `Accessor` is the layer beneath GraphQL: it runs the actual database
operations, applies the [hooks](./hooks.md), and batches relation loads. The
generated resolvers call into it. Most applications never touch it directly, but
it's the seam for advanced embedding — per-request context, custom auth, or
calling operations programmatically.

## What `getAccessor` does

When a resolver runs, it calls `options.getAccessor(contextValue)` to obtain the
`Accessor`. By default `getAccessor` returns the context value unchanged, and
`archen.query()` passes the bootstrapped accessor as the context — so it "just
works".

Override `getAccessor` when your GraphQL context isn't itself an accessor:

```js
const archen = new Archen({
  database: { connection },
  graphql: {
    getAccessor: (context) => context.accessor,
  },
});
```

## Per-request accessor

`archen.query()` always uses the single bootstrapped accessor. To scope each
request (e.g. carry the current user into [hooks](./hooks.md)), run GraphQL
yourself against the generated schema with your own context value:

```js
import { graphql } from 'graphql';
import { Accessor } from 'archen';

await archen.bootstrap();
const db = archen.accessor.db;          // reuse the bootstrapped connection/schema

async function handle(req) {
  const accessor = new Accessor(db, {
    callbacks: {
      context: { userId: req.userId },
      onQuery: (ctx, event, table, data) => {
        if (table.model.name === 'Order' && event === 'SELECT') {
          data.where = { and: [data.where, { user: { id: ctx.userId } }] };
        }
      },
    },
  });

  return graphql({
    schema: archen.graphql.getSchema(),
    rootValue: archen.graphql.getRootValue(),
    contextValue: { accessor },           // matches the getAccessor above
    source: req.query,
    variableValues: req.variables,
  });
}
```

## Constructor

```ts
new Accessor(db: Database, options?: {
  defaultLimit?: number;        // default 100
  callbacks?: {
    context?: any;
    onQuery?: Callback;
    onResult?: Callback;
    onError?: Callback;
  };
});
```

## Methods

Each method runs the matching [lifecycle event](./hooks.md) and resolves to plain
rows/documents.

| Method                                   | GraphQL field           |
| ---------------------------------------- | ----------------------- |
| `query(model, options)`                  | `<plural>`              |
| `get(model, filter)`                     | `<model>`               |
| `cursorQuery(model, args, pluralName, fields?, root?)` | `<plural>Connection` |
| `aggregate(model, args, requested)`      | `<plural>Aggregate`     |
| `create(model, data)`                    | `create<Model>`         |
| `update(model, data, filter)`            | `update<Model>`         |
| `updateMany(model, data, filter)`        | `update<Plural>`        |
| `upsert(model, create, update)`          | `upsert<Model>`         |
| `delete(model, filter)`                  | `delete<Model>`         |
| `deleteMany(model, filter)`              | `delete<Plural>`        |
| `load(key, value, fields?)`              | relation fields (batched)|

`model` is a sqlex `Model` (`archen.schema.model('User')` or `db.model('user')`).
`options`/`filter` use the sqlex filter language, which is what the GraphQL
`where` inputs compile to.

```js
const users = await archen.accessor.query(archen.schema.model('User'), {
  where: { status: 1 },
  orderBy: ['email'],
  limit: 10,
});
```

`load` is DataLoader-backed and dedupes/batches across a single GraphQL
execution; it's used by relation resolvers and rarely called directly.
