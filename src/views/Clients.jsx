import React, { useState, useEffect, useCallback } from 'react';
import { fmtMoney, fmtDate } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import { cars as carsApi, clients as clientsApi, rentals as rentalsApi, carExpenses, officeExpenses, maintenance as maintenanceApi, CAR_EXPENSE_CATS, OFFICE_EXPENSE_CATS } from '../lib/api.js';

const CATEGORIES = ['Обычный', 'Постоянный', 'Лояльный', 'Чёрный список'];
const EMPTY = {
  first_name: '', last_name: '', middle_name: '', phone: '', phone2: '', email: '',
  birth_date: '', source: '', category: 'Обычный',
  passport_number: '', country: '',
  license_number: '', license_issued: '',
  discount: '', note: '',
};

export default function Clients() {
  const { canWrite } = usePerms();
  const [rows, setRows] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [form, setForm] = useState(null);
  const [q, setQ] = useState('');
  const [debtorsOnly, setDebtorsOnly] = useState(false);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([clientsApi.list(), rentalsApi.list()]);
    setRows(c); setRentals(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  // баланс клиента по валютам: сумма (amount - paid) по неоплаченным
  const balanceOf = (clientId) => {
    const byCur = {};
    for (const r of rentals) if (r.client_id === clientId) {
      const d = Number(r.amount) - Number(r.paid);
      if (d > 0) byCur[r.currency] = (byCur[r.currency] || 0) + d;
    }
    return byCur;
  };
  const balanceStr = (byCur) => Object.entries(byCur).map(([cur, v]) => fmtMoney(v, cur)).join(' · ');
  const isDebtor = (byCur) => Object.keys(byCur).length > 0;

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (c) => setForm({ ...EMPTY, ...c, discount: c.discount || '' });

  const save = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) return alert('Укажите имя или фамилию');
    const t = (v) => (typeof v === 'string' ? v.trim() || null : v);
    const payload = {
      ...form,
      first_name: t(form.first_name), last_name: t(form.last_name), middle_name: t(form.middle_name),
      phone: t(form.phone), phone2: t(form.phone2), email: t(form.email),
      birth_date: t(form.birth_date) || null,
      source: t(form.source),
      passport_number: t(form.passport_number), country: t(form.country),
      license_number: t(form.license_number),
      license_issued: t(form.license_issued) || null,
      note: t(form.note),
      discount: Number(form.discount) || 0,
    };
    if (form.id) await clientsApi.update(payload);
    else await clientsApi.create(payload);
    setForm(null); await load();
  };

  const remove = async (c) => {
    if (!confirm(`Скрыть клиента «${c.name}» в корзину? Данные сохранятся, можно восстановить.`)) return;
    try { await clientsApi.remove(c.id); await load(); }
    catch (e) { alert(e?.message || 'Нельзя скрыть: по клиенту есть аренды в истории.'); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const term = q.trim().toLowerCase();
  const filtered = rows.filter((c) => {
    if (debtorsOnly && !isDebtor(balanceOf(c.id))) return false;
    if (!term) return true;
    return [c.name, c.first_name, c.last_name, c.middle_name, c.phone, c.phone2, c.email]
      .some((v) => v && String(v).toLowerCase().includes(term));
  });

  return (
    <>
      <div className="head">
        <h1>Клиенты</h1>
        {canWrite && <button className="btn" onClick={openNew}>+ Добавить клиента</button>}
      </div>

      <div className="toolbar">
        <input className="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск: фамилия, телефон, email..." />
        <label className="toggle"><input type="checkbox" checked={debtorsOnly} onChange={(e) => setDebtorsOnly(e.target.checked)} /> Только должники</label>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty"><b>{rows.length === 0 ? 'Пока нет клиентов' : 'Ничего не найдено'}</b>{rows.length === 0 ? 'Добавьте клиента — он появится в выборе при создании брони.' : 'Измените поиск или фильтр.'}</div>
        ) : (
          <table>
            <thead><tr><th>№</th><th>Фамилия</th><th>Имя</th><th>Отчество</th><th>Телефон</th><th>Email</th><th>Баланс</th><th>Дата рожд.</th><th>Источник</th><th></th></tr></thead>
            <tbody>
              {filtered.map((c) => {
                const bal = balanceOf(c.id); const debtor = isDebtor(bal);
                return (
                  <tr key={c.id}>
                    <td className="mono muted">{c.id}</td>
                    <td><b>{c.last_name || '—'}</b>{c.category && c.category !== 'Обычный' && <span className={`badge ${c.category === 'Чёрный список' ? 'maintenance' : 'free'}`} style={{ marginLeft: 6 }}>{c.category === 'Чёрный список' ? 'ЧС' : c.category}</span>}</td>
                    <td>{c.first_name || '—'}</td>
                    <td className="muted">{c.middle_name || '—'}</td>
                    <td className="mono">{c.phone || '—'}</td>
                    <td className="muted">{c.email || '—'}</td>
                    <td className="mono" style={{ color: debtor ? 'var(--warn)' : 'var(--ink-soft)', fontWeight: debtor ? 600 : 400 }}>{debtor ? balanceStr(bal) : '0'}</td>
                    <td className="mono muted">{fmtDate(c.birth_date)}</td>
                    <td className="muted">{c.source || '—'}</td>
                    <td><div className="row-actions">
                      {canWrite && <button className="btn ghost sm" onClick={() => openEdit(c)}>Изм.</button>}
                      {canWrite && <button className="btn ghost sm" onClick={() => remove(c)}>Скрыть</button>}
                    </div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="overlay">
          <div className="modal">
            <div className="modal-head"><h3>{form.id ? 'Изменить клиента' : 'Новый клиент'}</h3><button className="x" onClick={() => setForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field"><label>Фамилия</label><input value={form.last_name} onChange={set('last_name')} /></div>
              <div className="field"><label>Имя *</label><input value={form.first_name} onChange={set('first_name')} /></div>
              <div className="field"><label>Отчество</label><input value={form.middle_name} onChange={set('middle_name')} /></div>
              <div className="field"><label>Категория</label><select value={form.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
              <div className="field"><label>Основной телефон</label><input value={form.phone} onChange={set('phone')} placeholder="+90 ..." /></div>
              <div className="field"><label>Доп. телефон</label><input value={form.phone2} onChange={set('phone2')} /></div>
              <div className="field"><label>Email</label><input value={form.email} onChange={set('email')} /></div>
              <div className="field"><label>Дата рождения</label><input type="date" value={form.birth_date || ''} onChange={set('birth_date')} /></div>
              <div className="field"><label>Источник</label><input value={form.source} onChange={set('source')} placeholder="Instagram, друзья, сайт..." /></div>
              <div className="field"><label>Скидка, %</label><input value={form.discount} onChange={set('discount')} placeholder="0" /></div>

              <div className="field"><label>Номер паспорта</label><input value={form.passport_number} onChange={set('passport_number')} /></div>
              <div className="field"><label>Страна</label><input value={form.country} onChange={set('country')} placeholder="Турция, Казахстан..." /></div>
              <div className="field"><label>Номер вод. удостоверения</label><input value={form.license_number} onChange={set('license_number')} /></div>
              <div className="field"><label>Вод. удв. выдано</label><input type="date" value={form.license_issued || ''} onChange={set('license_issued')} /></div>
              <div className="field full"><label>Примечание</label><textarea value={form.note} onChange={set('note')} /></div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setForm(null)}>Отмена</button><button className="btn" onClick={save}>Сохранить</button></div>
          </div>
        </div>
      )}
    </>
  );
}
