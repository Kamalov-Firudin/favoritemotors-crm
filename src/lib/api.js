// src/lib/api.js
// Полная замена window.api из десктопной версии
// Все данные идут через Supabase вместо SQLite

import { supabase } from './supabase.js';
import { toMinor, fromMinor } from './helpers.js';

// ─── Утилиты ──────────────────────────────────────────────────────────────
const nowIso = () => new Date().toISOString();

function carName(c) {
  return `${c.brand || ''} ${c.model || ''}`.trim() || c.name || '(без названия)';
}
function clientName(c) {
  return `${c.last_name || ''} ${c.first_name || ''}`.trim() || c.name || '(без имени)';
}
async function q(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(error.message);
  return data;
}

// ─── Аудит лог ────────────────────────────────────────────────────────────
async function audit(action, table_name, record_id, description) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('audit_log').insert({
      user_email: user.email,
      action,
      table_name,
      record_id: record_id || null,
      description,
    });
  } catch (e) { /* не блокируем основную операцию */ }
}

export const auditLog = {
  list: () => q(supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500)),
};


export const cars = {
  // машины прячутся через status='hidden' (штатный механизм), это и есть их «корзина»
  list: () => q(supabase.from('cars').select('*').neq('status', 'hidden').order('name')),
  listAll: () => q(supabase.from('cars').select('*').order('name')),
  trash: () => q(supabase.from('cars').select('*').eq('status', 'hidden').order('name')),
  create: async (c) => {
    const name = carName(c);
    const { data, error } = await supabase.from('cars').insert({ ...c, name }).select().single();
    if (error) throw new Error(error.message);
    await audit('create', 'cars', data.id, `Добавлена машина: ${name}`);
    return data;
  },
  update: async (c) => {
    const name = carName(c);
    const { error } = await supabase.from('cars').update({ ...c, name }).eq('id', c.id);
    if (error) throw new Error(error.message);
    await audit('update', 'cars', c.id, `Изменена машина: ${name}`);
  },
  // «спрятать в корзину» — это не физическое удаление, а смена статуса (UPDATE)
  hide: async (id) => {
    const { data: c } = await supabase.from('cars').select('name').eq('id', id).single();
    const { error } = await supabase.from('cars').update({ status: 'hidden' }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('update', 'cars', id, `Машина скрыта в корзину: ${c?.name || '#' + id}`);
  },
  restore: async (id) => {
    const { data: c } = await supabase.from('cars').select('name').eq('id', id).single();
    const { error } = await supabase.from('cars').update({ status: 'free' }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('update', 'cars', id, `Машина восстановлена из корзины: ${c?.name || '#' + id}`);
  },
  // физическое удаление — только admin (RLS пропустит только его)
  purge: async (id) => {
    const { data: c } = await supabase.from('cars').select('name').eq('id', id).single();
    const { error } = await supabase.from('cars').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await audit('delete', 'cars', id, `Удалена машина НАВСЕГДА: ${c?.name || '#' + id}`);
  },
};

// ─── Клиенты ──────────────────────────────────────────────────────────────
export const clients = {
  list: () => q(supabase.from('clients').select('*').is('deleted_at', null).order('last_name').order('first_name')),
  trash: () => q(supabase.from('clients').select('*').not('deleted_at', 'is', null).order('last_name')),
  create: async (c) => {
    const name = clientName(c);
    const { data, error } = await supabase.from('clients').insert({ ...c, name }).select().single();
    if (error) throw new Error(error.message);
    await audit('create', 'clients', data.id, `Добавлен клиент: ${name}`);
    return data;
  },
  update: async (c) => {
    const name = clientName(c);
    const { error } = await supabase.from('clients').update({ ...c, name }).eq('id', c.id);
    if (error) throw new Error(error.message);
    await audit('update', 'clients', c.id, `Изменён клиент: ${name}`);
  },
  // soft-delete: ставим deleted_at. Триггер в БД не даст скрыть клиента с живой историей.
  remove: async (id) => {
    const { data: c } = await supabase.from('clients').select('name').eq('id', id).single();
    const { error } = await supabase.from('clients').update({ deleted_at: nowIso() }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('delete', 'clients', id, `Клиент скрыт в корзину: ${c?.name || '#' + id}`);
  },
  restore: async (id) => {
    const { data: c } = await supabase.from('clients').select('name').eq('id', id).single();
    const { error } = await supabase.from('clients').update({ deleted_at: null }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('update', 'clients', id, `Клиент восстановлен из корзины: ${c?.name || '#' + id}`);
  },
  purge: async (id) => {
    const { data: c } = await supabase.from('clients').select('name').eq('id', id).single();
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await audit('delete', 'clients', id, `Удалён клиент НАВСЕГДА: ${c?.name || '#' + id}`);
  },
};

// ─── Конфликт броней ──────────────────────────────────────────────────────
async function findConflict({ car_id, issued_at, due_at, returned_at, pickup_time, return_time, excludeId }) {
  let query = supabase
    .from('rentals')
    .select('*, clients(name)')
    .eq('car_id', car_id)
    .is('deleted_at', null)
    .neq('status', 'cancelled');
  if (excludeId) query = query.neq('id', excludeId);
  const { data: candidates } = await query;
  if (!candidates) return null;

  const startOf = (d, t) => d + 'T' + (t || '12:00');
  const endOf = (ret, due, t) => ret ? startOf(ret, t) : (due ? startOf(due, t) : '9999-12-31T23:59');
  const aStart = startOf(issued_at, pickup_time);
  const aEnd = endOf(returned_at, due_at, return_time);

  for (const r of candidates) {
    const bStart = startOf(r.issued_at, r.pickup_time);
    const bEnd = endOf(r.returned_at, r.due_at, r.return_time);
    if (aStart < bEnd && bStart < aEnd) return r;
  }
  return null;
}

// ─── Аренды ───────────────────────────────────────────────────────────────
function mapRental(r) {
  return {
    ...r,
    car_name: r.cars?.name,
    car_plate: r.cars?.plate,
    client_name: r.clients?.name,
    client_phone: r.clients?.phone,
  };
}
export const rentals = {
  list: async () => {
    const { data, error } = await supabase
      .from('rentals')
      .select('*, cars(name, plate), clients(name, phone)')
      .is('deleted_at', null)
      .order('issued_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(mapRental);
  },
  trash: async () => {
    const { data, error } = await supabase
      .from('rentals')
      .select('*, cars(name, plate), clients(name, phone)')
      .not('deleted_at', 'is', null)
      .order('issued_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(mapRental);
  },
  create: async (r) => {
    const conflict = await findConflict(r);
    if (conflict) throw new Error(`CONFLICT|${conflict.clients?.name}|${conflict.issued_at}|${conflict.returned_at || conflict.due_at || ''}`);
    const { data, error } = await supabase.from('rentals').insert(r).select('*, cars(name), clients(name)').single();
    if (error) throw new Error(error.message);
    await audit('create', 'rentals', data.id, `Создана бронь: ${data.cars?.name} — ${data.clients?.name} · ${data.issued_at}`);
    return data;
  },
  update: async (r) => {
    const conflict = await findConflict({ ...r, excludeId: r.id });
    if (conflict) throw new Error(`CONFLICT|${conflict.clients?.name}|${conflict.issued_at}|${conflict.returned_at || conflict.due_at || ''}`);
    const { id, cars: _c, clients: _cl, car_name, car_plate, client_name, client_phone, ...rest } = r;
    const { error } = await supabase.from('rentals').update(rest).eq('id', id);
    if (error) throw new Error(error.message);
    const carClient = `${car_name || ''} — ${client_name || ''}`.trim();
    const action = rest.status === 'completed' ? `Возврат: ${carClient}` : rest.status === 'active' ? `Выдача: ${carClient}` : rest.status === 'cancelled' ? `Отмена брони: ${carClient}` : `Изменена аренда: ${carClient}`;
    await audit('update', 'rentals', id, action);
  },
  // soft-delete
  remove: async (id) => {
    const { data: r } = await supabase.from('rentals').select('cars(name), clients(name)').eq('id', id).single();
    const { error } = await supabase.from('rentals').update({ deleted_at: nowIso() }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('delete', 'rentals', id, `Аренда скрыта в корзину: ${r?.cars?.name || ''} — ${r?.clients?.name || ''}`);
  },
  restore: async (id) => {
    const { error } = await supabase.from('rentals').update({ deleted_at: null }).eq('id', id);
    if (error) throw new Error(error.message);
    await audit('update', 'rentals', id, `Аренда восстановлена из корзины #${id}`);
  },
  purge: async (id) => {
    const { error } = await supabase.from('rentals').delete().eq('id', id);
    if (error) throw new Error(error.message);
    await audit('delete', 'rentals', id, `Удалена аренда НАВСЕГДА #${id}`);
  },
};

// ─── Расходы машин ────────────────────────────────────────────────────────
export const carExpenses = {
  listByCar: (car_id) => q(supabase.from('car_expenses').select('*').eq('car_id', car_id).is('deleted_at', null).order('date', { ascending: false })),
  listAll: async () => {
    const { data, error } = await supabase.from('car_expenses').select('*, cars(name)').is('deleted_at', null).order('date', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(e => ({ ...e, car_name: e.cars?.name }));
  },
  trash: async () => {
    const { data, error } = await supabase.from('car_expenses').select('*, cars(name)').not('deleted_at', 'is', null).order('date', { ascending: false });
    if (error) throw new Error(error.message);
    return data.map(e => ({ ...e, car_name: e.cars?.name }));
  },
  create: async (e) => {
    const data = await q(supabase.from('car_expenses').insert(e).select().single());
    await audit('create', 'car_expenses', data.id, `Расход машины: ${e.description} · ${(e.amount/100).toFixed(2)} ${e.currency}`);
    return data;
  },
  update: async ({ id, cars: _c, car_name, ...rest }) => {
    await q(supabase.from('car_expenses').update(rest).eq('id', id));
    await audit('update', 'car_expenses', id, `Изменён расход машины: ${rest.description} · ${(rest.amount/100).toFixed(2)} ${rest.currency}`);
  },
  remove: async (id) => {
    const { data: e } = await supabase.from('car_expenses').select('description').eq('id', id).single();
    await q(supabase.from('car_expenses').update({ deleted_at: nowIso() }).eq('id', id));
    await audit('delete', 'car_expenses', id, `Расход машины скрыт в корзину: ${e?.description || '#' + id}`);
  },
  restore: async (id) => {
    await q(supabase.from('car_expenses').update({ deleted_at: null }).eq('id', id));
    await audit('update', 'car_expenses', id, `Расход машины восстановлен #${id}`);
  },
  purge: async (id) => {
    await q(supabase.from('car_expenses').delete().eq('id', id));
    await audit('delete', 'car_expenses', id, `Удалён расход машины НАВСЕГДА #${id}`);
  },
};

// ─── Расходы офиса ────────────────────────────────────────────────────────
export const officeExpenses = {
  list: () => q(supabase.from('office_expenses').select('*').is('deleted_at', null).order('date', { ascending: false })),
  trash: () => q(supabase.from('office_expenses').select('*').not('deleted_at', 'is', null).order('date', { ascending: false })),
  create: async (e) => {
    const data = await q(supabase.from('office_expenses').insert(e).select().single());
    await audit('create', 'office_expenses', data.id, `Расход офиса: ${e.description} · ${(e.amount/100).toFixed(2)} ${e.currency}`);
    return data;
  },
  update: async ({ id, ...rest }) => {
    await q(supabase.from('office_expenses').update(rest).eq('id', id));
    await audit('update', 'office_expenses', id, `Изменён расход офиса: ${rest.description} · ${(rest.amount/100).toFixed(2)} ${rest.currency}`);
  },
  remove: async (id) => {
    const { data: e } = await supabase.from('office_expenses').select('description').eq('id', id).single();
    await q(supabase.from('office_expenses').update({ deleted_at: nowIso() }).eq('id', id));
    await audit('delete', 'office_expenses', id, `Расход офиса скрыт в корзину: ${e?.description || '#' + id}`);
  },
  restore: async (id) => {
    await q(supabase.from('office_expenses').update({ deleted_at: null }).eq('id', id));
    await audit('update', 'office_expenses', id, `Расход офиса восстановлен #${id}`);
  },
  purge: async (id) => {
    await q(supabase.from('office_expenses').delete().eq('id', id));
    await audit('delete', 'office_expenses', id, `Удалён расход офиса НАВСЕГДА #${id}`);
  },
};

// ─── Техсостояние ─────────────────────────────────────────────────────────
export const maintenance = {
  list: async () => {
    const { data, error } = await supabase.from('maintenance').select('*, cars(name, plate)').order('car_id');
    if (error) throw new Error(error.message);
    return data.map(m => ({ ...m, car_name: m.cars?.name, car_plate: m.cars?.plate }));
  },
  create: async (m) => {
    const { data: car } = await supabase.from('cars').select('name').eq('id', m.car_id).single();
    const data = await q(supabase.from('maintenance').insert(m).select().single());
    await audit('create', 'maintenance', data.id, `Добавлено техсостояние: ${car?.name || '#' + m.car_id}`);
    return data;
  },
  update: async ({ id, cars: _c, car_name, car_plate, ...rest }) => {
    await q(supabase.from('maintenance').update(rest).eq('id', id));
    await audit('update', 'maintenance', id, `Изменено техсостояние: ${car_name || '#' + id}`);
  },
  remove: async (id) => {
    const { data: m } = await supabase.from('maintenance').select('car_id, cars(name)').eq('id', id).single();
    await q(supabase.from('maintenance').delete().eq('id', id));
    await audit('delete', 'maintenance', id, `Удалена запись техсостояния: ${m?.cars?.name || '#' + id}`);
  },
  // обновить текущий пробег машины (вызывается при возврате аренды).
  // Не понижаем одометр. Если записи техсостояния у машины нет — создаём её,
  // чтобы пробег всегда статично записывался и работало уведомление о масле.
  setCurrentKm: async (car_id, km) => {
    if (!car_id || !Number.isFinite(Number(km))) return false;
    const { data: rows } = await supabase.from('maintenance').select('id, current_km').eq('car_id', car_id).limit(1);
    if (rows && rows.length) {
      const row = rows[0];
      if (row.current_km != null && Number(km) < Number(row.current_km)) return false; // не понижаем
      const { error } = await supabase.from('maintenance').update({ current_km: Number(km) }).eq('id', row.id);
      if (error) throw new Error(error.message);
      await audit('update', 'maintenance', row.id, `Пробег обновлён при возврате: ${Number(km).toLocaleString()} км`);
      return true;
    }
    // записи нет — создаём минимальную
    const { data: created, error } = await supabase.from('maintenance').insert({ car_id, current_km: Number(km) }).select().single();
    if (error) throw new Error(error.message);
    await audit('create', 'maintenance', created.id, `Создана запись техсостояния, пробег: ${Number(km).toLocaleString()} км`);
    return true;
  },
};

// ─── Статистика ───────────────────────────────────────────────────────────
export async function getStats() {
  const [{ count: total }, { count: out }, { count: reserved }, { count: maint }] = await Promise.all([
    supabase.from('cars').select('*', { count: 'exact', head: true }).neq('status', 'hidden'),
    supabase.from('rentals').select('car_id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'active'),
    supabase.from('rentals').select('car_id', { count: 'exact', head: true }).is('deleted_at', null).eq('status', 'reserved'),
    supabase.from('cars').select('*', { count: 'exact', head: true }).eq('status', 'maintenance'),
  ]);
  return { total: total || 0, out: out || 0, reserved: reserved || 0, maintenance: maint || 0, free: Math.max(0, (total || 0) - (out || 0) - (maint || 0)) };
}

// ─── Уведомления ─────────────────────────────────────────────────────────
export async function getNotifications() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const tomorrowStr = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const in2Str = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const in15Str = new Date(Date.now() + 15 * 86400000).toISOString().slice(0, 10);

  const [rentalsData, maintData] = await Promise.all([
    rentals.list(),
    maintenance.list(),
  ]);

  const notes = [];
  const fmtDate = (d) => d ? d.split('-').reverse().join('.') : '';

  rentalsData.filter(r => r.status === 'active' && r.due_at && r.due_at < todayStr).forEach(r => {
    const days = Math.round((new Date(todayStr) - new Date(r.due_at)) / 86400000);
    notes.push({ id: `overdue-${r.id}`, type: 'overdue', text: `Просрочен возврат на ${days} дн — ${r.car_name}`, sub: `${r.client_name} · должен был вернуть ${fmtDate(r.due_at)}`, tab: 'rentals' });
  });
  rentalsData.filter(r => r.status === 'active' && r.due_at === todayStr).forEach(r => {
    notes.push({ id: `today-${r.id}`, type: 'urgent', text: `Сегодня возврат — ${r.car_name}`, sub: `${r.client_name} · до ${r.return_time || '—'}`, tab: 'rentals' });
  });
  rentalsData.filter(r => r.status === 'active' && r.due_at === tomorrowStr).forEach(r => {
    notes.push({ id: `return-${r.id}`, type: 'warn', text: `Завтра ${fmtDate(r.due_at)} возврат — ${r.car_name}`, sub: r.client_name, tab: 'rentals' });
  });
  rentalsData.filter(r => r.status === 'active' && r.due_at === in2Str).forEach(r => {
    notes.push({ id: `return2-${r.id}`, type: 'info', text: `Послезавтра ${fmtDate(r.due_at)} возврат — ${r.car_name}`, sub: r.client_name, tab: 'rentals' });
  });
  rentalsData.filter(r => r.status === 'reserved' && r.issued_at === todayStr).forEach(r => {
    notes.push({ id: `book-today-${r.id}`, type: 'urgent', text: `Сегодня выдача — ${r.car_name}`, sub: `Бронь: ${r.client_name} · ${r.pickup_time || '—'}`, tab: 'bookings' });
  });
  rentalsData.filter(r => r.status === 'reserved' && r.issued_at === tomorrowStr).forEach(r => {
    notes.push({ id: `book-tmr-${r.id}`, type: 'warn', text: `Завтра ${fmtDate(r.issued_at)} выдача — ${r.car_name}`, sub: `Бронь: ${r.client_name}`, tab: 'bookings' });
  });
  maintData.forEach(m => {
    if (m.insurance_date && m.insurance_date <= in15Str) {
      const days = Math.round((new Date(m.insurance_date) - new Date(todayStr)) / 86400000);
      notes.push({ id: `ins-${m.id}`, type: days < 0 ? 'overdue' : 'warn', text: days < 0 ? `Страховка просрочена — ${m.car_name}` : `Страховка истекает через ${days} дн — ${m.car_name}`, sub: `${fmtDate(m.insurance_date)} · ${m.car_plate || ''}`, tab: 'maintenance' });
    }
    if (m.inspection_date && m.inspection_date <= in15Str) {
      const days = Math.round((new Date(m.inspection_date) - new Date(todayStr)) / 86400000);
      notes.push({ id: `insp-${m.id}`, type: days < 0 ? 'overdue' : 'warn', text: days < 0 ? `Тех. осмотр просрочен — ${m.car_name}` : `Тех. осмотр через ${days} дн — ${m.car_name}`, sub: `${fmtDate(m.inspection_date)} · ${m.car_plate || ''}`, tab: 'maintenance' });
    }
    if (m.oil_next_km && m.current_km && m.oil_next_km - m.current_km <= 500) {
      const left = m.oil_next_km - m.current_km;
      notes.push({ id: `oil-${m.id}`, type: left <= 0 ? 'overdue' : 'warn', text: left <= 0 ? `Масло просрочено — ${m.car_name}` : `Замена масла через ${left} км — ${m.car_name}`, sub: `Пробег ${m.current_km?.toLocaleString()} · след. ${m.oil_next_km?.toLocaleString()} км`, tab: 'maintenance' });
    }
  });

  const order = { overdue: 0, urgent: 1, warn: 2, info: 3 };
  return notes.sort((a, b) => (order[a.type] ?? 9) - (order[b.type] ?? 9));
}

export const CAR_EXPENSE_CATS = ['ТО', 'Ремонт', 'Страхование', 'Шины', 'Мойка', 'Прочее'];
export const OFFICE_EXPENSE_CATS = ['Аренда', 'Коммунальные услуги', 'Реклама', 'Зарплата', 'Связь', 'Прочее'];

// текущая роль пользователя (admin|staff|viewer)
export async function getMyRole() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'viewer';
  const { data, error } = await supabase.from('profiles').select('role').eq('id', user.id).single();
  if (error || !data) return 'viewer';
  return data.role || 'viewer';
}

// профиль: роль + флаг обязательной смены пароля
export async function getMyProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { role: 'viewer', mustChange: false };
  const { data, error } = await supabase
    .from('profiles')
    .select('role, must_change_password')
    .eq('id', user.id)
    .single();
  if (error || !data) return { role: 'viewer', mustChange: false };
  return { role: data.role || 'viewer', mustChange: !!data.must_change_password };
}

// сменить собственный пароль (пользователь уже залогинен временным)
export async function changeMyPassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

// снять флаг must_change_password у себя (через защищённую функцию, без права менять роль)
export async function clearMustChangePassword() {
  const { error } = await supabase.rpc('clear_must_change_password');
  if (error) throw new Error(error.message);
}
