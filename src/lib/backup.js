// src/lib/backup.js
import { supabase } from './supabase.js';

const TABLES = ['cars', 'clients', 'rentals', 'car_expenses', 'office_expenses', 'maintenance', 'audit_log'];

export async function exportBackup() {
  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    tables: {},
  };

  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*').order('id');
    if (error) throw new Error(`Ошибка при выгрузке ${table}: ${error.message}`);
    backup.tables[table] = data;
  }

  // Скачиваем как файл
  const json = JSON.stringify(backup, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `favoritemotors-backup-${date}.json`;
  a.click();
  URL.revokeObjectURL(url);

  return backup.tables;
}
