#!/usr/bin/env node
// backup/restore-json.mjs — ПРЕДВАРИТЕЛЬНЫЙ генератор SQL для восстановления прикладных таблиц из JSON-бэкапа.
//
// Статус: проверен только на локальной тестовой базе со схемой-ЗАГЛУШКОЙ. До получения реальной схемы
// (docs/SCHEMA_DUMP.md) и пробного восстановления в ТЕСТОВЫЙ проект считать предварительным.
// Это вспомогательный слой: схему, функции, триггеры и RLS он НЕ создаёт — их даёт schema dump / pg_dump.
//
// Ничего не подключает к базе сам: только читает файл бэкапа и пишет SQL-файлы в папку --out.
// Запускать SQL — ТОЛЬКО в отдельном тестовом проекте Supabase (см. RESTORE.md). Никогда в рабочем.
//
// Использование:
//   node restore-json.mjs <бэкап.json> [--out restore-out] [--old-users old_users.csv] [--profiles-only]
//   (зашифрованный бэкап сначала расшифровать: age -d -i key.txt файл.json.age > файл.json)
//
// Что получается в папке --out:
//   01_restore_data.sql   — проверка «база пустая» + вставка данных в порядке FK + выравнивание sequences.
//                           Без TRUNCATE, без DROP, без session_replication_role. Всё в одной транзакции.
//   02_map_profiles.sql   — перепривязка profiles к НОВЫМ UUID пользователей по email (после их создания).
//   03_verify.sql         — сверка: количество строк и суммы денег по валютам против бэкапа.
//   report.txt            — сводка (только количества; без сумм и персональных данных).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BACKUP_TABLES, MONEY_COLUMNS, buildManifest } from '../src/lib/backupManifest.js';

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const VALUE_OPTS = ['--out', '--old-users'];
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && VALUE_OPTS.includes(args[i - 1])));
if (!file) { console.error('Укажите файл бэкапа: node restore-json.mjs backup.json [--out dir] [--old-users old_users.csv]'); process.exit(2); }
const outDir = opt('--out') || 'restore-out';
const oldUsersFile = opt('--old-users');
// --profiles-only: для пути через pg_restore — данные таблиц уже восстановлены из дампа,
// нужен только перенос profiles на новые UUID пользователей (служебные таблицы + 02).
const PROFILES_ONLY = args.includes('--profiles-only');

const raw = readFileSync(file);
if (raw.subarray(0, 21).toString() === 'age-encryption.org/v1') {
  console.error('Файл зашифрован (age). Сначала: age -d -i key.txt ' + file + ' > backup.json');
  process.exit(2);
}
const backup = JSON.parse(raw.toString('utf8'));
if (!backup || typeof backup.tables !== 'object') { console.error('Это не файл бэкапа FavoriteMotors (нет tables).'); process.exit(2); }

const PROFILES = 'profiles';
const DATA_TABLES = BACKUP_TABLES.filter((t) => t !== PROFILES);
const BATCH = 200;

