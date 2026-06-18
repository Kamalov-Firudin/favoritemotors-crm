import React, { useState, useEffect, useCallback } from 'react';
import { fromMinor, fmtMoney, fmtDate } from '../App.jsx';
import BookingForm from './BookingForm.jsx';

const today = () => new Date().toISOString().slice(0, 10);
const newRecord = (status) => ({ car_id: '', client_id: '', issued_at: today(), due_at: '', returned_at: '', amount: '', currency: 'EUR', paid: '', deposit: '', pickup_location: '', return_location: '', pickup_time: '', return_time: '', status, note: '' });

// mode: 'reserved' (вкладка Брони) | 'active' (вкладка Аренда)
export default function Rentals({ mode, onChange }) {
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

  const [returnForm, setReturnForm] = useState(null); // форма возврата

  const load = useCallback(async () => {
    const [r, c, cl] = await Promise.all([rentalsApi.list(), carsApi.list(), clientsApi.list()]);
    setList(r); setCars(c); setClients(cl);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => {
    if (cars.length === 0 || clients.length === 0) return alert('Сначала добавьте хотя бы одну машину и одного клиента.');
    setForm(newRecord(isBooking ? 'reserved' : 'active'));
  };
  const openEdit = (r) => setForm({
    ...r, due_at: r.due_at || '', returned_at: r.returned_at || '',
    pickup_location: r.pickup_location || '', return_location: r.return_location || '',
    amount: fromMinor(r.amount), paid: r.paid ? fromMinor(r.paid) : '', deposit: r.deposit ? fromMinor(r.deposit) : '',
  });
  const onSaved = async () => { setForm(null); await load(); onChange?.(); };

  const issue = async (r) => {
    if (!confirm(`Выдать «${r.car_name}» клиенту ${r.client_name}? Бронь станет арендой.`)) return;
    await rentalsApi.update({ ...r, status: 'active' }); await load(); onChange?.();
  };
  const openReturn = (r) => setReturnForm({
    id: r.id,
    car_name: r.car_name,
    client_name: r.client_name,
    due_at: r.due_at || '',
    returned_at: today(),
    return_time: r.return_time || '',
    amount: fromMinor(r.amount),
    paid: r.paid ? fromMinor(r.paid) : fromMinor(r.amount),
    currency: r.currency,
    note: r.note || '',
    _raw: r, // оригинал для update
  });

  const confirmReturn = async () => {
    const r = returnForm._raw;
    const updated = {
      ...r,
      status: 'completed',
      returned_at: returnForm.returned_at || today(),
      return_time: returnForm.return_time || r.return_time || '',
      amount: Math.round(parseFloat(returnForm.amount || 0) * 100),
      paid: Math.round(parseFloat(returnForm.paid || 0) * 100),
      note: returnForm.note || r.note || '',
    };
    await rentalsApi.update(updated);
    setReturnForm(null);
    await load();
    onChange?.();
  };

  const giveBack = openReturn;
  const cancel = async (r) => {
    if (!confirm(`Отменить бронь «${r.car_name}» (${r.client_name})? Даты освободятся.`)) return;
    await rentalsApi.update({ ...r, status: 'cancelled' }); await load(); onChange?.();
  };
  const remove = async (r) => {
    if (!confirm('Удалить запись полностью?')) return;
    await rentalsApi.remove(r.id); await load(); onChange?.();
  };

  const debt = (r) => Number(r.amount) - Number(r.paid);
  const overdue = (r) => r.status === 'active' && r.due_at && r.due_at < today();

  let rows = list.filter((r) => {
    if (isBooking && r.status !== 'reserved') return false;
    if (!isBooking) {
      if (showHistory) {
        if (r.status !== 'completed' && r.status !== 'cancelled') return false;
      } else {
        if (r.status !== 'active') return false;
      }
    }
    if (filterCar && String(r.car_id) !== filterCar) return false;
    if (filterClient && !`${r.client_name}`.toLowerCase().includes(filterClient.toLowerCase())) return false;
    if (filterFrom && r.issued_at < filterFrom) return false;
    if (filterTo && r.issued_at > filterTo) return false;
    return true;
  });
  rows = isBooking
    ? rows.sort((a, b) => a.issued_at.localeCompare(b.issued_at))
    : showHistory
    ? rows.sort((a, b) => b.issued_at.localeCompare(a.issued_at))
    : rows.sort((a, b) => a.issued_at.localeCompare(b.issued_at));

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
            <button
              className={showHistory ? 'btn' : 'btn ghost'}
              onClick={() => { setShowHistory(!showHistory); clearFilters(); }}
              style={{ fontSize: 13 }}
            >
              {showHistory ? '← Назад к аренде' : 'История'}
            </button>
          )}
          {!showHistory && <button className="btn" onClick={openNew}>+ {isBooking ? 'Новая бронь' : 'Новая аренда'}</button>}
        </div>
      </div>

      {/* Фильтры */}
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
        {hasFilters && (
          <button className="btn ghost sm" onClick={clearFilters} style={{ marginBottom: 2 }}>× Сбросить</button>
        )}
        <span style={{ fontSize: 12, color: 'var(--ink-soft)', marginLeft: 'auto', alignSelf: 'center' }}>
          {rows.length} записей
        </span>
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
              <th>Выдача</th><th>Приём</th><th>Сумма</th><th>Долг</th><th>Статус</th><th></th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.car_name}</b> <span className="muted mono">{r.car_plate || ''}</span></td>
                  <td>{r.client_name}</td>
                  <td className="mono">{fmtDate(r.issued_at)}</td>
                  <td className="mono muted">{r.returned_at ? fmtDate(r.returned_at) : (r.due_at ? (isBooking ? fmtDate(r.due_at) : `до ${fmtDate(r.due_at)}`) : '—')}</td>
                  <td className="muted">{r.pickup_location || '—'}</td>
                  <td className="muted">{r.return_location || '—'}</td>
                  <td className="mono">{fmtMoney(r.amount, r.currency)}</td>
                  <td className="mono" style={{ color: debt(r) > 0 ? 'var(--warn)' : 'var(--ink-soft)' }}>{debt(r) > 0 ? fmtMoney(debt(r), r.currency) : '—'}</td>
                  <td>{statusBadge(r)}</td>
                  <td><div className="row-actions">
                    {r.status === 'reserved' && <button className="btn sm" onClick={() => issue(r)}>Выдать</button>}
                    {r.status === 'active' && <button className="btn ghost sm" onClick={() => giveBack(r)}>Возврат</button>}
                    {(r.status === 'reserved' || r.status === 'active') && <button className="btn ghost sm" onClick={() => openEdit(r)}>Изм.</button>}
                    {r.status === 'reserved' && <button className="btn danger sm" onClick={() => cancel(r)}>Отменить</button>}
                    {r.status === 'completed' || r.status === 'cancelled' ? <button className="btn ghost sm" onClick={() => openEdit(r)}>Изм.</button> : null}
                    <button className="btn danger sm" onClick={() => remove(r)}>Удалить</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && <BookingForm initial={form} cars={cars} clients={clients} onClose={() => setForm(null)} onSaved={onSaved} />}

      {returnForm && (
        <div className="overlay" onClick={(e) => e.target.className === 'overlay' && setReturnForm(null)}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div className="modal-head">
              <h3>Возврат автомобиля</h3>
              <button className="x" onClick={() => setReturnForm(null)}>×</button>
            </div>
            <div className="modal-body">
              {/* Инфо */}
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <div style={{ background: 'var(--paper)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
                  <b>{returnForm.car_name}</b> — {returnForm.client_name}
                  {returnForm.due_at && (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      · план возврата: {fmtDate(returnForm.due_at)}
                      {returnForm.returned_at > returnForm.due_at
                        ? <span style={{ color: 'var(--warn)', marginLeft: 6 }}>⚠ просрочка</span>
                        : returnForm.returned_at < returnForm.due_at
                        ? <span style={{ color: 'var(--ok)', marginLeft: 6 }}>↩ раньше срока</span>
                        : null
                      }
                    </span>
                  )}
                </div>
              </div>

              <div className="field">
                <label>Фактическая дата возврата</label>
                <input type="date" value={returnForm.returned_at}
                  onChange={(e) => setReturnForm({ ...returnForm, returned_at: e.target.value })} />
              </div>
              <div className="field">
                <label>Время возврата</label>
                <input type="time" value={returnForm.return_time}
                  onChange={(e) => setReturnForm({ ...returnForm, return_time: e.target.value })} />
              </div>
              <div className="field">
                <label>Итоговая сумма ({returnForm.currency})</label>
                <input type="number" value={returnForm.amount} step="0.01"
                  onChange={(e) => setReturnForm({ ...returnForm, amount: e.target.value })} />
              </div>
              <div className="field">
                <label>Оплачено ({returnForm.currency})</label>
                <input type="number" value={returnForm.paid} step="0.01"
                  onChange={(e) => setReturnForm({ ...returnForm, paid: e.target.value })} />
              </div>
              <div className="field full" style={{ gridColumn: '1 / -1' }}>
                <label>Заметка при возврате (состояние, повреждения, штраф...)</label>
                <textarea rows={3} value={returnForm.note}
                  onChange={(e) => setReturnForm({ ...returnForm, note: e.target.value })}
                  placeholder="Всё в порядке / царапина на бампере / клиент оплатил штраф за просрочку..."
                />
              </div>

              {/* Итог: долг */}
              {(() => {
                const debt = Math.round((parseFloat(returnForm.amount) || 0) * 100) - Math.round((parseFloat(returnForm.paid) || 0) * 100);
                if (debt <= 0) return null;
                return (
                  <div style={{ gridColumn: '1 / -1', background: '#fdf0ed', border: '1px solid #e8b4a6', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: 'var(--warn)' }}>
                    ⚠ Остаток долга: <b>{fmtMoney(debt, returnForm.currency)}</b>
                  </div>
                );
              })()}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setReturnForm(null)}>Отмена</button>
              <button className="btn" onClick={confirmReturn}>Завершить аренду</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
