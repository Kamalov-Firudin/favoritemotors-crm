import React, { useState, useEffect, useCallback } from 'react';
import { cars as carsApi, rentals as rentalsApi } from '../lib/api.js';
import { CURRENCIES, toMinor, fromMinor, fmtMoney } from '../App.jsx';
import CarCard from './CarCard.jsx';

const STATUS = [['free', 'Свободна'], ['maintenance', 'На ремонте'], ['hidden', 'Скрыта']];
const TRANSMISSIONS = ['Автомат', 'Робот', 'Механика', 'Вариатор'];
const BODY_TYPES = ['Хетчбек', 'Седан', 'Универсал', 'Минивен', 'SUV'];
const EMPTY = {
  brand: '', model: '', plate: '', status: 'free',
  body_type: '', color: '', year: '', transmission: '', seats: '',
  purchase_date: '', purchase_price: '', purchase_currency: 'EUR', note: '',
};

export default function Cars({ onChange }) {
  const [rows, setRows] = useState([]);
  const [rentals, setRentals] = useState([]);
  const [form, setForm] = useState(null);
  const [history, setHistory] = useState(null);

  const load = useCallback(async () => {
    const [c, r] = await Promise.all([carsApi.list(), rentalsApi.list()]);
    setRows(c); setRentals(r);
  }, []);
  useEffect(() => { load(); }, [load]);

  const openNew = () => setForm({ ...EMPTY });
  const openEdit = (c) => setForm({ ...EMPTY, ...c, purchase_price: c.purchase_price ? fromMinor(c.purchase_price) : '' });

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.brand.trim() && !form.model.trim()) return alert('Укажите марку или модель');
    const t = (v) => (typeof v === 'string' ? v.trim() || null : v);
    const payload = {
      ...form,
      brand: t(form.brand), model: t(form.model), plate: t(form.plate),
      body_type: t(form.body_type), color: t(form.color), transmission: t(form.transmission) || null,
      purchase_date: t(form.purchase_date),
      purchase_price: toMinor(form.purchase_price), note: t(form.note),
    };
    try {
      if (form.id) await carsApi.update(payload);
      else await carsApi.create(payload);
    } catch (e) {
      const m = String(e?.message || '').match(/PLATE_DUP\|(.*)/);
      if (m) { alert(`Госномер уже используется машиной: ${m[1]}.\nПроверьте — возможно, это та же машина.`); return; }
      throw e;
    }
    setForm(null); await load(); onChange?.();
  };

  const remove = async (c) => {
    if (!confirm(`Удалить «${c.name}»?`)) return;
    try { await carsApi.remove(c.id); await load(); onChange?.(); }
    catch { alert('Нельзя удалить: по машине есть аренды. Поставьте статус «Скрыта».'); }
  };

  return (
    <>
      <div className="head">
        <h1>Машины</h1>
        <button className="btn" onClick={openNew}>+ Добавить машину</button>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><b>Пока нет машин</b>Добавьте первую — она появится в выборе при создании аренды.</div>
        ) : (
          <table>
            <thead><tr><th>Марка / модель</th><th>Госномер</th><th>Тип</th><th>Год</th><th>Коробка</th><th>Статус</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.name}</b>{c.color ? <span className="muted"> · {c.color}</span> : ''}</td>
                  <td className="mono">{c.plate || '—'}</td>
                  <td className="muted">{c.body_type || '—'}</td>
                  <td className="mono muted">{c.year || '—'}</td>
                  <td className="muted">{c.transmission || '—'}</td>
                  <td><span className={`badge ${c.status}`}>{STATUS.find((s) => s[0] === c.status)?.[1] || c.status}</span></td>
                  <td><div className="row-actions">
                    <button className="btn ghost sm" onClick={() => setHistory(c)}>История</button>
                    <button className="btn ghost sm" onClick={() => openEdit(c)}>Изм.</button>
                    <button className="btn danger sm" onClick={() => remove(c)}>Удалить</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form && (
        <div className="overlay" onClick={(e) => e.target.className === 'overlay' && setForm(null)}>
          <div className="modal">
            <div className="modal-head"><h3>{form.id ? 'Изменить машину' : 'Новая машина'}</h3><button className="x" onClick={() => setForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field"><label>Марка *</label><input value={form.brand} onChange={set('brand')} placeholder="Hyundai" /></div>
              <div className="field"><label>Модель</label><input value={form.model} onChange={set('model')} placeholder="Accent" /></div>
              <div className="field"><label>Госномер</label><input value={form.plate} onChange={set('plate')} placeholder="07 ABC 123" /></div>
              <div className="field"><label>Статус</label><select value={form.status} onChange={set('status')}>{STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div className="field"><label>Тип кузова</label>
                <select value={form.body_type || ''} onChange={set('body_type')}>
                  <option value="">— не указано —</option>
                  {BODY_TYPES.map((t) => <option key={t}>{t}</option>)}
                  {form.body_type && !BODY_TYPES.includes(form.body_type) && <option>{form.body_type}</option>}
                </select>
              </div>
              <div className="field"><label>Цвет</label><input value={form.color} onChange={set('color')} /></div>
              <div className="field"><label>Год</label><input value={form.year} onChange={set('year')} placeholder="2020" /></div>
              <div className="field"><label>Коробка</label><select value={form.transmission} onChange={set('transmission')}><option value="">— не указано —</option>{TRANSMISSIONS.map((t) => <option key={t}>{t}</option>)}</select></div>
              <div className="field"><label>Кол-во мест</label><input value={form.seats} onChange={set('seats')} placeholder="5" /></div>
              <div className="field"></div>
              <div className="field"><label>Дата покупки</label><input type="date" value={form.purchase_date || ''} onChange={set('purchase_date')} /></div>
              <div className="field"><label>Цена покупки</label><div className="amount-row"><input value={form.purchase_price} onChange={set('purchase_price')} placeholder="0.00" /><select value={form.purchase_currency} onChange={set('purchase_currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
              <div className="field full"><label>Заметка</label><textarea value={form.note} onChange={set('note')} /></div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setForm(null)}>Отмена</button><button className="btn" onClick={save}>Сохранить</button></div>
          </div>
        </div>
      )}

      {history && <CarCard car={history} rentals={rentals} onClose={() => setHistory(null)} onChange={() => { load(); onChange?.(); }} />}
    </>
  );
}
