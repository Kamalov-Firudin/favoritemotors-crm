import React, { useState, useEffect, useRef } from 'react';
import { cars as carsApi, clients as clientsApi, rentals as rentalsApi } from '../lib/api.js';
import { CURRENCIES, rentalDays, rentalDaysT, clientBalance, fmtMoney } from '../App.jsx';
import ClientPicker from './ClientPicker.jsx';

const toMinor = (s) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const toInt = (s) => { const n = parseInt(String(s ?? '').replace(/\s/g, ''), 10); return Number.isFinite(n) ? n : null; };
const today = () => new Date().toISOString().slice(0, 10);

function conflictMessage(e) {
  const m = String(e?.message || '').match(/CONFLICT\|([^|]*)\|([^|]*)\|([^|]*)/);
  if (!m) return null;
  const f = (d) => (d ? d.split('-').reverse().join('.') : '');
  const [, name, start, end] = m;
  return `Эта машина уже выдана на пересекающиеся даты: ${name}, с ${f(start)}${end ? ` по ${f(end)}` : ''}.\nВыберите другие даты или другую машину.`;
}

export default function BookingForm({ initial, cars, clients, rentals, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  // была ли сумма отредактирована вручную — тогда авто-итог её не перезатирает
  const amountTouched = useRef(!!(initial.id && initial.amount && !initial.rental_price && !initial.daily_price));
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const isActive = form.status === 'active';
  const days = rentalDaysT(form.issued_at, form.pickup_time, form.returned_at || form.due_at, form.return_time);
  const priceNum = parseFloat(String(form.rental_price ?? '').replace(',', '.')) || 0;       // цена за весь срок
  const dailyNum = parseFloat(String(form.daily_price ?? '').replace(',', '.')) || 0;        // legacy (старые аренды)
  const extraNum = parseFloat(String(form.extra_fee ?? '').replace(',', '.')) || 0;
  const base = priceNum > 0 ? priceNum : (dailyNum > 0 ? dailyNum * days : 0);
  const computed = (priceNum > 0 || dailyNum > 0) ? (base + extraNum) : null;

  // Авто-итог: подставляем рассчитанную сумму, пока её не трогали руками
  useEffect(() => {
    if (!amountTouched.current && computed != null) {
      setForm((f) => ({ ...f, amount: computed.toFixed(2) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.rental_price, form.daily_price, form.extra_fee, form.issued_at, form.due_at, form.returned_at, form.pickup_time, form.return_time]);

  const onAmount = (e) => { amountTouched.current = true; setForm({ ...form, amount: e.target.value }); };

  const save = async () => {
    if (!form.car_id || !form.client_id) return alert('Выберите машину и клиента');
    if (!form.issued_at) return alert('Укажите дату выдачи');
    // запрет: активную аренду нельзя выдать будущей датой (это бронь, не аренда)
    if (isActive && form.issued_at > today()) {
      return alert('Дата выдачи в будущем — это бронь, а не аренда.\nДля будущей даты создайте бронь во вкладке «Брони», либо поставьте сегодняшнюю дату.');
    }
    const client = clients.find((c) => c.id === Number(form.client_id));
    if (client?.category === 'Чёрный список') {
      if (!confirm(`Клиент в чёрном списке: ${client.name}.\nВсё равно оформить?`)) return;
    }
    const t = (v) => (typeof v === 'string' ? v.trim() || null : v);
    const payload = {
      ...form,
      car_id: Number(form.car_id), client_id: Number(form.client_id),
      due_at: form.due_at || null, returned_at: form.returned_at || null,
      amount: toMinor(form.amount), paid: toMinor(form.paid), deposit: toMinor(form.deposit),
      daily_price: form.daily_price !== '' && form.daily_price != null ? toMinor(form.daily_price) : null,
      rental_price: form.rental_price !== '' && form.rental_price != null ? toMinor(form.rental_price) : null,
      extra_fee: form.extra_fee !== '' && form.extra_fee != null ? toMinor(form.extra_fee) : null,
      extra_note: t(form.extra_note),
      km_out: form.km_out !== '' && form.km_out != null ? toInt(form.km_out) : null,
      km_in: form.km_in !== '' && form.km_in != null ? toInt(form.km_in) : null,
      km_limit: form.km_limit !== '' && form.km_limit != null ? toInt(form.km_limit) : null,
      over_km_price: form.over_km_price !== '' && form.over_km_price != null ? toMinor(form.over_km_price) : null,
      pickup_location: t(form.pickup_location), return_location: t(form.return_location),
      pickup_time: form.pickup_time || null, return_time: form.return_time || null,
      note: t(form.note),
    };
    try {
      if (form.id) await rentalsApi.update(payload);
      else await rentalsApi.create(payload);
    } catch (e) {
      const msg = conflictMessage(e);
      if (msg) { alert(msg); return; }
      throw e;
    }
    onSaved();
  };

  const selClient = clients.find((c) => c.id === Number(form.client_id));

  return (
    <div className="overlay">
      <div className="modal">
        <div className="modal-head"><h3>{form.id ? (form.status === 'reserved' ? 'Изменить бронь' : 'Изменить аренду') : (isActive ? 'Новая аренда' : 'Новая бронь')}</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="field"><label>Машина *</label>
            <select value={form.car_id} onChange={set('car_id')}>
              <option value="">— выбрать —</option>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plate ? ` (${c.plate})` : ''}</option>)}
            </select>
          </div>
          <ClientPicker clients={clients} value={form.client_id} onChange={(id) => setForm({ ...form, client_id: id })} />
          {(() => {
            if (!form.client_id) return null;
            const bal = clientBalance(rentals, Number(form.client_id), form.id);
            const debt = Object.entries(bal).filter(([, v]) => v > 0);
            const credit = Object.entries(bal).filter(([, v]) => v < 0);
            if (!debt.length && !credit.length) return null;
            return (
              <div className="field full">
                {credit.length > 0 && <div className="hint" style={{ background: '#eef5ef', borderColor: '#b6d3bd', color: '#3B6D11' }}>↩ В пользу клиента с прошлых аренд: <b>{credit.map(([c, v]) => fmtMoney(-v, c)).join(' · ')}</b> — можно зачесть в оплату (впишите в «Оплачено»).</div>}
                {debt.length > 0 && <div className="hint warn">⚠ За клиентом долг с прошлых аренд: <b>{debt.map(([c, v]) => fmtMoney(v, c)).join(' · ')}</b></div>}
              </div>
            );
          })()}
          {selClient && selClient.category === 'Чёрный список' && <div className="field full"><div className="hint warn">⚠ Клиент в чёрном списке</div></div>}
          {selClient && selClient.category !== 'Чёрный список' && selClient.discount ? <div className="field full"><div className="hint">Скидка клиента: {selClient.discount}% (учтите в цене за день или итоге)</div></div> : null}

          <div className="field"><label>Выдача: дата и время *</label><div className="amount-row" style={{ gridTemplateColumns: '1fr 120px' }}><input type="date" value={form.issued_at} onChange={set('issued_at')} /><input type="time" value={form.pickup_time || ''} onChange={set('pickup_time')} /></div></div>
          <div className="field"><label>Возврат: план и время</label><div className="amount-row" style={{ gridTemplateColumns: '1fr 120px' }}><input type="date" value={form.due_at} onChange={set('due_at')} /><input type="time" value={form.return_time || ''} onChange={set('return_time')} /></div></div>

          {/* Цена */}
          <div className="field"><label>Цена за аренду (за весь срок)</label><div className="amount-row"><input value={form.rental_price ?? ''} onChange={set('rental_price')} placeholder="напр. 910" /><select value={form.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
          <div className="field"><label>Доп. плата (кресло и т.п.)</label><input value={form.extra_fee ?? ''} onChange={set('extra_fee')} placeholder="0.00" /></div>
          <div className="field full"><label>За что доп. плата</label><input value={form.extra_note ?? ''} onChange={set('extra_note')} placeholder="детское кресло, второй водитель..." /></div>

          <div className="field"><label>Лимит км в день</label><input type="number" value={form.km_limit ?? ''} onChange={set('km_limit')} placeholder="напр. 250 (пусто = без лимита)" /></div>
          <div className="field"><label>Цена за 1 км перепробега</label><input value={form.over_km_price ?? ''} onChange={set('over_km_price')} placeholder="0.00" /></div>

          {(priceNum > 0 || dailyNum > 0) && (
            <div className="field full"><div className="hint">
              {priceNum > 0
                ? <>Срок: <b>{days} дн</b> · цена за аренду {priceNum.toFixed(2)} {form.currency} (≈ {(priceNum / Math.max(1, days)).toFixed(2)}/день){extraNum > 0 ? ` + доп ${extraNum.toFixed(2)}` : ''} = <b>{computed.toFixed(2)} {form.currency}</b></>
                : <>Срок: <b>{days} дн</b> × {dailyNum.toFixed(2)} {form.currency} (старый тариф){extraNum > 0 ? ` + доп ${extraNum.toFixed(2)}` : ''} = <b>{computed.toFixed(2)} {form.currency}</b></>}
              {amountTouched.current && <span style={{ color: 'var(--warn)', marginLeft: 8 }}>· итог изменён вручную</span>}
            </div></div>
          )}

          <div className="field"><label>Итоговая сумма</label><input value={form.amount} onChange={onAmount} placeholder="0.00" /></div>
          <div className="field"><label>Оплачено</label><input value={form.paid} onChange={set('paid')} placeholder="0.00" /></div>
          <div className="field"><label>Депозит</label><input value={form.deposit} onChange={set('deposit')} placeholder="(возвратный)" /></div>

          {/* Пробег при выдаче (для активной аренды) */}
          {isActive && (
            <div className="field"><label>Пробег при выдаче (км)</label><input type="number" value={form.km_out ?? ''} onChange={set('km_out')} placeholder="118 000" /></div>
          )}

          <div className="field"><label>Место выдачи</label><input value={form.pickup_location || ''} onChange={set('pickup_location')} placeholder="офис, аэропорт..." /></div>
          <div className="field"><label>Место возврата</label><input value={form.return_location || ''} onChange={set('return_location')} placeholder="офис, аэропорт..." /></div>
          <div className="field full"><label>Заметка</label><textarea value={form.note || ''} onChange={set('note')} placeholder="состояние машины и т.п." /></div>
        </div>
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Отмена</button><button className="btn" onClick={save}>Сохранить</button></div>
      </div>
    </div>
  );
}