// ── SQL-литералы ─────────────────────────────────────────────────────────────
// Строки/даты/JSON передаём как нетипизированный литерал '...': Postgres сам приведёт к типу колонки.
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Недопустимое имя колонки/таблицы: ${s}`);
  return s;
};
function lit(v) {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error('Нечисловое значение в бэкапе'); return String(v); }
  if (typeof v === 'object') return q(JSON.stringify(v)); // jsonb / массивы
  return q(v);
}

// Колонки = объединение ключей по ВСЕМ строкам (а не по первой).
// Ключ отсутствует в строке → DEFAULT (значение по умолчанию колонки); ключ есть и null → NULL.
function columnsOf(rows) {
  const set = new Set();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set].map(ident);
}

function insertSql(table, rows) {
  if (!rows.length) return `-- ${table}: 0 строк в бэкапе — пропуск\n`;
  const cols = columnsOf(rows);
  let sql = `-- ${table}: ${rows.length} строк\n`;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const values = chunk.map((r) => '(' + cols.map((c) => (Object.prototype.hasOwnProperty.call(r, c) ? lit(r[c]) : 'DEFAULT')).join(', ') + ')');
    sql += `INSERT INTO public.${ident(table)} (${cols.join(', ')}) OVERRIDING SYSTEM VALUE VALUES\n  ${values.join(',\n  ')};\n`;
  }
  return sql;
}

// ── Целостность самого файла: manifest (если есть) против строк ────────────────
const tables = Object.fromEntries(BACKUP_TABLES.map((t) => [t, Array.isArray(backup.tables[t]) ? backup.tables[t] : null]));
const missing = BACKUP_TABLES.filter((t) => tables[t] === null);
for (const t of missing) tables[t] = [];
const sha = async (s) => createHash('sha256').update(s).digest('hex');
const computed = await buildManifest(tables, sha);
const fileProblems = [];
if (backup.manifest?.tables) {
  for (const t of BACKUP_TABLES) {
    const m = backup.manifest.tables[t];
    if (!m) continue;
    if (m.rows !== computed.tables[t].rows) fileProblems.push(`${t}: manifest rows ≠ фактическим строкам`);
    if (m.sha256 !== computed.tables[t].sha256) fileProblems.push(`${t}: sha256 не совпал — файл повреждён или изменён`);
  }
}
if (fileProblems.length) {
  console.error('❌ Файл бэкапа не прошёл самопроверку:\n  ' + fileProblems.join('\n  '));
  process.exit(1);
}

// ── 01_restore_data.sql ─────────────────────────────────────────────────────
let s1 = `-- FavoriteMotors CRM — восстановление прикладных данных из JSON (ПРЕДВАРИТЕЛЬНО)
-- Бэкап от: ${backup.exported_at || '?'} · формат v${backup.version ?? '?'}
-- ЗАПУСКАТЬ ТОЛЬКО В ОТДЕЛЬНОМ ТЕСТОВОМ ПРОЕКТЕ SUPABASE, после применения схемы.
-- Без TRUNCATE / DROP / session_replication_role. Ошибка в любом месте → откат всего.
BEGIN;

-- Предохранитель: если в целевых таблицах уже есть строки — остановиться, ничего не меняя.
DO $guard$
DECLARE t text; n bigint;
BEGIN
  FOREACH t IN ARRAY ARRAY[${(PROFILES_ONLY ? ['profiles'] : DATA_TABLES).map(q).join(', ')}] LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'Целевая база НЕ пустая: в таблице % уже % строк. Восстановление остановлено.', t, n;
    END IF;
  END LOOP;
  IF to_regclass('public._restore_profiles') IS NOT NULL OR to_regclass('public._restore_old_users') IS NOT NULL THEN
    RAISE EXCEPTION 'Найдены служебные таблицы _restore_* от прошлой попытки. Это не чистый тестовый проект.';
  END IF;
END
$guard$;

