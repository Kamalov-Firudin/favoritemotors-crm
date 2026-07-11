import React, { useState, useEffect, useCallback } from 'react';
import { cars as carsApi, clients as clientsApi, rentals as rentalsApi, maintenance as maintenanceApi, payments as paymentsApi } from '../lib/api.js';
import { fromMinor, fmtMoney, fmtDate, rentalDays, rentalDaysT } from '../App.jsx';
import { usePerms } from '../lib/perms.js';
import BookingForm from './BookingForm.jsx';
import PaymentsPanel from './PaymentsPanel.jsx';
import Pagination from './Pagination.jsx';
import { toast, confirmDialog } from '../lib/ui.jsx';

const PAGE_SIZE = 50;

const today = () => new Date().toISOString().slice(0, 10);
const newRecord = (status) => ({ car_id: '', client_id: '', issued_at: today(), due_at: '', returned_at: '', amount: '', currency: 'EUR', paid: '', deposit: '', rental_price: '', daily_price: '', extra_fee: '', extra_note: '', km_out: '', km_in: '', km_limit: '', over_km_price: '', pickup_location: '', return_location: '', pickup_time: '', return_time: '', status, note: '' });

export default function Rentals({ mode, onChange }) {
  const { canWrite } = usePerms();
  const isBooking = mode === 'reserved';
  const [list, setList] = useState([]);
  const [cars, setCars] = useState([]);
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState(null);
  const [filterCar, setFilterCar] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterFrom, setFilterFrom] = useState('');
  const [filterTo, setFilterTo] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [filterCar, filterClient, filterFrom, filterTo, showHistory, mode]);

  const [returnForm, setReturnForm] = useState(null); // форма возврата
  const [issueForm, setIssueForm] = useState(null);   // форма выдачи (пробег)
  const [extendForm, setExtendForm] = useState(null); // форма продления
  const [paymentsFor, setPaymentsFor] = useState(null); // журнал платежей аренды

  const load = useCallback(async () => {
    const [r, c, cl] = await Promise.all([rentalsApi.list(), carsApi.list(), clientsApi.list()]);
    setList(r); setCars(c); setClients(cl);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    if (cars.length === 0 || clients.length === 0) return toast('Сначала добавьте хотя бы одну машину и одного клиента.');
    setForm(newRecord(isBooking ? 'reserved' : 'active'));
  };
  const openEdit = (r) => setForm({
    ...r, due_at: r.due_at || '', returned_at: r.returned_at || '',
    pickup_location: r.pickup_location || '', return_location: r.return_location || '',
    amount: fromMinor(r.amount), paid: r.paid ? fromMinor(r.paid) : '', deposit: r.deposit ? fromMinor(r.deposit) : '',
    daily_price: r.daily_price != null ? fromMinor(r.daily_price) : '', extra_fee: r.extra_fee != null ? fromMinor(r.extra_fee) : '',
    rental_price: r.rental_price != null ? fromMinor(r.rental_price) : '',
    km_limit: r.km_limit ?? '', over_km_price: r.over_km_price != null ? fromMinor(r.over_km_price) : '',
    extra_note: r.extra_note || '', km_out: r.km_out ?? '', km_in: r.km_in ?? '',
  });
  const onSaved = async () => { setForm(null); await load(); onChange?.(); };

  // ── Выдача (бронь → аренда), с пробегом ──
  const issue = (r) => setIssueForm({ _raw: r, car_name: r.car_name, client_name: r.client_name, km_out: r.km_out ?? '' });
  const confirmIssue = async () => {
    const r = issueForm._raw;
    const km = issueForm.km_out !== '' ? parseInt(String(issueForm.km_out).replace(/\s/g, ''), 10) : null;
    await rentalsApi.update({ ...r, status: 'active', km_out: Number.isFinite(km) ? km : null });
    setIssueForm(null); await load(); onChange?.();
  };

  // ── Возврат ──
  // Сумма по факту: дни × цена/день + доплата + доплата за перепробег.
  // Перепробег = пробег − (лимит/день × дни), доплата = перепробег × цена за км.
  const overageMinor = (r, dateStr, kmIn, retTime) => {
    if (!r.km_limit || !r.over_km_price || r.km_out == null || !Number.isFinite(kmIn)) return 0;
    const days = rentalDaysT(r.issued_at, r.pickup_time, dateStr || today(), retTime);
    const allowance = r.km_limit * days;
    const over = Math.max(0, (kmIn - r.km_out) - allowance);
    return over * r.over_km_price;
  };
  const overageInfo = (r, dateStr, kmInStr, retTime) => {
    const kmIn = parseInt(String(kmInStr ?? '').replace(/\s/g, ''), 10);
    if (!r.km_limit || !r.over_km_price || r.km_out == null || !Number.isFinite(kmIn)) return null;
    const days = rentalDaysT(r.issued_at, r.pickup_time, dateStr || today(), retTime);
    const allowance = r.km_limit * days;
    const dist = kmIn - r.km_out;
    const over = Math.max(0, dist - allowance);
    return { days, allowance, dist, over, charge: over * r.over_km_price };
  };
  const recalcAmount = (r, dateStr, kmInStr, retTime) => {
    const kmIn = parseInt(String(kmInStr ?? '').replace(/\s/g, ''), 10);
    const over = overageMinor(r, dateStr, Number.isFinite(kmIn) ? kmIn : NaN, retTime);
    const actualDays = rentalDaysT(r.issued_at, r.pickup_time, dateStr || today(), retTime);
    if (r.rental_price) {
      const plannedDays = rentalDaysT(r.issued_at, r.pickup_time, r.due_at || dateStr || today(), r.return_time);
      const base = plannedDays > 0 ? Math.round(r.rental_price * actualDays / plannedDays) : r.rental_price;
      return ((base + (r.extra_fee || 0) + over) / 100).toFixed(2);
    }
    if (r.daily_price) {
      return ((r.daily_price * actualDays + (r.extra_fee || 0) + over) / 100).toFixed(2);
    }
    return ((Number(r.amount) + over) / 100).toFixed(2);
  };
  const openReturn = (r) => {
    const recomputed = recalcAmount(r, today(), r.km_in ?? '', r.return_time || '');
    setReturnForm({
      id: r.id, car_name: r.car_name, client_name: r.client_name,
      due_at: r.due_at || '', returned_at: today(), return_time: r.return_time || '',
      amount: recomputed,
      // «Оплата при возврате» по умолчанию = остаток долга (итог − уже оплачено)
      paid: fromMinor(Math.max(0, Math.round(parseFloat(recomputed) * 100) - Number(r.paid || 0))),
      currency: r.currency, note: r.note || '',
      km_out: r.km_out ?? '', km_in: r.km_in ?? '',
      _raw: r,
    });
  };
  const confirmReturn = async () => {
    const r = returnForm._raw;
    const kmIn = returnForm.km_in !== '' ? parseInt(String(returnForm.km_in).replace(/\s/g, ''), 10) : null;
    const payMinor = Math.round(parseFloat(returnForm.paid || 0) * 100); // оплата именно при этом возврате
    const updated = {
      ...r,
      status: 'completed',
      returned_at: returnForm.returned_at || today(),
      return_time: returnForm.return_time || r.return_time || '',
      amount: Math.round(parseFloat(returnForm.amount || 0) * 100),
      km_in: Number.isFinite(kmIn) ? kmIn : null,
      note: returnForm.note || r.note || '',
    };
    await rentalsApi.update(updated); // paid не пишем — им управляет журнал платежей
    if (payMinor !== 0) {
      await paymentsApi.add({ rental_id: r.id, paid_at: returnForm.returned_at || today(), amount: payMinor, currency: r.currency });
    }
    // обновляем текущий пробег машины в техсостоянии → сработает уведомление о масле
    if (Number.isFinite(kmIn)) {
      try { await maintenanceApi.setCurrentKm(r.car_id, kmIn); } catch (e) { /* нет записи техсостояния — не критично */ }
    }
    setReturnForm(null); await load(); onChange?.();
  };

  // ── Продление активной аренды ──
  const openExtend = (r) => setExtendForm({ _raw: r, car_name: r.car_name, client_name: r.client_name, due_at: r.due_at || today() });
  const confirmExtend = async () => {
    const r = extendForm._raw;
    const newDue = extendForm.due_at;
    if (!newDue) return toast('Укажите новую дату возврата.');
    if (r.due_at && newDue < r.due_at) {
      if (!(await confirmDialog('Новая дата раньше прежней — сократить срок?'))) return;
    }
    // пересчёт суммы при продлении
    let amount = r.amount;
    if (r.rental_price && r.due_at) {
      const oldDays = rentalDaysT(r.issued_at, r.pickup_time, r.due_at, r.return_time);
      const newDays = rentalDaysT(r.issued_at, r.pickup_time, newDue, r.return_time);
      amount = oldDays > 0 ? Math.round(r.rental_price * newDays / oldDays) + (r.extra_fee || 0) : r.amount;
    } else if (r.daily_price) {
      const days = rentalDaysT(r.issued_at, r.pickup_time, newDue, r.return_time);
      amount = r.daily_price * days + (r.extra_fee || 0);
    }
    try {
      await rentalsApi.update({ ...r, due_at: newDue, amount });
    } catch (e) {
      const m = String(e?.message || '').match(/CONFLICT\|([^|]*)\|([^|]*)\|([^|]*)/);
      if (m) { toast(`Нельзя продлить: на эти даты уже есть бронь этой машины (${m[1]}). Выберите другую дату.`, 'error'); return; }
      throw e;
    }
    setExtendForm(null); await load(); onChange?.();
  };

  const giveBack = openReturn;
  const cancel = async (r) => {
    if (!(await confirmDialog(`Отменить бронь «${r.car_name}» (${r.client_name})? Даты освободятся.`, { danger: true, okText: 'Отменить бронь' }))) return;
    await rentalsApi.update({ ...r, status: 'cancelled' }); await load(); onChange?.();
  };
  const remove = async (r) => {
    if (!(await confirmDialog('Скрыть запись в корзину? Данные сохранятся, можно восстановить.', { okText: 'Скрыть' }))) return;
    await rentalsApi.remove(r.id); await load(); onChange?.();
  };

  const debt = (r) => Number(r.amount) - Number(r.paid);
  const overdue = (r) => r.status === 'active' && r.due_at && r.due_at < today();

  let rows = list.filter((r) => {
    if (isBooking && r.status !== 'reserved') return false;
    if (!isBooking) {
      if (showHistory) { if (r.status !== 'completed' && r.status !== 'cancelled') return false; }
      else { if (r.status !== 'active') return false; }
    }
    if (filterCar && String(r.car_id) !== filterCar) return false;
    if (filterClient && !`${r.client_name}`.toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterFrom && r.issued_at < filterFrom) return false;
    if (filterTo && r.issued_at > filterTo) return false;
    return true;
  });
  rows = isBooking
    ? rows.sort((a, b) => a.issued_at.localeCompare(b.issued_at))
    : showHistory ? rows.sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    : rows.sort((a, b) => a.issued_at.localeCompare(b.issued_at));

  const totalRows = rows.length;
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hasFilters = filterCar || filterClient || filterFrom || filterTo;
  const clearFilters = () => { setFilterCar(''); setFilterClient(''); setFilterFrom(''); setFilterTo(''); };

  const statusBadge = (r) => {
    if (r.status === 'reserved') return <span className="badge out">Бронь</span>;
    if (r.status === 'active') return <span className={`badge ${overdue(r) ? 'maintenance' : 'out'}`}>{overdue(r) ? 'Просрочка' : 'В аренде'}</span>;
    if (r.status === 'completed') return <span className="badge done">Завершена</span>;
    return <span className="badge done">Отменена</span>;
  };

  return (
    <>
      <div className="head">
        <h1>{isBooking ? 'Брони' : (showHistory ? 'История аренд' : 'Аренда')}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!isBooking && (
            <button className={showHistory ? 'btn' : 'btn ghost'} onClick={() => { setShowHistory(!showHistory); clearFilters(); }} style={{ fontSize: 13 }}>
              {showHistory ? '← Назад к аренде' : 'История'}
            </button>
          )}
          {!showHistory && canWrite && <button className="btn" onClick={openNew}>+ {isBooking ? 'Новая бронь' : 'Новая аренда'}</button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label style={{ fontSize: 11 }}>Машина</label>
          <select value={filterCar} onChange={(e) => setFilterCar(e.target.value)}>
            <option value="">Все машины</option>
            {cars.map((c) => <option key={c.id} value={String(c.id)}>{c.name} {c.plate ? `· ${c.plate}` : ''}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0, minWidth: 160 }}>
          <label style={{ fontSize: 11 }}>Клиент</label>
          <input value={filterClient} onChange={(e) => setFilterClient(e.target.value)} placeholder="Поиск по имени..." />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 11 }}>С</label>
          <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={{ width: 140 }} />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label style={{ fontSize: 11 }}>По</label>
          <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={{ width: 140 }} />
        </div>
        {hasFilters && <button className="btn ghost sm" onClick={clearFilters} style={{ marginBottom: 2 }}>× Сбросить</button>}
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginLeft: 'auto', alignSelf: 'center' }}>{rows.length} записей</span>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty">
            <b>{hasFilters ? 'Ничего не найдено' : (isBooking ? 'Броней пока нет' : 'Аренд пока нет')}</b>
            {!hasFilters && (isBooking ? 'Нажмите «Новая бронь», чтобы зарезервировать машину на даты.' : 'Нажмите «Новая аренда» или выдайте машину из раздела «Брони».')}
            {hasFilters && <button className="btn ghost sm" onClick={clearFilters} style={{ marginTop: 8 }}>Сбросить фильтры</button>}
          </div>
        ) : (
          <table>
            <thead><tr>
              <th>Машина</th><th>Клиент</th><th>{isBooking ? 'С' : 'Выдана'}</th><th>{isBooking ? 'По' : 'Возврат'}</th>
              <th>Выдача</th><th>Приём</th><th>Пробег</th><th>Сумма</th><th>Долг</th><th>Статус</th><th></th>
            </tr></thead>
            <tbody>
              {pageRows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.car_name}</b> <span className="muted mono">{r.car_plate || ''}</span></td>
                  <td>{r.client_name}</td>
                  <td className="mono">{fmtDate(r.issued_at)}</td>
                  <td className="mono muted">{r.returned_at ? fmtDate(r.returned_at) : (r.due_at ? (isBooking ? fmtDate(r.due_at) : `до ${fmtDate(r.due_at)}`) : '—')}</td>
                  <td className="muted">{r.pickup_location || '—'}</td>
                  <td className="muted">{r.return_location || '—'}</td>
                  <td className="mono muted">{(() => {
                    if (r.km_out != null && r.km_in != null) {
                      const d = r.km_in - r.km_out;
                      return <span title={`${Number(r.km_out).toLocaleString()} → ${Number(r.km_in).toLocaleString()}`} style={d < 0 ? { color: 'var(--warn)' } : undefined}>{d.toLocaleString()} км</span>;
                    }
                    if (r.km_out != null) return <span title="пробег при выдаче" style={{ fontSize: 11 }}>от {Number(r.km_out).toLocaleString()}</span>;
                    return '—';
                  })()}</td>
                  <td className="mono">{fmtMoney(r.amount, r.currency)}</td>
                  <td className="mono">{(() => {
                    const d = debt(r);
                    if (d > 0) return <span style={{ color: 'var(--warn)' }}>{fmtMoney(d, r.currency)}</span>;
                    if (d < 0) return <span style={{ color: '#3B6D11' }} title="переплата, к возврату клиенту">+{fmtMoney(-d, r.currency)}</span>;
                    return <span style={{ color: 'var(--ink-soft)' }}>—</span>;
                  })()}</td>
                  <td>{statusBadge(r)}</td>
                  <td><div className="row-actions">
                    {canWrite && r.status === 'reserved' && <button className="btn sm" onClick={() => issue(r)}>Выдать</button>}
                    {canWrite && r.status === 'active' && <button className="btn ghost sm" onClick={() => openExtend(r)}>Продлить</button>}
                    {canWrite && r.status === 'active' && <button className="btn ghost sm" onClick={() => giveBack(r)}>Возврат</button>}
                    {canWrite && (r.status === 'reserved' || r.status === 'active') && <button className="btn ghost sm" onClick={() => openEdit(r)}>Изм.</button>}
                    {canWrite && r.status === 'reserved' && <button className="btn danger sm" onClick={() => cancel(r)}>Отменить</button>}
                    {canWrite && (r.status === 'completed' || r.status === 'cancelled') ? <button className="btn ghost sm" onClick={() => openEdit(r)}>Изм.</button> : null}
                    <button className="btn ghost sm" onClick={() => setPaymentsFor(r)}>Платежи</button>
                    {canWrite && <button className="btn ghost sm" onClick={() => remove(r)}>Скрыть</button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {rows.length > 0 && <Pagination page={page} total={totalRows} pageSize={PAGE_SIZE} onPage={setPage} />}
      </div>

      {form && <BookingForm initial={form} cars={cars} clients={clients} rentals={list} onClose={() => setForm(null)} onSaved={onSaved} />}

      {paymentsFor && <PaymentsPanel rental={paymentsFor} onClose={() => setPaymentsFor(null)} onChanged={load} />}

      {/* Выдача с пробегом */}
      {issueForm && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head"><h3>Выдача автомобиля</h3><button className="x" onClick={() => setIssueForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <b>{issueForm.car_name}</b> — {issueForm.client_name}. Бронь станет арендой.
                </div>
              </div>
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <label>Пробег при выдаче (км)</label>
                <input type="number" value={issueForm.km_out} onChange={(e) => setIssueForm({ ...issueForm, km_out: e.target.value })} placeholder="118 000" autoFocus />
              </div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setIssueForm(null)}>Отмена</button><button className="btn" onClick={confirmIssue}>Выдать</button></div>
          </div>
        </div>
      )}

      {/* Продление */}
      {extendForm && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head"><h3>Продлить аренду</h3><button className="x" onClick={() => setExtendForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <b>{extendForm.car_name}</b> — {extendForm.client_name}
                  {extendForm._raw.due_at && <span className="muted" style={{ marginLeft: 8 }}>· было до {fmtDate(extendForm._raw.due_at)}</span>}
                </div>
              </div>
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <label>Новая дата возврата</label>
                <input type="date" value={extendForm.due_at} onChange={(e) => setExtendForm({ ...extendForm, due_at: e.target.value })} autoFocus />
              </div>
              {(extendForm._raw.rental_price || extendForm._raw.daily_price) ? (
                <div className="field full" style={{ gridColumn: '1 / -1' }}>
                  {extendForm._raw.rental_price && extendForm._raw.due_at
                    ? <div className="hint">Новый итог пропорционально сроку: <b>{(() => { const o = rentalDaysT(extendForm._raw.issued_at, extendForm._raw.pickup_time, extendForm._raw.due_at, extendForm._raw.return_time); const n = rentalDaysT(extendForm._raw.issued_at, extendForm._raw.pickup_time, extendForm.due_at, extendForm._raw.return_time); return o > 0 ? fromMinor(Math.round(extendForm._raw.rental_price * n / o) + (extendForm._raw.extra_fee || 0)) : fromMinor(extendForm._raw.amount); })()} {extendForm._raw.currency}</b> ({rentalDaysT(extendForm._raw.issued_at, extendForm._raw.pickup_time, extendForm.due_at, extendForm._raw.return_time)} дн)</div>
                    : <div className="hint">Новый итог: {rentalDaysT(extendForm._raw.issued_at, extendForm._raw.pickup_time, extendForm.due_at, extendForm._raw.return_time)} дн × {fromMinor(extendForm._raw.daily_price)} {extendForm._raw.currency}{extendForm._raw.extra_fee ? ` + доп ${fromMinor(extendForm._raw.extra_fee)}` : ''} = <b>{fromMinor(extendForm._raw.daily_price * rentalDaysT(extendForm._raw.issued_at, extendForm._raw.pickup_time, extendForm.due_at, extendForm._raw.return_time) + (extendForm._raw.extra_fee || 0))} {extendForm._raw.currency}</b></div>}
                </div>
              ) : null}
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setExtendForm(null)}>Отмена</button><button className="btn" onClick={confirmExtend}>Продлить</button></div>
          </div>
        </div>
      )}

      {/* Возврат */}
      {returnForm && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 520 }}>
            <div className="modal-head"><h3>Возврат автомобиля</h3><button className="x" onClick={() => setReturnForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <b>{returnForm.car_name}</b> — {returnForm.client_name}
                  {returnForm.due_at && (
                    <span className="muted" style={{ marginLeft: 8 }}>· план возврата: {fmtDate(returnForm.due_at)}
                      {returnForm.returned_at > returnForm.due_at ? <span style={{ color: 'var(--warn)', marginLeft: 6 }}>⚠ просрочка</span>
                        : returnForm.returned_at < returnForm.due_at ? <span style={{ color: 'var(--ok)', marginLeft: 6 }}>↩ раньше срока</span> : null}
                    </span>
                  )}
                </div>
              </div>

              <div className="field"><label>Фактическая дата возврата</label>
                <input type="date" value={returnForm.returned_at} onChange={(e) => {
                  const date = e.target.value;
                  const r = returnForm._raw;
                  setReturnForm({ ...returnForm, returned_at: date, amount: recalcAmount(r, date, returnForm.km_in, returnForm.return_time) });
                }} /></div>
              <div className="field"><label>Время возврата</label>
                <input type="time" value={returnForm.return_time} onChange={(e) => { const v = e.target.value; setReturnForm({ ...returnForm, return_time: v, amount: recalcAmount(returnForm._raw, returnForm.returned_at, returnForm.km_in, v) }); }} /></div>

              {(returnForm._raw.rental_price || returnForm._raw.daily_price) ? (
                <div className="field full" style={{ gridColumn: '1 / -1' }}>
                  <div className="hint">
                    {returnForm._raw.rental_price
                      ? <>По факту: <b>{rentalDaysT(returnForm._raw.issued_at, returnForm._raw.pickup_time, returnForm.returned_at, returnForm.return_time)} дн</b> из {rentalDaysT(returnForm._raw.issued_at, returnForm._raw.pickup_time, returnForm._raw.due_at, returnForm._raw.return_time)} оплаченных · итог <b>{recalcAmount(returnForm._raw, returnForm.returned_at, returnForm.km_in, returnForm.return_time)} {returnForm.currency}</b></>
                      : <>По факту: <b>{rentalDaysT(returnForm._raw.issued_at, returnForm._raw.pickup_time, returnForm.returned_at, returnForm.return_time)} дн</b> × {fromMinor(returnForm._raw.daily_price)} {returnForm.currency}{returnForm._raw.extra_fee ? ` + доп ${fromMinor(returnForm._raw.extra_fee)}` : ''} = <b>{recalcAmount(returnForm._raw, returnForm.returned_at, returnForm.km_in, returnForm.return_time)} {returnForm.currency}</b></>}
                    {returnForm.due_at && returnForm.returned_at < returnForm.due_at && <span style={{ color: 'var(--ok)', marginLeft: 6 }}>· вернул раньше, пересчитано</span>}
                    {returnForm.due_at && returnForm.returned_at > returnForm.due_at && <span style={{ color: 'var(--warn)', marginLeft: 6 }}>· дольше срока, пересчитано</span>}
                  </div>
                </div>
              ) : null}

              {/* Пробег */}
              <div className="field"><label>Пробег при выдаче (км)</label>
                <input type="number" value={returnForm.km_out} disabled style={{ background: 'var(--paper)' }} /></div>
              <div className="field"><label>Пробег при возврате (км)</label>
                <input type="number" value={returnForm.km_in} onChange={(e) => { const v = e.target.value; setReturnForm({ ...returnForm, km_in: v, amount: recalcAmount(returnForm._raw, returnForm.returned_at, v, returnForm.return_time) }); }} placeholder="напр. 118 540" /></div>
              {(() => {
                const out = parseInt(String(returnForm.km_out).replace(/\s/g, ''), 10);
                const inn = parseInt(String(returnForm.km_in).replace(/\s/g, ''), 10);
                if (!Number.isFinite(out) || !Number.isFinite(inn)) return null;
                const drove = inn - out;
                return (
                  <div className="field full" style={{ gridColumn: '1 / -1' }}>
                    <div className="hint" style={drove < 0 ? { color: 'var(--warn)' } : undefined}>
                      Проехал: <b>{drove.toLocaleString()} км</b>{drove < 0 ? ' — пробег при возврате меньше, проверьте ввод' : ''}
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const o = overageInfo(returnForm._raw, returnForm.returned_at, returnForm.km_in, returnForm.return_time);
                if (!o) return null;
                const r = returnForm._raw;
                return (
                  <div className="field full" style={{ gridColumn: '1 / -1' }}>
                    <div className="hint" style={o.over > 0 ? { background: '#fdf0ed', borderColor: '#e8b4a6', color: 'var(--warn)' } : { background: '#eef5ef', borderColor: '#b6d3bd', color: '#3B6D11' }}>
                      Лимит: {r.km_limit}/дн × {o.days} = <b>{o.allowance.toLocaleString()} км</b> · проехал {o.dist.toLocaleString()} ·{' '}
                      {o.over > 0
                        ? <>перепробег <b>{o.over.toLocaleString()} км</b> × {fromMinor(r.over_km_price)} = <b>{fromMinor(o.charge)} {returnForm.currency}</b> (добавлено к итогу)</>
                        : <>в пределах лимита, доплаты нет</>}
                    </div>
                  </div>
                );
              })()}

              <div className="field"><label>Итоговая сумма ({returnForm.currency})</label>
                <input type="number" value={returnForm.amount} step="0.01" onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })} /></div>
              <div className="field"><label>Оплата при возврате ({returnForm.currency})</label>
                <input type="number" value={returnForm.paid} step="0.01" onChange={(e) => setReturnForm({ ...returnForm, paid: e.target.value })} />
                {Number(returnForm._raw.paid || 0) > 0 && <div className="hint" style={{ marginTop: 4 }}>Ранее уже оплачено: <b>{fmtMoney(returnForm._raw.paid, returnForm.currency)}</b></div>}</div>

              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <label>Заметка при возврате (состояние, повреждения, штраф...)</label>
                <textarea rows={3} value={returnForm.note} onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
                  placeholder="Всё в порядке / царапина на бампере / оплачен штраф за просрочку..." />
              </div>

              {(() => {
                const already = Number(returnForm._raw.paid || 0);
                const amt = Math.round((parseFloat(returnForm.amount) || 0) * 100);
                const payNow = Math.round((parseFloat(returnForm.paid) || 0) * 100);
                const d = amt - (already + payNow); // остаток после этого платежа
                if (d > 0) return <div style={{ gridColumn: '1 / -1', background: '#fdf0ed', border: '1px solid #e8b4a6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--warn)' }}>⚠ Останется долг: <b>{fmtMoney(d, returnForm.currency)}</b></div>;
                if (d < 0) return <div style={{ gridColumn: '1 / -1', background: '#eef5ef', border: '1px solid #b6d3bd', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#3B6D11' }}>↩ Переплата, к возврату клиенту: <b>{fmtMoney(-d, returnForm.currency)}</b></div>;
                return null;
              })()}
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setReturnForm(null)}>Отмена</button><button className="btn" onClick={confirmReturn}>Завершить аренду</button></div>
          </div>
        </div>
      )}
    </>
  );
}
