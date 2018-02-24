const graphql = require('graphql');

const QueryOptions = {
  limit: { type: graphql.GraphQLInt },
  offset: { type: graphql.GraphQLInt },
  orderBy: { type: graphql.GraphQLString },
};

class Builder {
  constructor(db, options = { plural: {} }) {
    this.db = db;
    this.options = options;
  }

  build() {
    const modelFields = {};

    const modelTypes = {};
    for (const table of this.db.tables) {
      const modelType = new graphql.GraphQLObjectType({
        name: table.name,
        fields() {
          return modelFields[table.name];
        },
      });
      modelTypes[table.name] = modelType;
    }

    const whereTypes = {};
    const whereFields = {};

    for (const table of this.db.tables) {
      const fields = {};
      for (const column of table.columns) {
        const fieldType = getType(column.type);
        fields[column.name] = { type: fieldType };
        for (const op of ['lt', 'le', 'ge', 'gt', 'ne']) {
          const name = column.name + '__' + op;
          fields[name] = { type: fieldType };
        }
        for (const op of ['is_null']) {
          const name = column.name + '__' + op;
          fields[name] = { type: graphql.GraphQLBoolean };
        }
        for (const op of ['in']) {
          const name = column.name + '__' + op;
          fields[name] = { type: new graphql.GraphQLList(fieldType) };
        }
        if (fieldType === graphql.GraphQLString) {
          const name = column.name + '__like';
          fields[name] = { type: fieldType };
        }
      }
      const whereType = new graphql.GraphQLInputObjectType({
        name: table.name + 'WhereType',
        fields() {
          return fields;
        },
      });
      fields['_and'] = { type: new graphql.GraphQLList(whereType) };
      fields['_or'] = { type: new graphql.GraphQLList(whereType) };
      fields['_not'] = { type: new graphql.GraphQLList(whereType) };
      whereTypes[table.name] = whereType;
      whereFields[table.name] = fields;
    }

    const uniqueFields = {};
    for (const table of this.db.tables) {
      const fields = {};
      for (const column of table.columns) {
        if (column.unique) {
          fields[column.name] = { type: getType(column.type) };
        }
      }
      uniqueFields[table.name] = fields;
    }

    for (const table of this.db.tables) {
      modelFields[table.name] = {};
      for (const column of table.columns) {
        modelFields[table.name][column.name] = { type: getType(column.type) };
        if (column.references) {
          modelFields[table.name][column.objectName] = {
            type: modelTypes[column.references.table.name],
            resolve(obj, args, req) {
              return req.loader.load(column.references, obj[column.name]);
            },
          };
          whereFields[table.name][column.objectName] = {
            type: whereTypes[column.references.table.name],
          };
        }
        column.referencedBy.forEach(col => {
          const fieldName = this.pluralise(col.table.name);
          modelFields[table.name][fieldName] = {
            type: new graphql.GraphQLList(modelTypes[col.table.name]),
            args: { where: { type: whereTypes[col.table.name] }, ...QueryOptions },
            resolve(object, args, context) {
              if (args.where) {
                args.where[col.name] = object[column.name];
                return context.loader.query(col.table, args);
              } else {
                return context.loader.load(col, object[column.name]);
              }
            },
          };
          for (const op of ['exists', 'not_exists']) {
            const fieldName = col.table.name + '__' + op;
            whereFields[table.name][fieldName] = { type: whereTypes[col.table.name] };
          }
        });
      }
    }

    const queryFields = {};

    for (const table of this.db.tables) {
      const name = this.pluralise(table.name);
      queryFields[name] = {
        type: new graphql.GraphQLList(modelTypes[table.name]),
        args: { where: { type: whereTypes[table.name] }, ...QueryOptions },
        resolve(_, args, context) {
          return context.loader.query(table, args);
        },
      };
      queryFields[table.name] = {
        type: modelTypes[table.name],
        args: { where: { type: whereTypes[table.name] }, ...uniqueFields[table.name] },
        resolve(_, args, context) {
          return new Promise(resolve => {
            context.loader.query(table, args).then(rows => {
              resolve(rows[0]);
            });
          });
        },
      };
    }

    const schema = new graphql.GraphQLSchema({
      query: new graphql.GraphQLObjectType({
        name: 'Query',
        fields: queryFields,
      }),
    });

    return schema;
  }

  pluralise(s) {
    return this.options.plural[s] || s + 's';
  }
}

function getType(type) {
  if (/char|text/i.test(type)) {
    return graphql.GraphQLString;
  }

  if (/^int/i.test(type)) {
    return graphql.GraphQLInt;
  }

  if (/float|double/i.test(type)) {
    return graphql.GraphQLFloat;
  }

  if (/^bool/i.test(type)) {
    return graphql.GraphQLBoolean;
  }

  return graphql.GraphQLString;
}

module.exports = { Builder };
