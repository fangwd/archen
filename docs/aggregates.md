# Aggregates

Each model gets a `<plural>Aggregate` field that computes `count`, `sum`, `avg`,
`min` and `max` over a filtered set, optionally grouped. It returns a **list**:
one entry per group, or a single entry when not grouping.

```graphql
query {
  productsAggregate(where: { status: 1 }) {
    count
    sum { price stockQuantity }
    avg { price }
    min { price name }
    max { price }
  }
}
# -> [{ count: 7, sum: { price: 84, ... }, avg: { price: 12 }, ... }]
```

## Shape

`<Model>Aggregate` exposes:

| Field   | Type                    | Notes                                         |
| ------- | ----------------------- | --------------------------------------------- |
| `count` | `Int`                   | Row count                                     |
| `sum`   | `<Model>NumberAggregate`| Numeric columns only; returned as `Float`     |
| `avg`   | `<Model>NumberAggregate`| Numeric columns only; returned as `Float`     |
| `min`   | `<Model>FieldAggregate` | Numeric and string columns; keeps column type |
| `max`   | `<Model>FieldAggregate` | Numeric and string columns; keeps column type |
| `keys`  | `<Model>FieldAggregate` | The grouped column values (see below)         |

`sum`/`avg` only contain the model's numeric columns; `min`/`max`/`keys` also
contain string columns. Sub-objects are omitted from the type when a model has no
fields of the relevant kind.

Request only what you need — archen computes exactly the functions and columns
you select.

## Grouping

Pass `groupBy: [String]` to get one entry per distinct combination of the named
columns. Read the group values through `keys`:

```graphql
query {
  productsAggregate(groupBy: ["status"]) {
    keys { status }
    count
    avg { price }
  }
}
# -> [ { keys: { status: 1 }, count: 7, avg: { price: 12 } },
#      { keys: { status: 0 }, count: 1, avg: { price: 8 } } ]
```

You can group by more than one column: `groupBy: ["status", "sku"]`. Grouping is
supported on numeric, string and date columns.

## Filtering

`where` filters rows **before** aggregation, using the same
[filter language](./filtering.md) as list queries:

```graphql
productsAggregate(where: { price_gt: 10 }, groupBy: ["status"]) {
  keys { status }
  count
}
```

Aggregate access follows the model's `select` permission — see
[Access control](./access-control.md).
