# pg_dump → Google Drive (основной слой бэкапа)

Workflow: `.github/workflows/pg-dump.yml`. **Сейчас только ручной запуск**, расписания нет.
Расписание добавляется отдельным решением после пробного восстановления.

## Почему Session Pooler
Прямой адрес базы Supabase (`db.<ref>.supabase.co`) работает только по IPv6, а серверы GitHub Actions — по IPv4.
Session Pooler (порт **5432**) работает по IPv4 и подходит для `pg_dump`.
Workflow сам ставит клиент PostgreSQL той же версии, что и сервер: `pg_dump` старее сервера не запустится.

## 1. Секреты (добавляете сами, в чат не присылать)
GitHub → Settings → Secrets and variables → Actions → **Secrets**:
| Имя | Значение |
|---|---|
| `SUPABASE_DB_URL` | Supabase → Connect → **Session pooler** → URI, с подставленным паролем БД |
| `AGE_RECIPIENT` | публичный ключ `age1…` (см. `docs/ENCRYPTION.md`) |
| `GOOGLE_*`, `DRIVE_FOLDER_ID` | уже есть (общие с JSON-бэкапом) |

Пароль БД: Supabase → Project Settings → Database → Reset database password, если не помните.
⚠ Сброс пароля БД не влияет на CRM (она ходит через API-ключи), но ломает всё, что подключалось старым паролем.

## 2. Пробный запуск
1. Сначала пройти `docs/ENCRYPTION.md`, шаги 1–4 (ключ создан, пробная расшифровка прошла).
2. Actions → **pg_dump to Google Drive (ручной запуск, тест)** → Run workflow.
3. В логе должно быть: версия сервера, `Объектов в дампе: N`, `payments в дампе: есть`,
   `Зашифровано: … байт`, `✅ Загружено: favoritemotors-pgdump-ДАТА.dump.age`.
   Других данных в логе нет и быть не должно (логи публичные).
4. Скачать файл из Drive и расшифровать:
   `age -d -i fm-backup-key.txt favoritemotors-pgdump-ДАТА.dump.age > db.dump`
5. Проверить содержимое без восстановления:
   `pg_restore --list db.dump | findstr /C:"TABLE DATA"` — должны быть все 9 таблиц.

## 3. Пробное восстановление
`RESTORE.md` → «Путь A», **только в отдельный тестовый проект**.

## 4. Включение по расписанию (после успешного восстановления, отдельным решением)
В `pg-dump.yml` добавить в блок `on:`:
```yaml
  schedule:
    - cron: '30 17 * * *'   # 20:30 по Турции
```

## Ограничения (честно)
- В дамп входит только схема `public`. Пользователи Auth, Storage и настройки проекта **не входят**.
- Проверено локально (PostgreSQL 16, схема-заглушка): dump → age → расшифровка байт-в-байт →
  pg_restore → сверка. На реальном Supabase **не проверено**.
- При восстановлении в Supabase возможны ошибки прав/владельцев на служебные объекты.
  Все ошибки, кроме `schema "public" already exists`, записать в отчёт.
