import React, { useState } from 'react';
import { CURRENCIES } from '../App.jsx';
import ClientPicker from './ClientPicker.jsx';

const toMinor = (s) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };

function conflictMessage(e) {
  const m = String(e?.message || '').match(/CONFLICT\|([^|]*)\|([^|]*)\|([^|]*)/);
  if (!m) return null;
  const f = (d) => (d ? d.split('-').reverse().join('.') : '');
  const [, name, start, end] = m;
  return `Эта машина уже выдана на пересекающиеся даты: ${name}, с ${f(start)}${end ? ` по ${f(end)}` : ''}.\nВыберите другие даты или другую машину.`;
}

// initial: объект с полями брони (строковые суммы для ввода). cars/clients — списки.
export default function BookingForm({ initial, cars, clients, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async () => {
    if (!form.car_id || !form.client_id) return alert('Выберите машину и клиента');
    if (!form.issued_at) return alert('Укажите дату выдачи');
    const client = clients.find((c) => c.id === Number(form.client_id));
    if (client?.category === 'Чёрный список') {
      if (!confirm(`Клиент в чёрном списке: ${client.name}.\nВсё равно оформить бронь?`)) return;
    }
    const t = (v) => (typeof v === 'string' ? v.trim() || null : v);
    const payload = {
      ...form,
      car_id: Number(form.car_id), client_id: Number(form.client_id),
      due_at: form.due_at || null, returned_at: form.returned_at || null,
      amount: toMinor(form.amount), paid: toMinor(form.paid), deposit: toMinor(form.deposit),
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
    <div className="overlay" onClick={(e) => e.target.className === 'overlay' && onClose()}>
      <div className="modal">
        <div className="modal-head"><h3>{form.id ? (form.status === 'reserved' ? 'Изменить бронь' : 'Изменить аренду') : (form.status === 'active' ? 'Новая аренда' : 'Новая бронь')}</h3><button className="x" onClick={onClose}>×</button></div>
        <div className="modal-body">
          <div className="field"><label>Машина *</label>
            <select value={form.car_id} onChange={set('car_id')}>
              <option value="">— выбрать —</option>
              {cars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.plate ? ` (${c.plate})` : ''}</option>)}
            </select>
          </div>
          <ClientPicker clients={clients} value={form.client_id} onChange={(id) => setForm({ ...form, client_id: id })} />
          {selClient && selClient.category === 'Чёрный список' && <div className="field full"><div className="hint warn">⚠ Клиент в чёрном списке</div></div>}
          {selClient && selClient.category !== 'Чёрный список' && selClient.discount ? <div className="field full"><div className="hint">Скидка клиента: {selClient.discount}% (сумму впишите с учётом скидки)</div></div> : null}

          <div className="field"><label>Выдача: дата и время *</label><div className="amount-row" style={{ gridTemplateColumns: '1fr 84px' }}><input type="date" value={form.issued_at} onChange={set('issued_at')} /><input type="time" value={form.pickup_time || ''} onChange={set('pickup_time')} /></div></div>
          <div className="field"><label>Возврат: план и время</label><div className="amount-row" style={{ gridTemplateColumns: '1fr 84px' }}><input type="date" value={form.due_at} onChange={set('due_at')} /><input type="time" value={form.return_time || ''} onChange={set('return_time')} /></div></div>
          <div className="field"><label>Место выдачи</label><input value={form.pickup_location || ''} onChange={set('pickup_location')} placeholder="офис, аэропорт..." /></div>
          <div className="field"><label>Место возврата</label><input value={form.return_location || ''} onChange={set('return_location')} placeholder="офис, аэропорт..." /></div>
          <div className="field"><label>Сумма аренды</label><div className="amount-row"><input value={form.amount} onChange={set('amount')} placeholder="0.00" /><select value={form.currency} onChange={set('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></div></div>
          <div className="field"><label>Оплачено</label><input value={form.paid} onChange={set('paid')} placeholder="0.00" /></div>
          <div className="field"><label>Депозит</label><input value={form.deposit} onChange={set('deposit')} placeholder="(возвратный)" /></div>
          <div className="field"><label>Факт. возврат</label><input type="date" value={form.returned_at} onChange={set('returned_at')} /></div>
          <div className="field full"><label>Заметка</label><textarea value={form.note || ''} onChange={set('note')} placeholder="доп. услуги, состояние машины и т.п." /></div>
        </div>
        <div className="modal-foot"><button className="btn ghost" onClick={onClose}>Отмена</button><button className="btn" onClick={save}>Сохранить</button></div>
      </div>
    </div>
  );
}
