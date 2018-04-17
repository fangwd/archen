create table user (
  id integer primary key auto_increment,
  email varchar(200) unique,
  first_name varchar(30),
  last_name varchar(100),
  status int
);

create table `post` (
  id integer primary key auto_increment,
  title varchar(100),
  body varchar(4096),
  user_id integer,
  date_added datetime default current_timestamp,
  foreign key (user_id) references user(id),
  unique (user_id, title)
);

create table `comment`(
  id integer primary key auto_increment,
  user_id integer,
  post_id integer,
  date_added datetime default current_timestamp,
  foreign key (user_id) references user(id),
  foreign key (post_id) references `post`(id)
);

