import React, { useState, useEffect, useCallback } from 'react';
import { fmtMoney, fmtDate, clientBalance } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import Pagination from './Pagination.jsx';
import ClientCard from './ClientCard.jsx';
import { toast, confirmDialog } from '../lib/ui.jsx';
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
  const [cardClient, setCardClient] = useState(null); // открытая карточка клиента
  const [q, setQ] = useState('');
  const [debtorsOnly, setDebtorsOnly] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [q, debtorsOnly]);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([clientsApi.list(), rentalsApi.list()]);
    setRows(c); setRentals(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  // баланс клиента по валютам: + клиент должен, − переплата (в пользу клиента)
  const balanceOf = (clientId) => clientBalance(rentals, clientId);
  const isDebtor = (byCur) => Object.values(byCur).some((v) => v > 0);
  const hasCredit = (byCur) => Object.values(byCur).some((v) => v < 0);
  const balanceCell = (byCur) => {
    const debt = Object.entries(byCur).filter(([, v]) => v > 0);
    const credit = Object.entries(byCur).filter(([, v]) => v < 0);
    if (!debt.length && !credit.length) return <span style={{ color: 'var(--ink-soft)' }}>0</span>;
    return (
      <>
        {debt.length > 0 && <div style={{ color: 'var(--warn)', fontWeight: 600 }}>{debt.map(([c, v]) => fmtMoney(v, c)).join(' · ')}</div>}
        {credit.length > 0 && <div style={{ color: '#3B6D11', fontWeight: 500 }} title="в пользу клиента (можно зачесть)">+{credit.map(([c, v]) => fmtMoney(-v, c)).join(' · ')}</div>}
      </>
    );
  };

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (c) => setForm({ ...EMPTY, ...c, discount: c.discount || '' });

  const save = async () => {
    if (!form.first_name.trim() && !form.last_name.trim()) return toast('Укажите имя или фамилию');
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
    if (!(await confirmDialog(`Скрыть клиента «${c.name}» в корзину? Данные сохранятся, можно восстановить.`, { okText: 'Скрыть' }))) return;
    try { await clientsApi.remove(c.id); await load(); }
    catch (e) { toast(e?.message || 'Нельзя скрыть: по клиенту есть аренды в истории.', 'error'); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const term = q.trim().toLowerCase();
  const filtered = rows.filter((c) => {
    if (debtorsOnly && !isDebtor(balanceOf(c.id))) return false;
    if (!term) return true;
    return [c.name, c.first_name, c.last_name, c.middle_name, c.phone, c.phone2, c.email]
      .some((v) => v && String(v).toLowerCase().includes(term));
  });
  const pageClients = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

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
              {pageClients.map((c) => {
                const bal = balanceOf(c.id); const debtor = isDebtor(bal);
                return (
                  <tr key={c.id}>
                    <td className="mono muted">{c.id}</td>
                    <td><b onClick={() => setCardClient(c)} style={{ cursor: 'pointer', color: 'var(--accent)' }} title="Открыть карточку и историю">{c.last_name || '—'}</b>{c.category && c.category !== 'Обычный' && <span className={`badge ${c.category === 'Чёрный список' ? 'maintenance' : 'free'}`} style={{ marginLeft: 6 }}>{c.category === 'Чёрный список' ? 'ЧС' : c.category}</span>}</td>
                    <td>{c.first_name || '—'}</td>
                    <td className="muted">{c.middle_name || '—'}</td>
                    <td className="mono">{c.phone || '—'}</td>
                    <td className="muted">{c.email || '—'}</td>
                    <td className="mono">{balanceCell(bal)}</td>
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
        {filtered.length > 0 && <Pagination page={page} total={filtered.length} pageSize={PAGE_SIZE} onPage={setPage} />}
      </div>

      {cardClient && <ClientCard client={cardClient} rentals={rentals} onClose={() => setCardClient(null)} />}

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
