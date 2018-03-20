import {
  Schema,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from '../src/model';

const data = getExampleData();

test('schema properties', () => {
  const schema = new Schema(data);
  expect(schema.database).toBe(data);
  expect(schema.models.length).toBe(data.tables.length);
  expect(schema.model('User').schema).toBe(schema);
});

test('default model names', () => {
  const schema = new Schema(data);
  expect(schema.model('User')).toBe(schema.model('user'));
  expect(schema.model('product_category').name).toBe('ProductCategory');
  expect(schema.model('product_category').pluralName).toBe('productCategories');
});

test('custmise model names', () => {
  const options = {
    models: [
      {
        table: 'delivery_address',
        name: 'Address',
        pluralName: 'Addresses'
      }
    ]
  };
  const schema = new Schema(data, options);
  expect(schema.model('delivery_address')).toBe(schema.model('Address'));
  expect(schema.model('Address').pluralName).toBe('Addresses');
});

function getTable(data: any, name: string): any {
  return data.tables.find(table => table.name === name);
}

test('simple fields', () => {
  const schema = new Schema(data);
  const model = schema.model('user');
  expect(model.field('first_name').name).toBe('firstName');
  expect(model.field('first_name')).toBe(model.field('firstName'));
  const field = model.field('id') as SimpleField;
  expect(field.model).toBe(model);
  expect(field.column.autoIncrement).toBe(true);
  expect(field.column.nullable).toBe(false);
});

test('foreign key fields', () => {
  const options = {
    models: [
      {
        table: 'order',
        fields: [
          {
            column: 'user_id',
            name: 'buyer'
          }
        ]
      }
    ]
  };
  const schema = new Schema(data, options);
  const model = schema.model('order');
  const address = model.field('delivery_address_id') as ForeignKeyField;
  expect(model.field('deliveryAddress')).toBe(address);
  expect(address.referencedField.model).toBe(schema.model('delivery_address'));
  expect(address.referencedField.column.name).toBe('id');
  const buyer = model.field('buyer') as ForeignKeyField;
  expect(buyer).toBe(model.field('user_id'));
  expect(model.field('user')).toBe(undefined);
  expect(buyer.referencedField.model).toBe(schema.model('user'));
});

test('related fields', () => {
  const options = {
    models: [
      {
        table: 'order_item',
        fields: [
          {
            column: 'order_id',
            relatedName: 'items'
          }
        ]
      },
      {
        table: 'category',
        fields: [
          {
            column: 'parent_id',
            name: 'parentCategory',
            relatedName: 'childCategories'
          }
        ]
      }
    ]
  };
  const schema = new Schema(data, options);
  const orderModel = schema.model('order');
  const userOrders = schema.model('user').field('orders') as RelatedField;
  expect(userOrders.referencingField.model).toBe(orderModel);
  const orderItems = orderModel.field('items') as RelatedField;
  expect(orderItems.referencingField.model).toBe(schema.model('order_item'));
  const categoryModel = schema.model('category');
  const parentField = categoryModel.field('parentCategory') as ForeignKeyField;
  expect(parentField.referencedField.model).toBe(categoryModel);
  const childField = categoryModel.field('childCategories') as RelatedField;
  expect(childField.referencingField.model).toBe(parentField.model);
  const productCategoryField = categoryModel.field('productCategories');
  expect(productCategoryField.model).toBe(categoryModel);
  expect((productCategoryField as RelatedField).referencingField.model).toBe(
    schema.model('ProductCategory')
  );
});

test('through fields', () => {
  const options = {
    models: [
      {
        table: 'product_category',
        fields: [
          {
            column: 'category_id',
            throughField: 'product_id'
          },
          {
            column: 'product_id',
            throughField: 'category_id',
            relatedName: 'categorySet'
          }
        ]
      }
    ]
  };
  const schema = new Schema(data, options);
  const categoryModel = schema.model('Category');
  expect(categoryModel.fields.length).toBe(5);
  const products = categoryModel.field('products') as RelatedField;
  expect(products.referencingField.model.name).toBe('ProductCategory');
  expect(products.throughField.referencedField.model.name).toBe('Product');
  const productModel = schema.model('product');
  const categories = productModel.field('categorySet') as RelatedField;
  expect(categories.referencingField.model.name).toBe('ProductCategory');
  expect(categories.throughField.referencedField.model.name).toBe('Category');
  expect(productModel.field('categories')).toBe(undefined);
});

test('unique keys', () => {
  const schema = new Schema(data);
  const model = schema.model('Category');
  expect(model.uniqueKeys.length).toBe(2);
  const primaryKey = model.uniqueKeys.find(key => key.fields.length === 1);
  expect(primaryKey.primary).toBe(true);
  expect(primaryKey.fields[0].model).toBe(model);
  expect(primaryKey.fields[0].name).toBe('id');
  const uniqueKey = model.uniqueKeys.find(key => key.fields.length === 2);
  expect(uniqueKey.primary).toBe(false);
  expect(uniqueKey.fields[0] instanceof ForeignKeyField).toBe(true);
  expect(uniqueKey.fields[1].name).toBe('name');
});

function getExampleData() {
  const fileName = require('path').join(
    __dirname,
    '..',
    'example',
    'data',
    'schema.json'
  );
  return JSON.parse(
    require('fs')
      .readFileSync(fileName)
      .toString()
  );
}
