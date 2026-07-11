-- ============================================================
-- FavoriteMotors CRM — миграция: кассовый учёт (таблица платежей)
-- Зачем: `rentals.paid` — это ИТОГ без даты. Для кассы по месяцам нужна дата
-- каждого платежа (долг гасят частями через месяцы). Эта таблица хранит
-- каждый платёж с датой; `rentals.paid` остаётся кэшем итога для расчёта долга.
-- Применять в Supabase SQL Editor (он не подчиняется RLS — сам себя не заблокируешь).
-- Вся миграция в одной транзакции: при любой ошибке ничего не применится.
-- Идемпотентна: повторный запуск не создаёт дублей (backfill под guard'ом).
-- ============================================================

begin;

-- ── 1) ТАБЛИЦА ПЛАТЕЖЕЙ ─────────────────────────────────────
-- amount — в копейках (×100), как везде в проекте. currency дублируем с аренды
-- на момент платежа (аренда валюту не меняет, но так платёж самодостаточен).
-- Если FK ругнётся на тип rental_id — значит rentals.id = integer, поменяй bigint→integer.
create table if not exists public.payments (
  id         bigserial primary key,
  rental_id  bigint not null references public.rentals(id) on delete cascade,
  paid_at    date not null,
  amount     integer not null,
  currency   text not null,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_payments_paid_at on public.payments (paid_at);
create index if not exists idx_payments_rental  on public.payments (rental_id);

-- ── 2) BACKFILL: перенос существующих paid в один платёж на дату выдачи ──
-- Только живые (не удалённые) и не отменённые аренды с оплатой > 0.
-- Дата = issued_at (для истории приблизительно; дальше даты будут точными).
-- Guard: пропускаем аренды, у которых платежи уже есть — повторный запуск безопасен.
insert into public.payments (rental_id, paid_at, amount, currency)
select r.id, coalesce(r.issued_at, current_date), r.paid, coalesce(r.currency, 'TRY')
from public.rentals r
where coalesce(r.paid, 0) > 0
  and r.deleted_at is null
  and coalesce(r.status, '') <> 'cancelled'
  and not exists (select 1 from public.payments p where p.rental_id = r.id);

-- ── 3) RLS (по образцу migration_soft_delete_rls.sql) ──
--   SELECT = admin+staff+viewer | INSERT/UPDATE = admin+staff | DELETE = admin
alter table public.payments enable row level security;

drop policy if exists payments_sel on public.payments;
drop policy if exists payments_ins on public.payments;
drop policy if exists payments_upd on public.payments;
drop policy if exists payments_del on public.payments;

create policy payments_sel on public.payments for select to authenticated
  using (public.current_user_role() in ('admin','staff','viewer'));
create policy payments_ins on public.payments for insert to authenticated
  with check (public.current_user_role() in ('admin','staff'));
create policy payments_upd on public.payments for update to authenticated
  using (public.current_user_role() in ('admin','staff'))
  with check (public.current_user_role() in ('admin','staff'));
create policy payments_del on public.payments for delete to authenticated
  using (public.current_user_role() = 'admin');

commit;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ:
--   1) итог платежей должен совпасть с суммой paid по живым арендам:
--      select
--        (select coalesce(sum(amount),0) from public.payments) as ledger_total,
--        (select coalesce(sum(paid),0) from public.rentals
--           where deleted_at is null and coalesce(status,'')<>'cancelled') as rentals_paid;
--   2) платежей столько же, сколько оплаченных аренд:
--      select count(*) from public.payments;
-- ============================================================
