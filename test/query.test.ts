import { Domain } from '../src/domain';
import { buildQuery } from '../src/query-builder';
import knex = require('knex');
import helper = require('./helper');

const data = helper.getExampleData();
const domain = new Domain(data);

test('simple query', () => {
  const db = helper.createConnection();
  const model = domain.model('user');
  const args = {
    where: {
      email: 'me@archenjs.com',
      orders_some: {
        dateCreated: null,
        orderItems_none: {
          product: {
            name_like: '%junk%',
            stockQuantity_gt: 0
          }
        }
      }
    }
  };
  console.log(buildQuery(db, model, args).toString());
});
