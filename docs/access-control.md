# Access control

By default archen exposes every model with the full set of query and mutation
fields. The `graphql.allowAll` and `graphql.models` options control what is
generated.

These options govern which **root** `Query`/`Mutation` fields exist. For
row-level rules (and for hiding data reached through relations), use
[hooks](./hooks.md).

## Hide a model

Set a model to `false` to drop all of its root query and mutation fields:

```js
new Archen({
  database: { connection },
  graphql: {
    models: { User: false },
  },
});
```

The `User` type may still appear through relations on other models (e.g.
`order.user`); only its top-level entry points are removed.

## Allow-list with `allowAll: false`

Set `allowAll` to `false` to hide every model by default, then opt specific
models in:

```js
graphql: {
  allowAll: false,
  models: {
    Product: true,
    Category: true,
  },
}
```

Only `Product` and `Category` are exposed.

## Per-operation control

Give a model an object to enable or disable individual operations:

```js
graphql: {
  models: {
    User: { create: false },        // no createUser; reads/updates/deletes remain
    Order: { delete: false, update: false },
  },
}
```

| Key      | Controls                                                        |
| -------- | -------------------------------------------------------------- |
| `select` | `<plural>`, `<model>`, `<plural>Connection`, `<plural>Aggregate` |
| `create` | `create<Model>`                                                |
| `update` | `update<Model>`, `update<Plural>`                              |
| `upsert` | `upsert<Model>`                                                |
| `delete` | `delete<Model>`, `delete<Plural>`                              |

An unspecified operation falls back to the default (`allowAll`), so
`{ create: false }` disables only create and leaves the rest enabled. Combine
with `allowAll: false` to build a precise allow-list, e.g. a read-only API:

```js
graphql: {
  allowAll: false,
  models: { Product: { select: true } },   // queries only, no mutations
}
```

When no model exposes a write operation, the generated schema has no `Mutation`
type at all.
