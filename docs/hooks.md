# Hooks

Lifecycle callbacks run around every database operation. Use them for
authorization, multi-tenant scoping, redacting fields, auditing and logging.
They are configured under `accessor.callbacks`:

```js
new Archen({
  database: { connection },
  accessor: {
    callbacks: {
      context: { /* anything you want passed to each callback */ },
      onQuery:  (context, event, table, data, root) => { /* before */ },
      onResult: (context, event, table, data, root) => { /* after */ },
      onError:  (context, event, table, error) => { /* on failure */ },
    },
  },
});
```

## Signature

```ts
type Callback = (
  context: any,
  event: string,        // 'SELECT' | 'GET' | 'CREATE' | 'UPDATE' | 'UPSERT' | 'DELETE'
  table: Table,         // table.model.name identifies the model
  data: any,            // operation-specific (see below)
  root?: boolean        // true for top-level reads; absent for nested loads and writes
) => any | Promise<any>;
```

- `context` is the `callbacks.context` value you configured.
- `root` is `true` for top-level queries/gets so you can distinguish them from
  relation loads.
- Callbacks may be `async` (return a `Promise`).

## `onQuery` — before

Runs before the operation. Its return value decides what happens:

| Returns      | Effect                                                |
| ------------ | ----------------------------------------------------- |
| `undefined`  | Proceed unchanged                                     |
| `false`      | Block the operation (`query()` rejects with `Forbidden`) |
| any value    | Replace `data` with the returned value                |

Tighten a filter (e.g. tenant scoping or row-level rules):

```js
onQuery: (ctx, event, table, data) => {
  if (table.model.name === 'Order' && event === 'SELECT') {
    data.where = { and: [data.where, { user: { id: ctx.userId } }] };
  }
  // returning undefined keeps the mutated `data`
}
```

Block an operation:

```js
onQuery: (ctx, event, table) => {
  if (table.model.name === 'User' && event === 'DELETE') return false;
}
```

## `onResult` — after

Runs after the operation with the result. Same return semantics — return a value
to replace the result, `false` to forbid, `undefined` to leave it unchanged.

```js
onResult: (ctx, event, table, data) => {
  if (table.model.name === 'User' && event === 'SELECT') {
    data.rows = data.rows.map(({ passwordHash, ...rest }) => rest);
  }
}
```

## `onError`

Runs when an operation rejects. It's for observation or transformation: if it
throws, that error propagates; otherwise the original error is rethrown.

```js
onError: (ctx, event, table, error) => {
  logger.error(`${event} on ${table.model.name} failed`, error);
  // throw new PublicError('Something went wrong') to replace it
}
```

`onError` covers the top-level query and mutation operations. (Errors inside
batched relation loaders propagate to GraphQL but don't invoke `onError`.)

## `data` by event

| Event    | `onQuery` data            | `onResult` data                  |
| -------- | ------------------------- | -------------------------------- |
| `SELECT` (list) | `{ where, limit, offset, orderBy }` | `{ rows, ... }`        |
| `SELECT` (aggregate) | `{ where, fields, groupBy }`   | `{ rows }`             |
| `GET`    | `{ filter }`              | `{ filter, row }`                |
| `CREATE` | the create document       | the created row                  |
| `UPDATE` | `{ data, filter }`        | `{ data, filter, row }`          |
| `UPSERT` | `{ create, update }`      | `{ create, update, row }`        |
| `DELETE` (one)  | `{ filter }`       | `{ filter, row }`                |
| `DELETE` (many) | `{ filter }`       | `{ filter, result }`             |

`SELECT` callbacks also fire for relation loads (with `root` unset), so a scoping
rule added in `onQuery` applies to nested reads as well as top-level ones.
