# Pagination

Besides the plain list field, every model gets a **connection** field for
cursor-based pagination, named `<plural>Connection`.

```graphql
query {
  productsConnection(first: 3, orderBy: ["id"]) {
    totalCount
    edges {
      node { id name price }
      cursor
    }
    pageInfo {
      startCursor
      endCursor
      hasNextPage
      hasPreviousPage
    }
    products        # the nodes directly, without the edge wrapper
  }
}
```

A connection exposes:

| Field         | Description                                              |
| ------------- | -------------------------------------------------------- |
| `totalCount`  | Total matching rows (only computed when selected)        |
| `edges`       | `{ node, cursor }` per row                               |
| `pageInfo`    | `startCursor`, `endCursor`, `hasNextPage`, `hasPreviousPage` |
| `<plural>`    | The nodes as a flat list (convenience)                   |

## Arguments

| Argument  | Type       | Description                              |
| --------- | ---------- | ---------------------------------------- |
| `where`   | filter     | Row filter — see [Filtering](./filtering.md) |
| `orderBy` | `[String]` | Sort fields (see the note below)         |
| `first`   | `Int`      | Take the first N (forward pagination)    |
| `after`   | `String`   | Cursor to start after (forward)          |
| `last`    | `Int`      | Take the last N (backward pagination)    |
| `before`  | `String`   | Cursor to end before (backward)          |

## Forward pagination

Use `first` with `after`. Take `pageInfo.endCursor` from one page and pass it as
`after` to get the next:

```graphql
# page 1
productsConnection(first: 3, orderBy: ["id"]) {
  edges { node { id } cursor }
  pageInfo { endCursor hasNextPage }
}

# page 2
productsConnection(first: 3, after: "<endCursor>", orderBy: ["id"]) {
  edges { node { id } }
}
```

## Backward pagination

Use `last` with `before`. Results come back in the requested order, and
`hasPreviousPage` tells you whether an earlier page exists:

```graphql
productsConnection(last: 3, before: "<cursor>", orderBy: ["id"]) {
  edges { node { id } }
  pageInfo { hasPreviousPage }
}
```

## `orderBy` must resolve to a unique key

Cursors encode the position of a row by its sort columns, so the `orderBy` must
identify rows uniquely. Archen appends the primary key automatically, so a normal
`orderBy` is fine; but an `orderBy` that can't be resolved to a unique key (for
example one that stops at a non-unique relation column) raises a clear error
rather than returning inconsistent pages.

`orderBy` entries may traverse relations with dotted paths
(`orderBy: ["order.user.email"]`) and use a leading `-` for descending order.
