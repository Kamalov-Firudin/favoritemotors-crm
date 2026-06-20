# Автобэкап Supabase → Google Drive — настройка

Бэкап делает GitHub Actions два раза в день (обед и вечер по UTC+3) и кладёт JSON
со всеми таблицами в папку Google Drive. Предыдущие файлы не удаляются.
Делается один раз, потом работает само.

---

## Шаг 1. Папка в Google Drive
1. Создай в своём Google Drive папку, например `FavoriteMotors-Backups`.
2. Открой её. В адресе будет `…/folders/XXXXXXXX` — эта часть `XXXXXXXX` и есть
   **DRIVE_FOLDER_ID**. Скопируй.

## Шаг 2. OAuth-клиент Google (разовая морока ~15 мин)
1. https://console.cloud.google.com → создай проект (или возьми существующий).
2. **APIs & Services → Library** → найди **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** → Create.
   - Заполни название и свой email. Сохраняй до конца.
   - **Test users** → добавь свой Gmail (тот, чей Drive). Статус «Testing» — норм.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Desktop app** → Create.
   - Скачай JSON → переименуй в **`oauth_client.json`** и положи в папку `backup/`.
   - (Этот файл НЕ коммить — он уже в .gitignore.)
   - Из него же возьмёшь **GOOGLE_CLIENT_ID** и **GOOGLE_CLIENT_SECRET** (поля
     `client_id` и `client_secret`).

## Шаг 3. Получить refresh-токен (разово, локально)
В папке `backup/`:
```
npm install
node get-refresh-token.mjs
```
Откроется ссылка → подтверди доступ своим аккаунтом → в терминал напечатается
**GOOGLE_REFRESH_TOKEN**. Скопируй.
(Если refresh_token пустой — зайди на myaccount.google.com → Security →
Third-party access, убери прошлый доступ приложения и повтори.)

## Шаг 4. Сервисный ключ Supabase
Supabase Dashboard → **Settings → API → Project API keys → `service_role` (secret)**.
Это **SUPABASE_SERVICE_KEY**. Он обходит RLS — НИКОГДА не клади его в код фронтенда,
только в секреты GitHub. **SUPABASE_URL** — там же (Project URL).

## Шаг 5. Секреты в GitHub
Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**.
Добавь шесть штук:
| Имя | Значение |
|-----|----------|
| `SUPABASE_URL` | https://kbtpdqsqhwfsohyibunn.supabase.co |
| `SUPABASE_SERVICE_KEY` | service_role ключ |
| `GOOGLE_CLIENT_ID` | из oauth_client.json |
| `GOOGLE_CLIENT_SECRET` | из oauth_client.json |
| `GOOGLE_REFRESH_TOKEN` | из шага 3 |
| `DRIVE_FOLDER_ID` | из шага 1 |

## Шаг 6. Залить код и протестировать
1. Коммит + пуш папки `backup/` и `.github/workflows/backup.yml`.
   (Проверь, что `backup/oauth_client.json` НЕ попал в коммит.)
2. GitHub → вкладка **Actions** → **Backup to Google Drive** → **Run workflow**.
3. Через ~минуту в логе должно быть `✅ Загружено: …`, а в папке Drive — файл.
   Если упало — придёт письмо, в логе будет причина.

## Шаг 7. ТЕСТ ВОССТАНОВЛЕНИЯ (обязательно, иначе бэкапа считай нет)
1. Скачай один JSON из Drive, открой — убедись, что в `tables` есть твои строки
   (cars, clients, rentals…), а не пусто.
2. Прорепетируй восстановление по `RESTORE.md` хотя бы мысленно: этот JSON
   полностью описывает базу, из него Claude генерирует SQL для нового проекта.

---

## Расписание
Время в `backup.yml` — в UTC. Местное UTC+3:
- `0 10 * * *` → 13:00
- `0 17 * * *` → 20:00
Поменять — отними 3 часа от нужного местного времени и впиши в `cron`.
GitHub иногда задерживает запуск по расписанию на 5–15 минут — для бэкапа неважно.
