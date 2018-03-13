insert into user (id, name, email, status) values
  (1, 'alice', 'alice@example.com', 1),
  (2, 'bob', 'bob@example.com', 0),
  (3, 'grace', 'grace@example.com', 1);
insert into shop (id, name, status) values
  (1, 'Alice Fruit', 1),
  (2, 'Bob Meat', 0);
insert into role (id, name) values
  (1, 'ADMIN'),
  (2, 'STAFF');
insert into shop_user (shop_id, user_id, role_id, start_from, end_by) values
  (1, 1, 1, '2018-3-1', '2019-3-1'),
  (1, 2, 2, '2018-5-1', '2019-3-1'),
  (2, 1, 2, '2018-5-1', '2019-3-1'),
  (2, 2, 1, '2018-3-1', '2019-3-1');
insert into product (id, sku, name, shop_id, price, status) values
  (1, 'sku001', 'Australian Apple',  1, 5, 1),
  (2, 'sku002', 'Australian Banana', 1, 6, 1),
  (3, 'sku003', 'American Apple',    1, 7, 1),
  (4, 'sku004', 'American Banana',   1, 8, 0),
  (5, 'sku005', 'Australian Beef',   2, 15, 1),
  (6, 'sku006', 'Australian Lamb',   2, 16, 1),
  (7, 'sku007', 'American Beef',     2, 17, 1),
  (8, 'sku008', 'American Lamb',     2, 18, 1);
insert into `order` (id, code, `date`, user_id, status) values
  (1, 'order-1', '2018-3-20', 3, 1),
  (2, 'order-2', '2018-3-21', 3, 1);
insert into order_item (order_id, product_id, quantity) values
  (1, 1, 2), -- 2 kg of australian apple
  (1, 3, 1), -- 1 kg of american banana
  (2, 2, 2), -- 2 kg of australian banana
  (2, 1, 1), -- 1 kg of australian apple
  (2, 7, 2); -- 2 kg of american beef

