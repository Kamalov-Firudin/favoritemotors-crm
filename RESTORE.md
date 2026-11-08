# Восстановление базы FavoriteMotors CRM

> **Статус (08.11.2026, этап 0):** инструкция и скрипты проверены только локально, на схеме-заглушке.
> Пробное восстановление в тестовый проект Supabase ещё **не выполнено**. Пока оно не пройдено,
> считать инструкцию предварительной.

## Главные правила
1. **Восстанавливаем только в НОВЫЙ, пустой проект Supabase.** Рабочий проект `kbtpdqsqhwfsohyibunn`
   ни при каком сценарии не очищается и не перезаписывается. Скрипты сами останавливаются, если база не пустая.
2. **Никаких `TRUNCATE`, `DROP`, `session_replication_role`.** Старый скрипт из этого файла делал
   `TRUNCATE rentals … CASCADE` и стирал платежи. Он удалён.
3. Ключи, пароли и приватный ключ шифрования **не пересылать** в чат, в GitHub и в мессенджеры.
4. Файлы бэкапа содержат персональные данные клиентов. После теста удалить их с рабочего стола и из «Загрузок».

## Что есть в бэкапах
| Слой | Где | Что внутри | Для чего |
|---|---|---|---|
| **pg_dump** (основной) | Drive, `favoritemotors-pgdump-*.dump.age` | схема `public`: таблицы, ограничения, FK, индексы, функции, триггеры, RLS-политики, права + все данные | полное восстановление |
| **JSON** (дополнительный) | Drive, `favoritemotors-backup-*.json[.age]`; кнопка в CRM | данные 9 таблиц (`cars, clients, rentals, payments, car_expenses, office_expenses, maintenance, audit_log, profiles`) + `manifest` (строки, суммы денег, sha256) | просмотр, сверка, перенос `profiles`, запасной путь |

**Не входит ни в один слой:** пользователи Supabase Auth (`auth.users`, пароли), настройки проекта,
Storage. Пользователей заводим заново (шаг 3), пароли пользователи задают сами.

Бэкапы старого формата (до 08.11.2026) **не содержат `payments` и `profiles`**: платежи из них восстановить нельзя.

---

## Шаг 0. Подготовка (на своём компьютере)
- Клиент PostgreSQL той же основной версии, что и сервер Supabase (см. `docs/SCHEMA_DUMP.md`, раздел «Установка»).
- `age` — если бэкап зашифрован (`docs/ENCRYPTION.md`).
- Node.js 22 и папка проекта: `cd backup && npm install`.
- Новый проект Supabase: supabase.com → New Project → регион Central EU (Frankfurt).
  Строка подключения: **Connect → Session pooler → URI** (порт 5432). Пароль вводите, когда спросит, а не вставляйте в команду.

## Шаг 1. Расшифровать файлы (если `.age`)
```
age -d -i путь\к\fm-backup-key.txt favoritemotors-pgdump-ДАТА.dump.age > db.dump
age -d -i путь\к\fm-backup-key.txt favoritemotors-backup-ДАТА.json.age > backup.json
```

## Шаг 2. Самопроверка JSON-файла и генерация SQL
```
cd backup
node restore-json.mjs backup.json --out restore-out --old-users old_users.csv
```
- Скрипт сверяет `manifest` с содержимым. Если sha256 не совпал — файл повреждён, **не продолжать**.
- `old_users.csv` (`id,email` старых пользователей) — см. шаг 3. Файл не коммитить, после теста удалить.
- Получится: `01_restore_data.sql`, `02_map_profiles.sql`, `03_verify.sql`, `report.txt`.

## Шаг 3. Пользователи (Auth)
1. В **рабочем** проекте, SQL Editor (только чтение):
   ```sql
   select id, email from auth.users order by email;
   ```
   Download CSV → сохранить как `old_users.csv` (колонки `id,email`). Проверить: email у всех есть, без дублей.
2. В **тестовом** проекте: Authentication → Users → Add user → Create new user, на те же email
   (временный пароль, галочка Auto Confirm). UUID будут **новые**, это нормально.

---

## Путь A (основной): pg_dump → pg_restore
1. Список объектов без данных `profiles` (их FK указывает на старые UUID пользователей):
   ```
   pg_restore --list db.dump | findstr /V /C:"TABLE DATA public profiles" > restore.list
   ```
   (macOS/Linux: `grep -v 'TABLE DATA public profiles'`.)
2. Восстановить:
   ```
   pg_restore --no-owner -L restore.list -d "СТРОКА_SESSION_POOLER_ТЕСТОВОГО_ПРОЕКТА" db.dump
   ```
   Ожидаемая безвредная ошибка: `schema "public" already exists`. **Любые другие ошибки записать в отчёт.**
3. Перенести `profiles` на новые UUID:
   ```
   node restore-json.mjs backup.json --profiles-only --out restore-profiles --old-users old_users.csv
   ```
   В SQL Editor тестового проекта выполнить `restore-profiles/01_restore_data.sql`,
   затем `02_map_profiles.sql` **по шагам** (см. комментарии в файле: проверки → таблица соответствия → перенос → проверка FK).
4. Сверка: `restore-profiles/03_verify.sql`. Все строки должны иметь `ok = true`.
   Делайте JSON-бэкап и pg_dump подряд, иначе данные между ними могли измениться и сверка покажет разницу.

## Путь B (запасной): схема + JSON
Использовать, если pg_dump недоступен.
1. Применить схему, выгруженную по `docs/SCHEMA_DUMP.md`:
   `psql "СТРОКА_ТЕСТОВОГО_ПРОЕКТА" -f schema_public.sql`.
2. SQL Editor → выполнить `restore-out/01_restore_data.sql` (одна транзакция; при непустой базе остановится сам).
3. `restore-out/02_map_profiles.sql` — по шагам.
4. `restore-out/03_verify.sql` — все `ok = true`.

## Шаг 4. Проверка, что всё работает (обязательно)
- [ ] `03_verify.sql`: все строки `ok = true` (количества и суммы денег по каждой валюте, включая `payments`).
- [ ] `02_map_profiles.sql`, шаг 2: таблица `old_user_id → new_user_id` сохранена в отчёт; шаг 4 вернул 0 строк.
- [ ] Вход в тестовую копию CRM под каждой тестовой учётной записью: админ видит всё и корзину,
      сотрудник не видит «Удалить навсегда» и «Скачать бэкап», инвестор только читает.
- [ ] Проверка RLS: под сотрудником в SQL нельзя проверить — проверяем через приложение (попытка изменить/удалить).
- [ ] Триггеры и функции на месте:
      ```sql
      select tgname from pg_trigger where not tgisinternal;
      select proname from pg_proc where pronamespace = 'public'::regnamespace;
      select tablename, policyname from pg_policies where schemaname = 'public' order by 1, 2;
      ```
      Сравнить со списком из `schema_public.sql`.
- [ ] Только после всего: в тестовом проекте `DROP TABLE public._restore_profiles; DROP TABLE public._restore_old_users;`

Чтобы открыть тестовую копию CRM, локально временно подставить URL и publishable-ключ **тестового** проекта
в `src/lib/supabase.js` (не коммитить) и запустить `npm run dev`.

## Шаг 5. Если это реальное восстановление (не тест)
После успешной проверки: заменить URL и ключ в `src/lib/supabase.js` → коммит → Vercel задеплоит.
Обновить секреты автобэкапа (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_URL`) в GitHub.
