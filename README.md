# FavoriteMotors CRM — веб-версия

## Локальный запуск

```bash
npm install
npm run dev
```

Откроется на http://localhost:5173

## Деплой на Vercel

1. Залить папку на GitHub (новый репозиторий)
2. Зайти на vercel.com → New Project → выбрать репозиторий
3. Framework: Vite (определится автоматически)
4. Нажать Deploy

## Добавить сотрудника

1. Зайти в Supabase → Authentication → Users → Add user
2. Выполнить в SQL Editor:
```sql
INSERT INTO profiles (id, full_name, role)
SELECT id, email, 'staff'
FROM auth.users
WHERE email = 'email_сотрудника@gmail.com'
ON CONFLICT (id) DO UPDATE SET role = 'staff';
```
