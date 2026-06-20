# Relations

Archen derives relations from foreign keys and exposes them as fields. There is
nothing to configure — if the database has the constraints, the relations appear.
Related data is loaded in batches (via DataLoader), so selecting relations across
a list doesn't cause N+1 queries.

## Foreign keys → parent object

A foreign-key column becomes an object field returning the referenced row:

```graphql
query {
  orders {
    code
    user { email }            # order.user_id -> User
    deliveryAddress { city }  # order.delivery_address_id -> DeliveryAddress
  }
}
```

## Reverse relations

The reverse side of a foreign key becomes a field on the referenced model:

- If the foreign key is **unique**, it's a **one-to-one** and returns a single
  object (e.g. `user.userProfile`).
- Otherwise it's **one-to-many** and returns a list (e.g. `user.orders`).

To-many relation fields accept the same arguments as a list query —
`where`, `orderBy`, `limit`, `offset`:

```graphql
query {
  users {
    email
    orders(where: { status: 1 }, orderBy: ["-dateCreated"], limit: 5) {
      code
    }
  }
}
```

## Many-to-many

When two models are linked through a join table, archen exposes the far side
directly, skipping the join row:

```graphql
query {
  users {
    groups { name }     # user -> user_group -> group
  }
}
```

## Connections on relations

Every to-many relation also gets a `<relation>Connection` field for
[cursor pagination](./pagination.md):

```graphql
query {
  user(id: 1) {
    ordersConnection(first: 10, orderBy: ["-dateCreated"]) {
      edges { node { code } cursor }
      pageInfo { hasNextPage }
    }
  }
}
```

## Filtering through relations

- Filter on a **parent** via its foreign-key field:
  `orders(where: { user: { status: 1 } })`.
- Filter rows by their **related** rows with `_some` / `_none`:
  `users(where: { groups_some: { name: "ADMIN" } })`.

See [Filtering](./filtering.md) for the details.

## Writing relations

Create, connect, update, disconnect or delete related rows inline in a mutation
— see [nested relation writes](./mutations.md#nested-relation-writes).

> The exact generated field names come from your table and constraint names.
> Open the schema in GraphiQL (see the [example app](../example)) to browse the
> precise names for your database.
