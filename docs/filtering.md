# Filtering

Every list field, connection and `deleteMany`/`updateMany` mutation takes a
`where` filter generated from the model's columns and relations. A filter is an
object; keys are columns (optionally with an operator suffix), relations, or the
logical combinators `and`/`or`/`not`.

```graphql
query {
  products(where: { status: 1, price_gt: 10, name_like: "Australian%" }) {
    name
  }
}
```

Multiple keys in one object are combined with **AND**.

## Operators

For a scalar column `field`, archen generates these filter keys:

| Key            | Meaning                          |
| -------------- | -------------------------------- |
| `field`        | equals                           |
| `field_ne`     | not equal                        |
| `field_lt`     | less than                        |
| `field_le`     | less than or equal               |
| `field_gt`     | greater than                     |
| `field_ge`     | greater than or equal            |
| `field_in`     | in a list (`[type]`)             |
| `field_null`   | `true` → is null, `false` → not null |
| `field_like`   | `LIKE` (string columns only)     |
| `field_ilike`  | case-insensitive `LIKE` (strings)|

```graphql
products(where: {
  status_in: [1, 2]
  price_ge: 5
  name_ilike: "%apple%"
  sku_null: false
})
```

> These top-level operators use a **single** underscore (`price_gt`). Operators
> *inside* a JSON column use a double underscore by default (`age__gt`) — see
> [JSON fields](./json-fields.md).

## `and` / `or` / `not`

Each filter type has `and`, `or` and `not`, taking a list of sub-filters:

```graphql
products(where: {
  or: [
    { name_like: "Australian%" },
    { and: [{ price_gt: 10 }, { status: 1 }] }
  ]
  not: [{ sku: "sku004" }]
})
```

## Foreign-key filters

A foreign-key column is filtered with the **referenced model's** filter, so you
can match on the parent's columns:

```graphql
orders(where: { user: { email: "alice@example.com" } }) {
  code
}
```

This works at any depth: `orderItems(where: { order: { user: { status: 1 } } })`.

## Relation filters: `_some` / `_none`

For each to-many relation, archen adds `<relation>_some` and `<relation>_none`,
matching rows where **some** / **none** of the related rows pass a sub-filter:

```graphql
# users who belong to at least one ADMIN group
users(where: { groups_some: { name: "ADMIN" } }) { email }

# products that are in no category
products(where: { categories_none: {} }) { name }
```

## JSON columns

`json`/`jsonb` columns take a nested filter object that descends into the
document. See [JSON fields](./json-fields.md).

## Where filters apply

The same `where` language is used by:

- list queries — `products(where: …)`
- to-many relation fields — `user { orders(where: …) }`
- connections — `productsConnection(where: …)`
- aggregates — `productsAggregate(where: …)`
- bulk mutations — `updateProducts(where: …)`, `deleteProducts(where: …)`
