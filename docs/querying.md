# Querying

For every model archen generates a set of read fields on the `Query` type. Using
a `User` model as the example:

| Field                | Returns         | Purpose                                       |
| -------------------- | --------------- | --------------------------------------------- |
| `users`              | `[User]`        | List rows, with `where`/`orderBy`/`limit`     |
| `user`               | `User`          | Fetch one row by a unique key                 |
| `usersConnection`    | `UserConnection`| Cursor [pagination](./pagination.md)          |
| `usersAggregate`     | `[UserAggregate]`| [Aggregates](./aggregates.md)                |

The list field is named after the model's plural name; the single-row field is
the model name with a lower-case first letter.

## List rows

```graphql
query {
  users(
    where: { status: 1 }
    orderBy: ["-status", "email"]
    limit: 20
    offset: 0
  ) {
    id
    email
  }
}
```

| Argument  | Type       | Description                                              |
| --------- | ---------- | -------------------------------------------------------- |
| `where`   | `FilterUserInput` | Row filter — see [Filtering](./filtering.md)      |
| `orderBy` | `[String]` | Sort fields; prefix a field with `-` for descending      |
| `limit`   | `Int`      | Maximum rows (defaults to `accessor.defaultLimit`, 100)  |
| `offset`  | `Int`      | Rows to skip                                             |

`orderBy` entries may traverse relations with dotted paths, e.g.
`orderBy: ["order.user.email"]`.

> A list query with no `limit` is capped at `defaultLimit` (100 by default) so a
> bare `users { id }` never reads an entire table. Pass an explicit `limit` to
> override.

## Get a single row

The single-row field accepts any **unique key** of the model (its primary key or
a column/relation with a unique constraint). By default the unique-key fields are
spread as top-level arguments:

```graphql
query {
  user(id: 1) { email }
}

query {
  user(email: "alice@example.com") { id firstName }
}
```

If `graphql.useWhereForGetOne` is enabled, those fields move under a `where`
argument instead:

```graphql
query {
  user(where: { email: "alice@example.com" }) { id }
}
```

Returns `null` when no row matches.

## Selecting related data

Relations are ordinary fields — select them and archen loads them efficiently
(batched, no N+1). To-many relations accept the same `where`/`orderBy`/`limit`
arguments as a list query:

```graphql
query {
  users {
    email
    orders(where: { status: 1 }, orderBy: ["-dateCreated"], limit: 5) {
      code
      orderItems {
        quantity
        product { name price }
      }
    }
  }
}
```

See [Relations](./relations.md) for foreign keys, one-to-many and many-to-many.

## Counting

Use [`usersAggregate { count }`](./aggregates.md), or the `totalCount` field of a
[connection](./pagination.md).
