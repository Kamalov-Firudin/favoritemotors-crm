-- ============================================================
-- FavoriteMotors CRM — миграция v2: soft-delete + целостность + RLS под 3 роли
-- Роли: admin (всё), staff (создаёт/правит/прячет/восстанавливает, НЕ удаляет физически),
--       viewer (только чтение — инвестор).
-- Машины прячутся штатным status='hidden' (их «корзина»), deleted_at им НЕ нужен.
-- deleted_at добавляется клиентам / арендам / расходам.
-- Применять в Supabase SQL Editor (он не подчиняется этим RLS — сам себя не заблокируешь).
-- Вся миграция в одной транзакции: при любой ошибке ничего не применится.
-- ============================================================

begin;

-- ── 1) SOFT-DELETE: колонки (аддитивно; существующие строки = NULL = не удалены) ──
alter table public.clients          add column if not exists deleted_at timestamptz;
alter table public.rentals          add column if not exists deleted_at timestamptz;
alter table public.car_expenses     add column if not exists deleted_at timestamptz;
alter table public.office_expenses  add column if not exists deleted_at timestamptz;
-- cars  → прячутся через status='hidden' (без deleted_at)
-- maintenance, audit_log, profiles → soft-delete не нужен

create index if not exists idx_clients_active        on public.clients (id)         where deleted_at is null;
create index if not exists idx_rentals_active         on public.rentals (id)         where deleted_at is null;
create index if not exists idx_car_expenses_active    on public.car_expenses (id)    where deleted_at is null;
create index if not exists idx_office_expenses_active on public.office_expenses (id) where deleted_at is null;

-- ── 2) ЦЕЛОСТНОСТЬ: нельзя скрыть клиента с живой историей (есть не-удалённые аренды) ──
create or replace function public.block_hide_client_with_history()
returns trigger language plpgsql as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    if exists (select 1 from public.rentals r
               where r.client_id = new.id and r.deleted_at is null) then
      raise exception 'Нельзя скрыть клиента: на нём есть аренды в истории.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_block_hide_clients on public.clients;
create trigger trg_block_hide_clients before update on public.clients
  for each row execute function public.block_hide_client_with_history();

-- ── 3) ФУНКЦИЯ РОЛИ (security definer — без рекурсии RLS) ──
create or replace function public.current_user_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;
revoke all on function public.current_user_role() from public;
grant execute on function public.current_user_role() to authenticated;

-- ── 4) разрешить значение 'viewer' в profiles.role ──
alter table public.profiles drop constraint if exists profiles_role_check;

-- ── 5) включить RLS на всех таблицах ──
alter table public.cars            enable row level security;
alter table public.clients         enable row level security;
alter table public.rentals         enable row level security;
alter table public.car_expenses    enable row level security;
alter table public.office_expenses enable row level security;
alter table public.maintenance     enable row level security;
alter table public.audit_log       enable row level security;
alter table public.profiles        enable row level security;

-- ── 6) снести ВСЕ старые политики (в т.ч. «authenticated всё можно») ──
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname
           from pg_policies where schemaname='public' loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- ── 7) операционные таблицы:
--       SELECT = все 3 роли | INSERT/UPDATE = admin+staff | DELETE = только admin ──
do $$
declare t text;
begin
  foreach t in array array['cars','clients','rentals','car_expenses','office_expenses','maintenance'] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.current_user_role() in (''admin'',''staff'',''viewer''))', t||'_sel', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.current_user_role() in (''admin'',''staff''))', t||'_ins', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.current_user_role() in (''admin'',''staff'')) with check (public.current_user_role() in (''admin'',''staff''))', t||'_upd', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.current_user_role() = ''admin'')', t||'_del', t);
  end loop;
end $$;

-- ── 8) журнал: SELECT = все | INSERT = admin+staff | DELETE = admin ──
create policy audit_sel on public.audit_log for select to authenticated
  using (public.current_user_role() in ('admin','staff','viewer'));
create policy audit_ins on public.audit_log for insert to authenticated
  with check (public.current_user_role() in ('admin','staff'));
create policy audit_del on public.audit_log for delete to authenticated
  using (public.current_user_role() = 'admin');

-- ── 9) профили: видишь свой; админ видит и правит все ──
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or public.current_user_role() = 'admin');
create policy profiles_admin on public.profiles for all to authenticated
  using (public.current_user_role() = 'admin')
  with check (public.current_user_role() = 'admin');

commit;

-- ============================================================
-- ЕСЛИ УЖЕ ЗАПУСКАЛ v1 (где cars.deleted_at): почистить лишнее —
--   drop trigger if exists trg_block_hide_cars on public.cars;
--   alter table public.cars drop column if exists deleted_at;
--
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ — твой email должен быть admin:
--   select p.role, u.email from public.profiles p
--   join auth.users u on u.id = p.id;
-- Если нет:
--   update public.profiles set role='admin'
--   where id = (select id from auth.users where email='kamalov.firudin@gmail.com');
-- ============================================================
