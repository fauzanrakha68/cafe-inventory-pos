create table users (
  id serial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('admin','kasir','store_keeper')),
  created_at timestamptz not null default now()
);

create table ingredients (
  id serial primary key,
  name text not null unique,
  unit text not null check (unit in ('gram','ml','pcs')),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0)
);

create table menus (
  id serial primary key,
  name text not null unique,
  price integer not null check (price >= 0),
  active boolean not null default true
);

create table recipe_items (
  menu_id integer not null references menus(id) on delete cascade,
  ingredient_id integer not null references ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  primary key (menu_id, ingredient_id)
);

create table stock_batches (
  id serial primary key,
  ingredient_id integer not null references ingredients(id),
  initial_qty numeric(14,3) not null check (initial_qty > 0),
  remaining_qty numeric(14,3) not null check (remaining_qty >= 0),
  unit_cost integer not null check (unit_cost >= 0),
  expires_at date not null,
  received_at timestamptz not null default now()
);
create index idx_batches_fefo on stock_batches (ingredient_id, expires_at, id);

create table sales (
  id serial primary key,
  cashier_id integer not null references users(id),
  total integer not null check (total >= 0),
  created_at timestamptz not null default now()
);

create table sale_items (
  id serial primary key,
  sale_id integer not null references sales(id) on delete cascade,
  menu_id integer not null references menus(id),
  qty integer not null check (qty > 0),
  unit_price integer not null check (unit_price >= 0)
);

create table stock_movements (
  id bigserial primary key,
  ingredient_id integer not null references ingredients(id),
  batch_id integer references stock_batches(id),
  type text not null check (type in ('receive','sale','opname','waste')),
  qty_change numeric(14,3) not null,
  ref_type text,
  ref_id integer,
  created_by integer references users(id),
  created_at timestamptz not null default now()
);
create index idx_movements_ing on stock_movements (ingredient_id, created_at);