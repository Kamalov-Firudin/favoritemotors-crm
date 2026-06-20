# FavoriteMotors CRM — состояние проекта (веб-версия)

## Что это
Веб-приложение для учёта аренды автомобилей FavoriteMotors.
Работает в браузере с любого устройства и из любой точки мира.

## Стек
- **Frontend**: React 19 + Vite + JSX (без TypeScript)
- **База данных**: Supabase (PostgreSQL) — проект `kbtpdqsqhwfsohyibunn`
- **Деплой**: Vercel — `https://favoritemotors-crm.vercel.app`
- **Репозиторий**: GitHub — `Kamalov-Firudin/favoritemotors-crm`
- **Локальная папка**: `D:\Works\WebCRM\fm-web`

## Структура файлов
```
fm-web/
  src/
    App.jsx              — главный компонент, авторизация, навигация, колокольчик, роли
    main.jsx             — точка входа React
    styles.css           — все стили (тема охра/мастерская)
    lib/
      supabase.js        — клиент Supabase (URL + publishable key)
      api.js             — все запросы к БД + soft-delete/restore/purge/trash + getMyRole
      helpers.js         — fmtMoney, fmtDate, CURRENCIES, toMinor, fromMinor
      backup.js          — выгрузка всех таблиц в JSON файл
      perms.js           — права по роли (PermsContext, usePerms)  ★НОВОЕ
    views/
      Login.jsx          — экран входа
      Rentals.jsx        — брони и аренда (кнопки по роли)
      Calendar.jsx       — календарь-шахматка (создание/правка только для пишущих)
      Cars.jsx           — список машин (статус «Продана», скрытие в корзину)
      CarCard.jsx        — карточка машины (расходы по роли)
      Clients.jsx        — список клиентов (скрытие в корзину)
      ClientPicker.jsx   — выбор клиента в форме брони
      BookingForm.jsx    — форма создания/редактирования брони/аренды
      Finances.jsx       — финансы (расходы по роли)
      Maintenance.jsx    — техсостояние (удаление только admin)
      AuditLog.jsx       — журнал действий всех пользователей
      Trash.jsx          — корзина: восстановление/удаление навсегда  ★НОВОЕ
  index.html
  package.json
  vite.config.js
  vercel.json            — SPA routing
  RESTORE.md             — инструкция восстановления из бэкапа
```

## Supabase
- **URL**: `https://kbtpdqsqhwfsohyibunn.supabase.co`
- **Publishable key**: `sb_publishable_dFk-YZrP1nSblEeMl9lz2A_kmprIyo4`
- **Регион**: Central EU (Frankfurt) eu-central-1
- **Регистрация (signup)**: ОТКЛЮЧЕНА. Пользователи заводятся только вручную.

### Таблицы
- `cars` — машины (… status: free|maintenance|sold|hidden). «hidden» = корзина машины.
- `clients` — клиенты (… + `deleted_at` — корзина)
- `rentals` — аренды и брони (… status: reserved|active|completed|cancelled, + `deleted_at`)
- `car_expenses` — расходы по машинам (… + `deleted_at`)
- `office_expenses` — расходы офиса (… + `deleted_at`)
- `maintenance` — техсостояние (без soft-delete)
- `audit_log` — журнал действий
- `profiles` — роли пользователей (id, full_name, role: admin|staff|viewer)

### RLS (под роли) — задаётся миграцией migration_soft_delete_rls.sql
Функция `current_user_role()` (security definer) читает роль из profiles.
- **SELECT** — все три роли (admin, staff, viewer)
- **INSERT / UPDATE** — admin + staff
- **DELETE (физическое)** — только admin
- `profiles`: видишь свою строку; админ управляет всеми.

### Триггер целостности
`block_hide_client_with_history` — нельзя скрыть клиента, на котором есть
не-удалённые аренды (правило в БД, не в коде — обойти нельзя).

## Роли и доступ
- **admin** (`kamalov.firudin@gmail.com`) — всё, включая удаление навсегда и бэкап.
- **staff** — создаёт/правит/прячет в корзину и восстанавливает. НЕ удаляет физически.
  Видит бэкап и корзину (без кнопки «удалить навсегда»).
- **viewer** (инвестор) — только чтение. Не видит кнопок добавления/правки/удаления,
  бэкапа и корзины. Видит финансы, аренды, машины, журнал.

Завести пользователя: Authentication → Users → Add user → галочка Auto Confirm User.
Затем назначить роль:
```sql
insert into public.profiles (id, full_name, role)
select id, email, 'staff' from auth.users where email = 'email@example.com'
on conflict (id) do update set role = excluded.role;
-- для инвестора: role = 'viewer'
```

## Soft-delete (корзина)
«Удалить» в интерфейсе у клиентов/аренд/расходов = ставит `deleted_at` (скрывает),
у машин = `status='hidden'`. Данные сохраняются.
Вкладка «Корзина»: восстановить (staff+admin) или удалить навсегда (только admin).
Бэкап (`backup.js`) выгружает все строки, включая скрытые.

## Деньги
Хранятся в минимальных единицах (целые × 100). Валюты EUR, USD, TRY не складываются.

## Деплой
1. Скопировать файлы в `D:\Works\WebCRM\fm-web`
2. GitHub Desktop: Commit → Push origin
3. Vercel задеплоит автоматически (~1 мин)

## ВАЖНО: порядок применения этого обновления
1. **Сначала** прогнать `migration_soft_delete_rls.sql` в Supabase SQL Editor.
2. Проверить, что свой email = admin (запрос в конце миграции).
3. **Потом** выложить новый код (этот архив) на Vercel.
Если выложить код без миграции — приложение упадёт при первом «Скрыть»
(колонки `deleted_at` ещё нет) и не сможет прочитать роль.

## Открытые вопросы / что не сделано
1. **Колоночная защита для инвестора** — viewer пока МОЖЕТ читать колонки
   паспорт/в.у. клиентов (RLS прячет строки, не колонки). Для «доступа по
   необходимости» нужен отдельный VIEW без этих полей. НЕ сделано.
2. **Экспорт в Excel** — в веб-версии заглушка.
3. **Автоматический бэкап** — пока только ручная кнопка. Нужен Edge Function
   по расписанию + копия вне Supabase-проекта.
4. **Пагинация** — грузится весь список.
5. **Мобильная версия** — не адаптирована.
6. **Интеграция с сайтом** favorite-motors.com — на будущее.

## Десктопная версия (Electron)
Существует параллельно, последний архив `favoritemotors-crm-v7.zip`. SQLite, без авторизации.
Актуальна как офлайн-резерв.
