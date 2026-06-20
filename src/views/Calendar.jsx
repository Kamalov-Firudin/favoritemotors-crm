import React, { useState, useEffect, useCallback } from 'react';
import { usePerms } from '../lib/perms.js';
import { cars as carsApi, clients as clientsApi, rentals as rentalsApi } from '../lib/api.js';
import { fromMinor } from '../App.jsx';
import BookingForm from './BookingForm.jsx';

const CW = 40;                       // ширина колонки дня
const DAYS = 14;                     // окно в днях
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const todayIso = () => new Date().toISOString().slice(0, 10);
const utc = (iso) => Date.parse(iso + 'T00:00:00Z');
const addDays = (iso, n) => new Date(utc(iso) + n * 86400000).toISOString().slice(0, 10);
const diff = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);

export default function Calendar({ onChange }) {
  const { canWrite } = usePerms();
  const [start, setStart] = useState(addDays(todayIso(), -2));
  const [cars, setCars] = useState([]);
  const [clients, setClients] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [form, setForm] = useState(null);

  const load = useCallback(async () => {
    const [c, cl, r] = await Promise.all([carsApi.list(), clientsApi.list(), rentalsApi.list()]);
    setCars(c.filter((x) => x.status !== 'hidden'));
    setClients(cl); setRentals(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  const today = todayIso();
  const end = addDays(start, DAYS - 1);
  const days = Array.from({ length: DAYS }, (_, i) => {
    const iso = addDays(start, i);
    const d = new Date(utc(iso));
    return { iso, num: d.getUTCDate(), wd: WD[d.getUTCDay()], weekend: [0, 6].includes(d.getUTCDay()), today: iso === today };
  });

  const monthLabel = () => {
    const a = new Date(utc(start)), b = new Date(utc(end));
    const am = MON[a.getUTCMonth()], bm = MON[b.getUTCMonth()];
    return am === bm ? `${am} ${a.getUTCFullYear()}` : `${am} – ${bm} ${b.getUTCFullYear()}`;
  };

  const barFor = (r) => {
    if (r.status === 'cancelled' || r.status === 'completed') return null; // не показываем на сетке
    const s = r.issued_at;
    const e = r.returned_at || r.due_at || end; // без срока — тянем до конца окна
    if (e < start || s > end) return null;       // вне окна
    const si = Math.max(0, diff(start, s));
    const ei = Math.min(DAYS - 1, diff(start, e));
    if (ei < si) return null;
    const debt = Number(r.amount) - Number(r.paid) > 0;
    return { left: si * CW, width: (ei - si + 1) * CW - 4, debt, reserved: r.status === 'reserved' };
  };

  const openNew = (carId, iso) => {
    if (!canWrite) return;
    if (clients.length === 0) return alert('Сначала добавьте хотя бы одного клиента.');
    setForm({ car_id: carId, client_id: '', issued_at: iso, due_at: '', returned_at: '', amount: '', currency: 'EUR', paid: '', deposit: '', pickup_location: '', return_location: '', pickup_time: '', return_time: '', status: 'reserved', note: '' });
  };
  const openEdit = (r) => {
    if (!canWrite) return;
    setForm({
    ...r, due_at: r.due_at || '', returned_at: r.returned_at || '',
    pickup_location: r.pickup_location || '', return_location: r.return_location || '',
    amount: fromMinor(r.amount), paid: r.paid ? fromMinor(r.paid) : '', deposit: r.deposit ? fromMinor(r.deposit) : '',
    });
  };
  const onSaved = async () => { setForm(null); await load(); onChange?.(); };

  return (
    <>
      <div className="head">
        <h1>Календарь</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="muted" style={{ marginRight: 8, textTransform: 'capitalize' }}>{monthLabel()}</span>
          <button className="btn ghost sm" onClick={() => setStart(addDays(start, -7))}>←</button>
          <button className="btn ghost sm" onClick={() => setStart(addDays(todayIso(), -2))}>Сегодня</button>
          <button className="btn ghost sm" onClick={() => setStart(addDays(start, 7))}>→</button>
        </div>
      </div>

      {cars.length === 0 ? (
        <div className="card"><div className="empty"><b>Нет машин</b>Добавьте машины во вкладке «Машины» — они появятся строками календаря.</div></div>
      ) : (
        <div className="cal">
          <div className="cal-row cal-hd">
            <div className="cal-car">Машина</div>
            <div className="cal-track">
              {days.map((d) => (
                <div key={d.iso} className={`cal-cell ${d.weekend ? 'we' : ''} ${d.today ? 'today' : ''}`}>
                  <div className="cal-wd">{d.wd}</div><div className="cal-num">{d.num}</div>
                </div>
              ))}
            </div>
          </div>
          {cars.map((car) => (
            <div className="cal-row" key={car.id}>
              <div className="cal-car">
                <div className="cal-cname">{car.name}</div>
                <div className="cal-cplate mono">{car.plate || '—'}{car.status === 'maintenance' ? ' · ремонт' : ''}</div>
              </div>
              <div className="cal-track">
                {days.map((d) => (
                  <div key={d.iso} className={`cal-cell click ${d.weekend ? 'we' : ''} ${d.today ? 'today' : ''}`}
                       title="Создать бронь" onClick={() => openNew(car.id, d.iso)} />
                ))}
                {rentals.filter((r) => r.car_id === car.id).map((r) => {
                  const b = barFor(r); if (!b) return null;
                  return (
                    <div key={r.id} className={`cal-bar ${b.debt ? 'debt' : ''} ${b.reserved ? 'reserved' : ''}`} style={{ left: b.left, width: b.width }}
                         title={`${b.reserved ? 'Бронь' : 'Аренда'}: ${r.client_name} · ${r.issued_at}${r.due_at ? ' – ' + r.due_at : ''}`}
                         onClick={(e) => { e.stopPropagation(); openEdit(r); }}>
                      {r.client_name}{b.reserved ? ' (бронь)' : ''}{b.debt ? ' · долг' : ''}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="cal-legend">
        <span><span className="sw reserved" /> бронь</span>
        <span><span className="sw teal" /> аренда (оплачено)</span>
        <span><span className="sw amber" /> есть долг</span>
        <span><span className="sw today" /> сегодня</span>
        <span className="muted">пустая клетка → создать бронь, полоса → открыть</span>
      </div>

      {form && <BookingForm initial={form} cars={cars} clients={clients} onClose={() => setForm(null)} onSaved={onSaved} />}
    </>
  );
}
