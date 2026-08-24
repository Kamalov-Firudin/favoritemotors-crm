-- ============================================================
-- FavoriteMotors CRM — миграция: корзина для платежей (soft-delete)
-- Зачем: раньше платёж мог удалить только admin, и удаление было ФИЗИЧЕСКИМ
-- (без восстановления). Теперь платежи ведут себя как всё остальное в системе:
--   staff  — прячет платёж в корзину (deleted_at) и восстанавливает
--   admin  — плюс удаляет навсегда (физически)
-- RLS уже подходит из migration_payments_cash.sql:
--   UPDATE = admin+staff  → soft-delete/restore (ставим/снимаем deleted_at)
--   DELETE = admin        → удаление навсегда (purge)
-- Поэтому здесь только добавляем колонку и индекс. Менять политики не нужно.
-- Применять в Supabase SQL Editor. Идемпотентна (add column if not exists).
-- ============================================================

begin;

-- deleted_at: NULL = живой платёж, timestamptz = скрыт в корзину.
-- Существующие строки = NULL = не удалены (аддитивно, ничего не ломает).
alter table public.payments add column if not exists deleted_at timestamptz;

-- частичный индекс: быстрые выборки живых платежей по аренде
create index if not exists idx_payments_active on public.payments (rental_id) where deleted_at is null;

commit;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ:
--   1) колонка появилась:
--      select column_name from information_schema.columns
--      where table_schema='public' and table_name='payments' and column_name='deleted_at';
--   2) политики на месте (upd = admin+staff, del = admin):
--      select policyname, cmd from pg_policies
--      where schemaname='public' and tablename='payments' order by policyname;
-- ============================================================
