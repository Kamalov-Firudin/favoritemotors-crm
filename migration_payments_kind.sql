-- ============================================================
-- FavoriteMotors CRM — миграция: категория платежа (kind)
-- Зачем: платёж может быть НЕ за аренду (возмещение ремонта, штраф, прочее).
-- Такие деньги не должны падать в долг клиента и в «арендную» кассу.
-- kind — стабильный ASCII-ключ; человекочитаемые подписи живут в коде.
--   rental  — оплата аренды (по умолчанию; идёт в долг клиента)
--   damage  — возмещение повреждения/ремонта
--   fine    — штраф (ПДД и т.п.)
--   other   — прочий приход
-- Применять в Supabase SQL Editor. Вся миграция в одной транзакции.
-- Идемпотентна: повторный запуск ничего не ломает.
-- ============================================================

begin;

-- 1) Колонка kind. NOT NULL с дефолтом 'rental' → существующие строки
--    автоматически получают 'rental' (все текущие платежи — арендные).
alter table public.payments
  add column if not exists kind text not null default 'rental';

-- 2) Страховка: если колонка уже была и где-то NULL — привести к 'rental'.
update public.payments set kind = 'rental' where kind is null;

-- 3) Ограничение допустимых значений (отдельно, идемпотентно).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'payments_kind_check'
  ) then
    alter table public.payments
      add constraint payments_kind_check
      check (kind in ('rental', 'damage', 'fine', 'other'));
  end if;
end $$;

-- 4) Индекс для кассовых выборок по категории.
create index if not exists idx_payments_kind on public.payments (kind);

commit;

-- ============================================================
-- ПРОВЕРКА ПОСЛЕ ПРИМЕНЕНИЯ:
--   1) у всех платежей есть kind, пустых нет:
--      select kind, count(*) from public.payments group by kind order by kind;
--      -- ожидается: rental = <все текущие>, остальных категорий пока 0
--   2) долги клиентов не сдвинулись: rentals.paid = сумме kind='rental'
--      (после деплоя кода recalc считает только 'rental'; сейчас все и есть 'rental').
-- ============================================================
