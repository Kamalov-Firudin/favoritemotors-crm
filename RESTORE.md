# Восстановление базы FavoriteMotors CRM

## Когда это нужно
- Потерян доступ к Supabase аккаунту
- Случайно удалены данные
- Переезд на новый Supabase проект

## Шаг 1 — Создать новый Supabase проект
1. Зайти на supabase.com → New Project
2. Регион: Central EU (Frankfurt) eu-central-1
3. Дождаться создания проекта

## Шаг 2 — Создать схему базы
В SQL Editor выполнить файл `favoritemotors-schema.sql` (из первоначальной настройки).

## Шаг 3 — Восстановить данные из бэкапа
Скинуть `.json` файл бэкапа в чат с Claude — он сгенерирует SQL для восстановления.

Либо использовать скрипт ниже (Python, запускать локально):

```python
import json, sys

def val(v):
    if v is None: return 'NULL'
    if isinstance(v, bool): return 'TRUE' if v else 'FALSE'
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"

def generate(backup_file):
    with open(backup_file) as f:
        backup = json.load(f)
    
    lines = [
        '-- Восстановление FavoriteMotors CRM',
        f'-- Бэкап от: {backup["exported_at"]}',
        '',
        'SET session_replication_role = replica;',
        '',
    ]
    
    order = ['cars', 'clients', 'rentals', 'car_expenses', 'office_expenses', 'maintenance', 'audit_log']
    
    for table in order:
        rows = backup['tables'].get(table, [])
        if not rows:
            continue
        cols = list(rows[0].keys())
        lines.append(f'TRUNCATE TABLE {table} RESTART IDENTITY CASCADE;')
        for row in rows:
            vals = ', '.join(val(row.get(c)) for c in cols)
            lines.append(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({vals});")
        lines.append(f"SELECT setval('{table}_id_seq', COALESCE((SELECT MAX(id) FROM {table}), 1));")
        lines.append('')
    
    lines.append('SET session_replication_role = DEFAULT;')
    return '\n'.join(lines)

if __name__ == '__main__':
    print(generate(sys.argv[1]))
```

Запуск: `python restore.py favoritemotors-backup-2026-06-18.json > restore.sql`
Затем вставить содержимое `restore.sql` в Supabase SQL Editor.

## Шаг 4 — Обновить ключи в коде
В файле `src/lib/supabase.js` заменить:
- `SUPABASE_URL` — новый URL проекта
- `SUPABASE_KEY` — новый publishable key

Залить на GitHub → Vercel задеплоит автоматически.

## Шаг 5 — Создать пользователей заново
В Authentication → Users создать пользователей и назначить роли через SQL.