`;
if (PROFILES_ONLY) s1 += '-- режим --profiles-only: данные таблиц уже восстановлены через pg_restore, здесь только profiles\n';
else for (const t of DATA_TABLES) s1 += insertSql(t, tables[t]) + '\n';

// sequences: только для таблиц с числовым id
s1 += '-- Выровнять счётчики id, чтобы новые записи не конфликтовали с восстановленными\n';
for (const t of PROFILES_ONLY ? [] : DATA_TABLES) {
  const rows = tables[t];
  if (rows.length && typeof rows[0].id === 'number') {
    s1 += `SELECT setval(pg_get_serial_sequence('public.${t}', 'id'), (SELECT max(id) FROM public.${t}), true) WHERE pg_get_serial_sequence('public.${t}', 'id') IS NOT NULL;\n`;
  }
}

// profiles: в служебную таблицу как jsonb (без FK на auth.users) — перепривязка в 02_map_profiles.sql
const profRows = tables[PROFILES];
s1 += `\n-- profiles (${profRows.length} строк) → служебная таблица; в public.profiles попадут после сопоставления пользователей\n`;
s1 += 'CREATE TABLE public._restore_profiles (data jsonb NOT NULL);\n';
s1 += 'ALTER TABLE public._restore_profiles ENABLE ROW LEVEL SECURITY; -- без политик: через API не читается\n';
for (let i = 0; i < profRows.length; i += BATCH) {
  s1 += 'INSERT INTO public._restore_profiles (data) VALUES\n  ' + profRows.slice(i, i + BATCH).map((r) => `(${q(JSON.stringify(r))}::jsonb)`).join(',\n  ') + ';\n';
}

// старые пользователи (id,email) из рабочего проекта — CSV, который владелец выгрузил сам
let oldUsers = [];
if (oldUsersFile) {
  const lines = readFileSync(oldUsersFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    const [id, ...rest] = line.split(',');
    const email = rest.join(',').trim().replace(/^"|"$/g, '');
    if (/^id$/i.test(id.trim())) continue; // заголовок
    if (!/^[0-9a-f-]{36}$/i.test(id.trim())) { console.error('Строка CSV пропущена (не UUID в первой колонке)'); continue; }
    oldUsers.push({ id: id.trim().toLowerCase(), email });
  }
}
s1 += '\nCREATE TABLE public._restore_old_users (id uuid PRIMARY KEY, email text);\n';
s1 += 'ALTER TABLE public._restore_old_users ENABLE ROW LEVEL SECURITY;\n';
if (oldUsers.length) {
  s1 += 'INSERT INTO public._restore_old_users (id, email) VALUES\n  ' + oldUsers.map((u) => `(${q(u.id)}, ${u.email ? q(u.email) : 'NULL'})`).join(',\n  ') + ';\n';
} else {
  s1 += '-- old_users.csv не передан: заполните _restore_old_users вручную перед 02_map_profiles.sql (см. RESTORE.md)\n';
}
s1 += '\nCOMMIT;\n';

// ── 02_map_profiles.sql ─────────────────────────────────────────────────────
const profCols = columnsOf(profRows).filter((c) => c !== 'id');
const updateSet = profCols.length ? profCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ') : 'id = EXCLUDED.id';
const s2 = `-- Перепривязка profiles к НОВЫМ UUID пользователей тестового проекта (сопоставление по email).
-- Порядок: (1) пользователи созданы в Authentication тестового проекта; (2) выполнить шаги ниже по одному.

-- ШАГ 1. Проверки ДО переноса — все три запроса должны вернуть 0 строк.
-- 1a. Дубли email среди старых пользователей
SELECT lower(btrim(email)) AS email_norm, count(*) FROM public._restore_old_users GROUP BY 1 HAVING count(*) > 1;
-- 1b. Старые пользователи без email (сопоставить нельзя — решить вручную)
SELECT id AS old_user_id FROM public._restore_old_users WHERE email IS NULL OR btrim(email) = '';
-- 1c. Профили из бэкапа, для которых нет строки в _restore_old_users
SELECT p.data->>'id' AS old_user_id FROM public._restore_profiles p
LEFT JOIN public._restore_old_users o ON o.id = (p.data->>'id')::uuid WHERE o.id IS NULL;

-- ШАГ 2. Таблица соответствия old_user_id → new_user_id (сохранить результат в отчёт).
SELECT o.id AS old_user_id, u.id AS new_user_id, p.data->>'role' AS role,
       CASE WHEN u.id IS NULL THEN 'НЕТ ПОЛЬЗОВАТЕЛЯ В ТЕСТОВОМ ПРОЕКТЕ' ELSE 'ok' END AS status
FROM public._restore_profiles p
JOIN public._restore_old_users o ON o.id = (p.data->>'id')::uuid
LEFT JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(o.email))
ORDER BY status DESC, role;

