create table user (
  id integer primary key,
  email varchar(200) unique,
  status int
);

create table shop (
  id integer primary key,
  name varchar(200) unique,
  status int
);

create table role (
  id integer primary key,
  name varchar(60) unique
);

create table shop_user(
  id integer primary key,
  user_id integer references user(id),
  shop_id integer references shop(id),
  role_id integer references role(id),
  status int,
  unique (shop_id, user_id)
);

create table product (
  id integer primary key,
  sku char(40) unique,
  name char(200) unique,
  shop_id integer references shop(id),
  price float,
  status int
);

create table `order` (
  id integer primary key,
  code char(40) unique,
  `date` datetime default current_timestamp,
  user_id int default null references user(id),
  status int
);

create table order_item (
  id integer primary key,
  order_id integer references `order`(id),
  product_id int references product(id),
  quantity float,
  unique (order_id, product_id)
);

