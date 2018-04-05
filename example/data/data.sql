insert into user (id, email, first_name, last_name, status) values
  (1, 'alice@example.com', 'Alice', 'Green', 1),
  (2, 'bob@example.com', 'Bob', 'Brown', 0),
  (3, 'grace@example.com', 'Grace', 'White', 1);
insert into `group`(id, name) values
  (1, 'ADMIN'),
  (2, 'STAFF');
insert into user_group(group_id, user_id) values
  (1, 1),
  (1, 2),
  (2, 2);
insert into category(id, parent_id, name) values
  (1, NULL, 'All'),
  (2, 1, 'Fruit'),
  (3, 2, 'Apple'),
  (4, 2, 'Banana'),
  (5, 1, 'Meat' ),
  (6, 5, 'Beef' ),
  (7, 5, 'Lamb' );
insert into product (id, sku, name, price, status) values
  (1, 'sku001', 'Australian Apple',  5, 1),
  (2, 'sku002', 'Australian Banana', 6, 1),
  (3, 'sku003', 'American Apple',    7, 1),
  (4, 'sku004', 'American Banana',   8, 0),
  (5, 'sku005', 'Australian Beef',   15, 1),
  (6, 'sku006', 'Australian Lamb',   16, 1),
  (7, 'sku007', 'American Beef',     17, 1),
  (8, 'sku008', 'American Lamb',     18, 1);
insert into product_category(product_id, category_id) values
  (1, 3),
  (2, 4),
  (3, 3),
  (4, 4),
  (5, 5),
  (6, 6),
  (7, 5),
  (8, 6);
insert into delivery_address (id, street_address, city, state, country, postal_code) values
  (1, '1 King William Street', 'Adelaide', 'South Australia', 'Australia', '5000'),
  (2, '2 King William Street', 'Adelaide', 'South Australia', 'Australia', '5000');
insert into `order` (id, code, date_created, user_id, delivery_address_id, status) values
  (1, 'order-1', '2018-3-20', 3, 1, 1),
  (2, 'order-2', '2018-3-21', 3, 2, 1);
insert into order_item (order_id, product_id, quantity) values
  (1, 1, 2), -- 2 kg of australian apple
  (1, 3, 1), -- 1 kg of american apple
  (2, 2, 2), -- 2 kg of australian banana
  (2, 1, 1), -- 1 kg of australian apple
  (2, 7, 2); -- 2 kg of american beef
insert into order_shipping(order_id, status) values
  (1, 1),
  (2, 2);