-- ШАГ 3. Перенос (только если в шаге 2 все строки 'ok').
BEGIN;
INSERT INTO public.profiles
SELECT (jsonb_populate_record(NULL::public.profiles, p.data || jsonb_build_object('id', u.id))).*
FROM public._restore_profiles p
JOIN public._restore_old_users o ON o.id = (p.data->>'id')::uuid
JOIN auth.users u ON lower(btrim(u.email)) = lower(btrim(o.email))
ON CONFLICT (id) DO UPDATE SET ${updateSet};
-- Сколько профилей перенесено — должно совпасть с числом строк в шаге 2:
SELECT count(*) AS profiles_now FROM public.profiles;
COMMIT;

-- ШАГ 4. Проверка FK: каждый профиль ссылается на существующего пользователя (ожидается 0 строк).
SELECT pr.id FROM public.profiles pr LEFT JOIN auth.users u ON u.id = pr.id WHERE u.id IS NULL;

-- ШАГ 5. Служебные таблицы удалять ТОЛЬКО в тестовом проекте и только после успешной сверки:
--   DROP TABLE public._restore_profiles; DROP TABLE public._restore_old_users;
`;

// ── 03_verify.sql ───────────────────────────────────────────────────────────
const checks = [];
for (const t of DATA_TABLES) {
  checks.push(`SELECT ${q(t)} AS tbl, 'строк' AS chk, ${tables[t].length}::numeric AS expected, (SELECT count(*) FROM public.${t})::numeric AS actual`);
  const money = computed.tables[t].money;
  if (money) {
    for (const [col, byCur] of Object.entries(money)) {
      for (const [cur, sum] of Object.entries(byCur)) {
        const curCond = cur === '(нет)' ? 'currency IS NULL' : `currency = ${q(cur)}`;
        checks.push(`SELECT ${q(t)}, ${q(`Σ ${col} ${cur}`)}, ${sum}::numeric, (SELECT coalesce(sum(${ident(col)}), 0) FROM public.${t} WHERE ${curCond})::numeric`);
      }
    }
  }
}
checks.push(`SELECT 'profiles', 'строк (после 02)', ${profRows.length}::numeric, (SELECT count(*) FROM public.profiles)::numeric`);
const s3 = `-- Сверка восстановленной тестовой базы с бэкапом. Ожидается: ok = true во ВСЕХ строках.
-- (Суммы — в минимальных единицах ×100, по каждой валюте отдельно.)
SELECT tbl, chk, expected, actual, expected = actual AS ok FROM (
${checks.join('\n  UNION ALL\n')}
) v ORDER BY ok, tbl, chk;
`;

// ── вывод ───────────────────────────────────────────────────────────────────
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/01_restore_data.sql`, s1);
writeFileSync(`${outDir}/02_map_profiles.sql`, s2);
writeFileSync(`${outDir}/03_verify.sql`, s3);
const report = [
  `Бэкап: ${backup.exported_at || '?'} (формат v${backup.version ?? '?'})`,
  `Самопроверка файла: ${backup.manifest ? 'manifest совпал' : 'manifest нет (старый формат) — суммы посчитаны по строкам'}`,
  missing.length ? `ВНИМАНИЕ: в бэкапе нет таблиц: ${missing.join(', ')}` : 'Все таблицы на месте',
  ...BACKUP_TABLES.map((t) => `  ${t}: ${tables[t].length} строк`),
  `Старых пользователей из CSV: ${oldUsers.length}`,
].join('\n');
writeFileSync(`${outDir}/report.txt`, report + '\n');
console.log(report);
console.log(`\nГотово: ${outDir}/01_restore_data.sql, 02_map_profiles.sql, 03_verify.sql`);
if (missing.includes('payments')) console.log('⚠ В этом бэкапе НЕТ payments (старый формат) — платежи из него не восстановить.');
