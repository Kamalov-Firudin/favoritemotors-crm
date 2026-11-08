# Выгрузка схемы базы (этап 0, шаг A)

Цель — получить **настоящую** схему рабочей базы: таблицы, колонки, типы, значения по умолчанию,
ключи, CHECK, внешние ключи (в т.ч. какие с `ON DELETE CASCADE`), индексы, функции, триггеры,
RLS-политики, права, последовательности. Без неё восстановление не считается проверенным.

Операция **только читает** базу. Пароль базы вводите сами, в чат его не присылайте.

## Установка клиента PostgreSQL (Windows)
1. Узнать версию сервера: Supabase → SQL Editor → `show server_version;` (например, `17.4`).
2. Скачать установщик той же основной версии: https://www.postgresql.org/download/windows/ (EDB).
3. В установщике отметить **только «Command Line Tools»** (сервер не нужен).
4. Проверка в новом окне `cmd`: `"C:\Program Files\PostgreSQL\17\bin\pg_dump" --version`.
   Версия `pg_dump` должна быть **не ниже** версии сервера.

## Строка подключения
Supabase → проект → **Connect** → **Session pooler** → URI. Выглядит так:
```
postgresql://postgres.kbtpdqsqhwfsohyibunn:[YOUR-PASSWORD]@aws-…pooler.supabase.com:5432/postgres
```
Удалите из неё `:[YOUR-PASSWORD]`. Тогда `pg_dump` сам спросит пароль и он не останется в истории команд.
Прямое подключение (`db.….supabase.co`) не используйте: оно работает только по IPv6.

## Выгрузка
```
cd /d D:\Works\WebCRM\fm-web
mkdir schema-dump
"C:\Program Files\PostgreSQL\17\bin\pg_dump" --schema-only --schema=public --no-owner -f schema-dump\schema_public.sql "postgresql://postgres.kbtpdqsqhwfsohyibunn@aws-…pooler.supabase.com:5432/postgres"
```
Папку `schema-dump/` не коммитить (она в `.gitignore`).

## Проверка, что дамп полный
Открыть `schema_public.sql` и убедиться, что есть:
```
findstr /C:"CREATE TABLE public." schema-dump\schema_public.sql
findstr /C:"CREATE POLICY" schema-dump\schema_public.sql
findstr /C:"CREATE TRIGGER" schema-dump\schema_public.sql
findstr /C:"CREATE FUNCTION" schema-dump\schema_public.sql
findstr /C:"FOREIGN KEY" schema-dump\schema_public.sql
```
Ожидается минимум: 9 таблиц (`cars, clients, rentals, payments, car_expenses, office_expenses,
maintenance, audit_log, profiles`), политики по всем таблицам, триггер `trg_block_hide_clients`,
функции `current_user_role`, `block_hide_client_with_history`, `clear_must_change_password`.

**Ограничение:** схема `auth` (пользователи) — служебная, Supabase управляет ею сам. В дамп
она не входит намеренно. FK `profiles.id → auth.users` в дампе будет: это нормально.

## Что прислать Claude
Схема **не содержит** данных клиентов и паролей, поэтому её можно прислать файлом.
Перед отправкой проверьте поиском, что в файле нет слов `password`, `secret`, `key` в значениях
(в обычной схеме их нет). Если сомневаетесь — пришлите только вывод команд проверки выше.

## Инвентаризация пользователей (только чтение, результат НЕ присылать)
В SQL Editor рабочего проекта:
```sql
select count(*)                                             as users,
       count(distinct lower(btrim(email)))                  as unique_emails,
       count(*) filter (where email is null or email = '')  as without_email,
       count(*) filter (where banned_until > now())         as banned,
       count(*) filter (where deleted_at is not null)       as deleted
from auth.users;
select p.role, count(*) from public.profiles p group by p.role;
```
В чат можно прислать **только эти числа** (без email). Если `users ≠ unique_emails` или есть пользователи
без email, их нужно разобрать до переноса `profiles` (см. `RESTORE.md`, шаг 3).
