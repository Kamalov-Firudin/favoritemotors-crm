-- ============================================================
-- migration_km_overage.sql
-- Лимит км в день и цена за 1 км перепробега (для расчёта доплаты при возврате).
-- Аддитивно, старые аренды получают NULL — у них перепробег не считается.
-- Запускать в Supabase SQL Editor.
-- ============================================================
begin;

alter table public.rentals add column if not exists km_limit      integer;  -- лимит км в день
alter table public.rentals add column if not exists over_km_price integer;  -- цена за 1 км перепробега (×100)

commit;
