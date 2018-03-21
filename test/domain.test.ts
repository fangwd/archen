import {
  Domain,
  SimpleField,
  ForeignKeyField,
  RelatedField
} from '../src/domain';

const data = getExampleData();

test('domain properties', () => {
  const domain = new Domain(data);
  expect(domain.database).toBe(data);
  expect(domain.models.length).toBe(data.tables.length);
  expect(domain.model('User').domain).toBe(domain);
});

test('default model names', () => {
  const domain = new Domain(data);
  expect(domain.model('User')).toBe(domain.model('user'));
  expect(domain.model('product_category').name).toBe('ProductCategory');
  expect(domain.model('product_category').pluralName).toBe('productCategories');
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
  const domain = new Domain(data, options);
  expect(domain.model('delivery_address')).toBe(domain.model('Address'));
  expect(domain.model('Address').pluralName).toBe('Addresses');
});

function getTable(data: any, name: string): any {
  return data.tables.find(table => table.name === name);
}

test('simple fields', () => {
  const domain = new Domain(data);
  const model = domain.model('user');
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
  const domain = new Domain(data, options);
  const model = domain.model('order');
  const address = model.field('delivery_address_id') as ForeignKeyField;
  expect(model.field('deliveryAddress')).toBe(address);
  expect(address.referencedField.model).toBe(domain.model('delivery_address'));
  expect(address.referencedField.column.name).toBe('id');
  const buyer = model.field('buyer') as ForeignKeyField;
  expect(buyer).toBe(model.field('user_id'));
  expect(model.field('user')).toBe(undefined);
  expect(buyer.referencedField.model).toBe(domain.model('user'));
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
  const domain = new Domain(data, options);
  const orderModel = domain.model('order');
  const userOrders = domain.model('user').field('orders') as RelatedField;
  expect(userOrders.referencingField.model).toBe(orderModel);
  const orderItems = orderModel.field('items') as RelatedField;
  expect(orderItems.referencingField.model).toBe(domain.model('order_item'));
  const categoryModel = domain.model('category');
  const parentField = categoryModel.field('parentCategory') as ForeignKeyField;
  expect(parentField.referencedField.model).toBe(categoryModel);
  const childField = categoryModel.field('childCategories') as RelatedField;
  expect(childField.referencingField.model).toBe(parentField.model);
  const productCategoryField = categoryModel.field('productCategories');
  expect(productCategoryField.model).toBe(categoryModel);
  expect((productCategoryField as RelatedField).referencingField.model).toBe(
    domain.model('ProductCategory')
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
  const domain = new Domain(data, options);
  const categoryModel = domain.model('Category');
  expect(categoryModel.fields.length).toBe(5);
  const products = categoryModel.field('products') as RelatedField;
  expect(products.referencingField.model.name).toBe('ProductCategory');
  expect(products.throughField.referencedField.model.name).toBe('Product');
  const productModel = domain.model('product');
  const categories = productModel.field('categorySet') as RelatedField;
  expect(categories.referencingField.model.name).toBe('ProductCategory');
  expect(categories.throughField.referencedField.model.name).toBe('Category');
  expect(productModel.field('categories')).toBe(undefined);
});

test('unique keys', () => {
  const domain = new Domain(data);
  const model = domain.model('Category');
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

test('one to one relation', () => {
  const domain = new Domain(data);
  const orderModel = domain.model('Order');
  const shipping = orderModel.field('orderShipping') as RelatedField;
  expect(shipping.referencingField.unique).toBe(true);
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
