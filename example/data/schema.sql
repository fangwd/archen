create table user (
  id integer primary key auto_increment,
  name varchar(60),
  email varchar(200) unique,
  status int
);

create table `group` (
  id integer primary key auto_increment,
  name varchar(200) unique
);

create table user_group (
  id integer primary key auto_increment,
  user_id integer,
  group_id integer,
  date_added datetime default current_timestamp,
  unique (user_id, group_id),
  foreign key (user_id) references user(id),
  foreign key (group_id) references `group`(id)
);

create table category (
  id integer primary key auto_increment,
  name varchar(200),
  parent_id integer default null,
  foreign key (parent_id) references category(id),
  unique (parent_id, name)
);

create table product (
  id integer primary key auto_increment,
  sku char(40) unique,
  name char(200),
  price float,
  status int
);

create table product_category (
  id integer primary key auto_increment,
  product_id integer,
  category_id integer,
  unique (product_id, category_id)
);

create table `order` (
  id integer primary key auto_increment,
  code char(40) unique,
  date_created datetime default current_timestamp,
  user_id integer default null,
  status int,
  foreign key (user_id) references user(id)
);

create table order_item (
  id integer primary key auto_increment,
  order_id integer,
  product_id integer,
  quantity float,
  constraint order_product unique (order_id, product_id),
  foreign key (order_id) references `order`(id),
  foreign key (product_id) references product(id)
);

