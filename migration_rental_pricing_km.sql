-- ============================================================
-- migration_rental_pricing_km.sql
-- Аддитивно: цена за день, доп.плата, пробег при выдаче/возврате.
-- Существующие аренды получают NULL — итог (amount) у них остаётся как был.
-- Запускать в Supabase SQL Editor.
-- ============================================================
begin;

alter table public.rentals add column if not exists daily_price integer;  -- цена за 1 день (в копейках ×100)
alter table public.rentals add column if not exists extra_fee   integer;  -- доп.плата: детское кресло и т.п. (×100)
alter table public.rentals add column if not exists extra_note  text;     -- что за доп.плата (описание)
alter table public.rentals add column if not exists km_out      integer;  -- пробег при выдаче
alter table public.rentals add column if not exists km_in       integer;  -- пробег при возврате

commit;
