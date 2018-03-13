create table user (
  id integer primary key,
  name varchar(60),
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
  user_id integer,
  shop_id integer,
  role_id integer,
  start_from datetime,
  end_by datetime,
  status int,
  unique (shop_id, user_id),
  foreign key (user_id) references user(id),
  foreign key (shop_id) references shop(id),
  foreign key (role_id) references role(id)
);

create table product (
  id integer primary key,
  sku char(40) unique,
  name char(200),
  shop_id integer,
  price float,
  status int,
  foreign key (shop_id) references shop(id)
);

create table `order` (
  id integer primary key,
  code char(40) unique,
  `date` datetime default current_timestamp,
  user_id integer default null,
  status int,
  foreign key (user_id) references user(id)
);

create table order_item (
  id integer primary key,
  order_id integer,
  product_id integer,
  quantity float,
  constraint order_product unique (order_id, product_id),
  foreign key (order_id) references `order`(id),
  foreign key (product_id) references product(id)
);

