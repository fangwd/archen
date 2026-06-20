# Mutations

For every model archen generates create, update, upsert and delete fields on the
`Mutation` type. Single-row writes return the affected row; bulk writes return a
count.

| Field               | Args                         | Returns               |
| ------------------- | ---------------------------- | --------------------- |
| `createUser`        | `data`                       | `User`                |
| `updateUser`        | `where`, `data`              | `User`                |
| `updateUsers`       | `where`, `data`              | `{ affectedRows, changedRows }` |
| `upsertUser`        | `create`, `update`           | `User`                |
| `deleteUser`        | unique-key fields            | `User`                |
| `deleteUsers`       | filter fields                | `{ affectedRows, changedRows }` |

(`createUser` → `Create<Model>Input`; bulk fields use the model's Pascal-cased
plural name, e.g. `updateUsers`, `deleteUsers`.)

## Create

```graphql
mutation {
  createUser(data: { email: "alice@example.com", firstName: "Alice", status: 1 }) {
    id
    email
  }
}
```

## Update

`updateUser` updates a single row identified by a unique key (`where`):

```graphql
mutation {
  updateUser(where: { email: "alice@example.com" }, data: { status: 2 }) {
    id
    status
  }
}
```

`updateUsers` updates every row matching a [filter](./filtering.md) and returns a
count:

```graphql
mutation {
  updateUsers(where: { status: 0 }, data: { status: 1 }) {
    affectedRows
    changedRows
  }
}
```

## Upsert

`upsertUser` inserts when no matching row exists (using the unique keys in
`create`), otherwise applies `update`:

```graphql
mutation {
  upsertUser(
    create: { email: "alice@example.com", firstName: "Alice" }
    update: { firstName: "Alice B." }
  ) {
    id
  }
}
```

## Delete

`deleteUser` removes one row by a unique key and returns it:

```graphql
mutation {
  deleteUser(id: 1) { email }
}
```

`deleteUsers` removes every row matching a filter (its fields are passed as
arguments) and returns a count:

```graphql
mutation {
  deleteUsers(status: 0) { affectedRows }
}
```

> When `graphql.useWhereForGetOne` is enabled, `deleteUser` takes its unique-key
> fields under a `where` argument, mirroring the single-row query.

## Nested relation writes

`data` (and `create`/`update`) can write related rows in the same mutation. The
building blocks, depending on the relation:

| Verb         | Effect                                                       |
| ------------ | ------------------------------------------------------------ |
| `connect`    | Link to an existing row by a unique key                      |
| `create`     | Insert and link a new related row                            |
| `upsert`     | Connect if it exists, otherwise create                       |
| `update`     | Update linked row(s)                                         |
| `set`        | Replace the set of linked rows (to-many)                     |
| `delete`     | Delete linked row(s) matching a filter (to-many)             |
| `disconnect` | Unlink without deleting (to-many)                            |

Link to an existing parent while creating a row:

```graphql
mutation {
  createOrder(data: {
    code: "order-1"
    user: { connect: { email: "alice@example.com" } }
  }) {
    id
  }
}
```

Create a row together with its children:

```graphql
mutation {
  createOrder(data: {
    code: "order-2"
    user: { connect: { id: 1 } }
    orderItems: {
      create: [
        { quantity: 2, product: { connect: { sku: "sku001" } } },
        { quantity: 1, product: { connect: { sku: "sku003" } } }
      ]
    }
  }) {
    id
    orderItems { quantity product { name } }
  }
}
```

Update a row's relations — replace, add, or remove children:

```graphql
mutation {
  updateOrder(where: { code: "order-2" }, data: {
    orderItems: {
      update: [{ where: { product: { sku: "sku001" } }, data: { quantity: 5 } }]
      delete: [{ product: { sku: "sku003" } }]
    }
  }) {
    id
  }
}
```

Which verbs are available depends on the relation kind: a to-one relation offers
`connect`/`create`/`upsert`/`update`; a to-many relation also offers
`set`/`delete`/`disconnect`. Nested writes run in a single transaction.

See [Relations](./relations.md) for how relations are derived from your schema,
and [Access control](./access-control.md) to disable specific operations.
