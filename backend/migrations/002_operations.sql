create table suppliers (
  id serial primary key,
  name text not null unique,
  phone text,
  address text
);

create table purchase_orders (
  id serial primary key,
  supplier_id integer not null references suppliers(id),
  status text not null default 'ordered' check (status in ('ordered','received','cancelled')),
  note text,
  created_by integer not null references users(id),
  created_at timestamptz not null default now(),
  received_at timestamptz
);

create table purchase_order_items (
  id serial primary key,
  purchase_order_id integer not null references purchase_orders(id) on delete cascade,
  ingredient_id integer not null references ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost integer not null check (unit_cost >= 0)
);

create table stock_opnames (
  id serial primary key,
  note text,
  created_by integer not null references users(id),
  created_at timestamptz not null default now()
);

create table stock_opname_items (
  id serial primary key,
  opname_id integer not null references stock_opnames(id) on delete cascade,
  ingredient_id integer not null references ingredients(id),
  system_qty numeric(14,3) not null,
  counted_qty numeric(14,3) not null check (counted_qty >= 0)
);

create table waste_logs (
  id serial primary key,
  ingredient_id integer not null references ingredients(id),
  quantity numeric(14,3) not null check (quantity > 0),
  reason text not null check (reason in ('kedaluwarsa','rusak','tumpah','lainnya')),
  note text,
  created_by integer not null references users(id),
  created_at timestamptz not null default now()
);

create table audit_logs (
  id bigserial primary key,
  user_id integer references users(id),
  action text not null,
  entity text not null,
  entity_id integer,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_entity on audit_logs (entity, entity_id);