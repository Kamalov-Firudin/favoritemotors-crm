-- ============================================================
-- FavoriteMotors CRM — миграция: дата выдачи паспорта у клиента
-- Добавляет clients.passport_issued (date) по образцу license_issued.
-- Применять в Supabase SQL Editor ДО выкладки кода.
-- Идемпотентна: повторный запуск безопасен.
-- ============================================================
alter table public.clients
  add column if not exists passport_issued date;
