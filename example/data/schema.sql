create table user (
  id integer primary key auto_increment,
  email varchar(200) unique,
  first_name varchar(30),
  last_name varchar(100),
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
  stock_quantity float,
  status int
);

create table product_category (
  id integer primary key auto_increment,
  product_id integer,
  category_id integer,
  foreign key (product_id) references product(id),
  foreign key (category_id) references category(id),
  unique (product_id, category_id)
);

create table delivery_address (
  id integer primary key auto_increment,
  street_address varchar(100) NOT NULL,
  city varchar(30) NOT NULL,
  state varchar(30) NOT NULL,
  country varchar(30) NOT NULL,
  postal_code varchar(8) NOT NULL,
  unique (street_address, city, state, country)
);

create table `order` (
  id integer primary key auto_increment,
  code char(40) unique,
  date_created datetime default current_timestamp,
  user_id integer default null,
  delivery_address_id integer default null,
  status int,
  foreign key (delivery_address_id) references delivery_address(id),
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

