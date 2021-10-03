import { Schema } from 'sqlex/dist/schema';
import { Database } from 'sqlex/dist/types/database';
import { buildGraphQLSchema } from '../src/schema';
import * as helper from './helper';

const schemaInfo = helper.getExampleData() as Database;
const MODEL_QUERY_FIELDS_COUNT = 3;

describe('queries', () => {
  test('default', () => {
    const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo));
    expect(Object.keys(queryFields).length).toBe(
      MODEL_QUERY_FIELDS_COUNT * schemaInfo.tables.length
    );
  });

  test('export one', () => {
    const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
      allowAll: false,
      models: { User: true },
    });
    expect(Object.keys(queryFields).length).toBe(MODEL_QUERY_FIELDS_COUNT);
  });

  test('export two', () => {
    const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
      allowAll: false,
      models: { Product: true, Category: { select: true } },
    });
    expect(Object.keys(queryFields).length).toBe(MODEL_QUERY_FIELDS_COUNT * 2);
  });

  test('empty config objects', () => {
    {
      const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: { User: true, Product: {} },
      });
      expect(Object.keys(queryFields).length).toBe(MODEL_QUERY_FIELDS_COUNT);
    }
    {
      const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: true,
        models: { User: true, Product: {} },
      });
      expect(Object.keys(queryFields).length).toBe(
        MODEL_QUERY_FIELDS_COUNT * (schemaInfo.tables.length - 1)
      );
    }
  });

  test('custom type names', () => {
    const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
      models: {
        Product: { select: { single: 'productX', multiple: 'productXX' } },
      },
    });
    expect(Object.keys(queryFields).length).toBe(
      MODEL_QUERY_FIELDS_COUNT * schemaInfo.tables.length
    );
    expect('products' in queryFields).toBe(false);
    expect('product' in queryFields).toBe(false);
    expect('productX' in queryFields).toBe(true);
    expect('productXX' in queryFields).toBe(true);
    expect('productXXConnection' in queryFields).toBe(true);
  });

  test('forbid query multiple rows', () => {
    const { queryFields } = buildGraphQLSchema(new Schema(schemaInfo), {
      models: { Product: { select: { single: 'productX', multiple: '' } } },
    });
    expect(Object.keys(queryFields).length).toBe(
      MODEL_QUERY_FIELDS_COUNT * schemaInfo.tables.length - 2
    );
    expect('products' in queryFields).toBe(false);
    expect('product' in queryFields).toBe(false);
    expect('productX' in queryFields).toBe(true);
    expect('productConnection' in queryFields).toBe(false);
  });
});

describe('mutations', () => {
  test('create', () => {
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { create: false },
          Product: { create: 'createFancyProduct' },
        },
      });
      expect('createUser' in mutationFields).toBe(false);
      expect('createProduct' in mutationFields).toBe(false);
      expect('createFancyProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: true,
        models: { User: { create: false } },
      });
      expect('createUser' in mutationFields).toBe(false);
      expect('createProduct' in mutationFields).toBe(true);
    }
  });

  test('update', () => {
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { update: false },
          Product: { update: 'updateFancyProduct' },
        },
      });
      expect('updateUser' in mutationFields).toBe(false);
      expect('updateProduct' in mutationFields).toBe(false);
      expect('updateFancyProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: true,
        models: { User: { update: false } },
      });
      expect('updateUser' in mutationFields).toBe(false);
      expect('updateProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { update: false },
          Product: {
            update: {
              single: 'updateFancyProduct',
              multiple: 'updateLotsOfProducts',
            },
          },
        },
      });
      expect('updateUser' in mutationFields).toBe(false);
      expect('updateProduct' in mutationFields).toBe(false);
      expect('updateFancyProduct' in mutationFields).toBe(true);
      expect('updateLotsOfProducts' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { update: false },
          Product: {
            update: {
              single: 'updateFancyProduct',
              multiple: '',
            },
          },
        },
      });
      expect('updateUser' in mutationFields).toBe(false);
      expect('updateProduct' in mutationFields).toBe(false);
      expect('updateProducts' in mutationFields).toBe(false);
      expect('updateFancyProduct' in mutationFields).toBe(true);
    }
  });

  test('upsert', () => {
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { upsert: false },
          Product: { upsert: 'upsertFancyProduct' },
        },
      });
      expect('upsertUser' in mutationFields).toBe(false);
      expect('upsertProduct' in mutationFields).toBe(false);
      expect('upsertFancyProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: true,
        models: { User: { upsert: false } },
      });
      expect('upsertUser' in mutationFields).toBe(false);
      expect('upsertProduct' in mutationFields).toBe(true);
    }
  });

  test('delete', () => {
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { delete: false },
          Product: { delete: 'deleteFancyProduct' },
        },
      });
      expect('deleteUser' in mutationFields).toBe(false);
      expect('deleteProduct' in mutationFields).toBe(false);
      expect('deleteFancyProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: true,
        models: { User: { delete: false } },
      });
      expect('deleteUser' in mutationFields).toBe(false);
      expect('deleteProduct' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { delete: false },
          Product: {
            delete: {
              single: 'deleteFancyProduct',
              multiple: 'deleteLotsOfProducts',
            },
          },
        },
      });
      expect('deleteUser' in mutationFields).toBe(false);
      expect('deleteProduct' in mutationFields).toBe(false);
      expect('deleteFancyProduct' in mutationFields).toBe(true);
      expect('deleteLotsOfProducts' in mutationFields).toBe(true);
    }
    {
      const { mutationFields } = buildGraphQLSchema(new Schema(schemaInfo), {
        allowAll: false,
        models: {
          User: { delete: false },
          Product: {
            delete: {
              single: 'deleteFancyProduct',
              multiple: '',
            },
          },
        },
      });
      expect('deleteUser' in mutationFields).toBe(false);
      expect('deleteProduct' in mutationFields).toBe(false);
      expect('deleteProducts' in mutationFields).toBe(false);
      expect('deleteFancyProduct' in mutationFields).toBe(true);
    }
  });
});
