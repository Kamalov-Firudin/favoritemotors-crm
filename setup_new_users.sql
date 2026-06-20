-- ============================================================
-- setup_new_users.sql — флаг «сменить пароль при первом входе» + два пользователя
-- Запускать в Supabase SQL Editor ПОСЛЕ migration_soft_delete_rls.sql
-- ============================================================

-- ── Часть 1. Схема (безопасно запускать когда угодно) ──
begin;

-- флаг обязательной смены пароля; для существующих (admin) = false
alter table public.profiles
  add column if not exists must_change_password boolean not null default false;

-- снять флаг можно только у самого себя и ТОЛЬКО этот флаг
-- (security definer обходит RLS, но трогает строку auth.uid() и одно поле —
--  поэтому сотрудник не может через это изменить свою роль)
create or replace function public.clear_must_change_password()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid();
$$;
revoke all on function public.clear_must_change_password() from public;
grant execute on function public.clear_must_change_password() to authenticated;

commit;

-- ============================================================
-- ── Часть 2. Два пользователя ──
-- СНАЧАЛА создай обоих в дашборде:
--   Authentication → Users → Add user → Create new user
--   • email + временный пароль + галочка «Auto Confirm User»
-- ПОТОМ выполни этот блок (роли + требование сменить пароль):
-- ============================================================

-- сотрудник → staff
insert into public.profiles (id, full_name, role, must_change_password)
select id, email, 'staff', true
from auth.users where email = '1987mah0912@gmail.com'
on conflict (id) do update set role = 'staff', must_change_password = true;

-- инвестор → viewer (только чтение)
insert into public.profiles (id, full_name, role, must_change_password)
select id, email, 'viewer', true
from auth.users where email = '7708775@gmail.com'
on conflict (id) do update set role = 'viewer', must_change_password = true;

-- проверка результата:
-- select u.email, p.role, p.must_change_password
-- from public.profiles p join auth.users u on u.id = p.id
-- where u.email in ('1987mah0912@gmail.com','7708775@gmail.com');
