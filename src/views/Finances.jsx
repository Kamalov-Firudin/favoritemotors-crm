import React, { useState, useEffect, useCallback } from 'react';
import { cars as carsApi, rentals as rentalsApi, carExpenses, officeExpenses, CAR_EXPENSE_CATS, OFFICE_EXPENSE_CATS } from '../lib/api.js';
import { CURRENCIES, toMinor, fromMinor, fmtMoney, fmtDate, rentalDaysT } from '../App.jsx';
import { usePerms } from '../lib/perms.js';

const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

// Предустановленные периоды
function getPeriods() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-based

  const monthStart = (y, m) => `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const monthEnd = (y, m) => {
    const last = new Date(y, m + 1, 0).getDate();
    return `${y}-${String(m + 1).padStart(2, '0')}-${last}`;
  };
  const qStart = (y, q) => monthStart(y, q * 3);
  const qEnd = (y, q) => monthEnd(y, q * 3 + 2);
  const curQ = Math.floor(m / 3);

  return [
    { label: 'Этот месяц',    from: monthStart(y, m),     to: monthEnd(y, m) },
    { label: 'Прошлый месяц', from: monthStart(y, m - 1 < 0 ? 11 : m - 1), to: monthEnd(y, m - 1 < 0 ? 11 : m - 1) },
    { label: 'Этот квартал',  from: qStart(y, curQ),       to: qEnd(y, curQ) },
    { label: `${y} год`,      from: `${y}-01-01`,           to: `${y}-12-31` },
    { label: `${y - 1} год`,  from: `${y - 1}-01-01`,       to: `${y - 1}-12-31` },
  ];
}

function sumByCurrency(rows) {
  const r = {};
  for (const row of rows) {
    const cur = row.currency || 'TRY';
    r[cur] = (r[cur] || 0) + (Number(row.amount) || 0);
  }
  return r;
}

// Делит сумму аренды по календарным месяцам её срока, пропорционально дням.
// Завершённые — по фактическим датам (выдача–возврат), идущие/брони — по плановым (выдача–план).
// Возвращает { 'YYYY-MM': доля_в_копейках }, доли в сумме дают полную сумму.
const DAY_MS = 86400000;
function monthSplit(r) {
  const amt = Number(r.amount) || 0;
  const startISO = r.issued_at;
  const endISO = r.returned_at || r.due_at || startISO;
  if (!startISO) return {};
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  const totalDays = Math.round((end - start) / DAY_MS);
  if (!Number.isFinite(totalDays) || totalDays <= 0) return { [startISO.slice(0, 7)]: amt };
  const dayCount = {};
  for (let i = 0; i < totalDays; i++) {
    const ym = new Date(start.getTime() + i * DAY_MS).toISOString().slice(0, 7);
    dayCount[ym] = (dayCount[ym] || 0) + 1;
  }
  const yms = Object.keys(dayCount).sort();
  const out = {};
  let assigned = 0;
  yms.forEach((ym, idx) => {
    const portion = idx === yms.length - 1 ? amt - assigned : Math.round(amt * dayCount[ym] / totalDays);
    assigned += idx === yms.length - 1 ? 0 : portion;
    out[ym] = portion;
  });
  return out;
}

function SumLine({ sums, color }) {
  const entries = Object.entries(sums);
  if (entries.length === 0) return <span style={{ color: 'var(--muted)' }}>—</span>;
  return entries.map(([cur, amt]) => (
    <span key={cur} style={{ color, fontWeight: 500, marginRight: 10 }}>
      {fmtMoney(amt, cur)}
    </span>
  ));
}

const CAT_COLORS = {
  'ТО': '#EF9F27', 'Ремонт': '#D85A30', 'Страхование': '#639922',
  'Шины': '#378ADD', 'Мойка': '#1D9E75',
  'Аренда': '#7F77DD', 'Коммунальные услуги': '#7F77DD', 'Реклама': '#7F77DD',
  'Зарплата': '#7F77DD', 'Связь': '#7F77DD',
  'Прочее': '#888780',
};

const EMPTY_CAR_EXP = { date: today(), category: 'ТО', description: '', amount: '', currency: 'TRY', note: '', car_id: '' };
const EMPTY_OFF_EXP = { date: today(), category: 'Аренда', description: '', amount: '', currency: 'TRY', note: '' };

export default function Finances() {
  const { canWrite } = usePerms();
  const periods = getPeriods();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [reportFrom, setReportFrom] = useState(periods[0].from);
  const [reportTo, setReportTo] = useState(periods[0].to);
  const [reportTab, setReportTab] = useState('month'); // 'month' | 'report'
  const [exporting, setExporting] = useState(false);
  const [rentals, setRentals] = useState([]);
  const [cars, setCars] = useState([]);
  const [carExp, setCarExp] = useState([]);
  const [offExp, setOffExp] = useState([]);
  const [cats, setCats] = useState({ car: [], office: [] });
  const [carForm, setCarForm] = useState(null);
  const [offForm, setOffForm] = useState(null);
  const [filterCar, setFilterCar] = useState('');

  const load = useCallback(async () => {
    const [r, c, ce, oe, ct] = await Promise.all([
      rentalsApi.list(),
      carsApi.list(),
      carExpenses.listAll(),
      officeExpenses.list(),
      Promise.resolve({ car: CAR_EXPENSE_CATS, office: OFFICE_EXPENSE_CATS }),
    ]);
    setRentals(r); setCars(c); setCarExp(ce); setOffExp(oe); setCats(ct);
  }, []);

  useEffect(() => { load(); }, [load]);

  const [y, mo] = month.split('-').map(Number);
  const from = `${month}-01`;
  const lastDay = new Date(y, mo, 0).getDate();
  const to = `${month}-${String(lastDay).padStart(2, '0')}`;

  const filteredRentals = rentals.filter((r) => {
    const d = r.issued_at || '';
    return d >= from && d <= to && (r.status === 'completed' || r.status === 'active');
  });

  const filteredCarExp = carExp.filter((e) => e.date >= from && e.date <= to);
  const filteredOffExp = offExp.filter((e) => e.date >= from && e.date <= to);

  const incomeSums = sumByCurrency(filterCar ? filteredRentals.filter((r) => String(r.car_id) === filterCar) : filteredRentals);
  const carExpSums = sumByCurrency(filterCar ? filteredCarExp.filter((e) => String(e.car_id) === filterCar) : filteredCarExp);
  const offExpSums = sumByCurrency(filteredOffExp);

  // Получено (incomeSums) делим: часть месяцу (earnedSums), часть в перенос (carryByMonth)
  const incRentals = filterCar ? filteredRentals.filter((r) => String(r.car_id) === filterCar) : filteredRentals;
  const earnedSums = {};
  const carryByMonth = {}; // { 'YYYY-MM': { cur: minor } }
  for (const r of incRentals) {
    const cur = r.currency || 'TRY';
    const split = monthSplit(r);
    for (const [ym, portion] of Object.entries(split)) {
      if (ym === month) earnedSums[cur] = (earnedSums[cur] || 0) + portion;
      else { (carryByMonth[ym] = carryByMonth[ym] || {}); carryByMonth[ym][cur] = (carryByMonth[ym][cur] || 0) + portion; }
    }
  }
  const carryMonths = Object.keys(carryByMonth).sort();

  // Генерируем список месяцев за последние 12
  const months = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    months.push(`${y}-${m}`);
    d.setMonth(d.getMonth() - 1);
  }
  function monthLabel(ym) {
    const [y, m] = ym.split('-');
    const names = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    return `${names[Number(m) - 1]} ${y}`;
  }

  const setF = (setter, form) => (k) => (e) => setter({ ...form, [k]: e.target.value });

  const saveCarExp = async () => {
    if (!carForm.description.trim()) return alert('Укажите описание');
    if (!carForm.car_id) return alert('Выберите машину');
    const payload = { ...carForm, amount: toMinor(carForm.amount) };
    if (carForm.id) await carExpenses.update(payload);
    else await carExpenses.create(payload);
    setCarForm(null); await load();
  };

  const saveOffExp = async () => {
    if (!offForm.description.trim()) return alert('Укажите описание');
    const payload = { ...offForm, amount: toMinor(offForm.amount) };
    if (offForm.id) await officeExpenses.update(payload);
    else await officeExpenses.create(payload);
    setOffForm(null); await load();
  };

  const removeCarExp = async (e) => {
    if (!confirm(`Удалить «${e.description}»?`)) return;
    await carExpenses.remove(e.id); await load();
  };
  const removeOffExp = async (e) => {
    if (!confirm(`Удалить «${e.description}»?`)) return;
    await officeExpenses.remove(e.id); await load();
  };

  const displayCarExp = filterCar ? filteredCarExp.filter((e) => String(e.car_id) === filterCar) : filteredCarExp;
  const displayRentals = filterCar ? filteredRentals.filter((r) => String(r.car_id) === filterCar) : filteredRentals;

  const exportReport = async () => {
    alert('Экспорт в Excel доступен в десктопной версии приложения.');
  };

  // Данные для раздела «Отчёт»
  const repRentals = rentals.filter(r =>
    (r.status === 'completed' || r.status === 'active') &&
    r.issued_at >= reportFrom && r.issued_at <= reportTo
  );
  const repCarExp = carExp.filter(e => e.date >= reportFrom && e.date <= reportTo);
  const repOffExp = offExp.filter(e => e.date >= reportFrom && e.date <= reportTo);

  const repIncome = sumByCurrency(repRentals);
  const repCarExpSums = sumByCurrency(repCarExp);
  const repOffExpSums = sumByCurrency(repOffExp);

  // Прибыль по машинам для превью
  const carReport = (cars || []).map(car => {
    const cRentals = repRentals.filter(r => r.car_id === car.id);
    const cExp = repCarExp.filter(e => e.car_id === car.id);
    const days = cRentals.reduce((acc, r) => {
      const end = r.returned_at || r.due_at;
      if (!end) return acc;
      return acc + rentalDaysT(r.issued_at, r.pickup_time, end, r.return_time);
    }, 0);
    const inc = sumByCurrency(cRentals);
    const exp = sumByCurrency(cExp);
    const km = cRentals.reduce((acc, r) => {
      if (r.km_out != null && r.km_in != null && r.km_in >= r.km_out) return acc + (r.km_in - r.km_out);
      return acc;
    }, 0);
    const profit = {};
    new Set([...Object.keys(inc), ...Object.keys(exp)]).forEach(cur => {
      profit[cur] = (inc[cur] || 0) - (exp[cur] || 0);
    });
    return { car, days, rentals: cRentals.length, inc, exp, profit, km };
  }).filter(r => r.rentals > 0 || Object.keys(r.inc).length > 0);

  return (
    <>
      <div className="head">
        <h1>Финансы</h1>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['month', 'Месяц'], ['report', 'Отчёт']].map(([key, label]) => (
            <button key={key} onClick={() => setReportTab(key)}
              className={reportTab === key ? 'btn' : 'btn ghost'}
              style={{ fontSize: 13 }}>{label}</button>
          ))}
        </div>
      </div>

      {/* ── ВКЛАДКА: МЕСЯЦ ── */}
      {reportTab === 'month' && (<>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20 }}>
          <select value={month} onChange={(e) => setMonth(e.target.value)} style={{ fontSize: 13 }}>
            {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
          <select value={filterCar} onChange={(e) => setFilterCar(e.target.value)} style={{ fontSize: 13 }}>
            <option value="">Все машины</option>
            {cars.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
          </select>
        </div>

        {/* Сводка месяца */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20, alignItems: 'start' }}>
          <div className="card" style={{ padding: '12px 16px', borderLeft: '3px solid #3B6D11' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 6, fontWeight: 600 }}>Доходы</div>
            <div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Получено</div>
            <div style={{ fontSize: 15, marginBottom: 8 }}><SumLine sums={incomeSums} color="#3B6D11" /></div>
            <div style={{ fontSize: 10, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '.03em' }}>Заработано за месяц</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}><SumLine sums={earnedSums} color="#3B6D11" /></div>
            {carryMonths.length > 0 && (
              <div style={{ marginTop: 8, borderTop: '1px dashed var(--line)', paddingTop: 6 }}>
                {carryMonths.map((ym) => (
                  <div key={ym} style={{ fontSize: 11, color: '#8a6d3b', marginTop: 2 }}>
                    Перенос на {monthLabel(ym)}: <b>{Object.entries(carryByMonth[ym]).map(([cur, v]) => fmtMoney(v, cur)).join(' · ')}</b>
                  </div>
                ))}
              </div>
            )}
          </div>
          {[['Расходы машин', carExpSums, '#993C1D'], ['Расходы офиса', offExpSums, '#993C1D']].map(([label, sums, color]) => (
            <div key={label} className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 15 }}><SumLine sums={sums} color={color} /></div>
            </div>
          ))}
          <div className="card" style={{ padding: '12px 16px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>Прибыль (получено − расходы)</div>
            {CURRENCIES.map((cur) => {
              const inc = incomeSums[cur] || 0;
              const exp = (carExpSums[cur] || 0) + (filterCar ? 0 : offExpSums[cur] || 0);
              const profit = inc - exp;
              if (inc === 0 && exp === 0) return null;
              return <div key={cur} style={{ fontSize: 13, fontWeight: 500, color: profit >= 0 ? '#3B6D11' : '#993C1D' }}>{fmtMoney(profit, cur)}</div>;
            })}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

          {/* Расходы машин */}
          <div className="card">
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 13 }}>Расходы машин</b>
              {canWrite && <button className="btn sm" onClick={() => setCarForm({ ...EMPTY_CAR_EXP })}>+ Добавить</button>}
            </div>
            {displayCarExp.length === 0 ? <div className="empty" style={{ padding: '20px' }}><b>Расходов нет за этот период</b></div> : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Дата</th><th>Машина</th><th>Описание</th><th>Сумма</th><th></th></tr></thead>
                  <tbody>{displayCarExp.map((e) => (
                    <tr key={e.id}>
                      <td className="mono muted">{fmtDate(e.date)}</td>
                      <td className="muted" style={{ fontSize: 12 }}>{e.car_name}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLORS[e.category] || '#888', display: 'inline-block', flexShrink: 0 }} />
                        {e.description}
                      </span></td>
                      <td className="mono" style={{ color: '#993C1D', fontWeight: 500 }}>{fmtMoney(e.amount, e.currency)}</td>
                      <td><div className="row-actions">
                        {canWrite && <button className="btn ghost sm" onClick={() => setCarForm({ ...e, amount: fromMinor(e.amount) })}>Изм.</button>}
                        {canWrite && <button className="btn ghost sm" onClick={() => removeCarExp(e)}>Скрыть</button>}
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          {/* Расходы офиса */}
          <div className="card">
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 13 }}>Расходы офиса</b>
              {canWrite && <button className="btn sm" onClick={() => setOffForm({ ...EMPTY_OFF_EXP })}>+ Добавить</button>}
            </div>
            {filteredOffExp.length === 0 ? <div className="empty" style={{ padding: '20px' }}><b>Расходов нет за этот период</b></div> : (
              <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Дата</th><th>Категория</th><th>Описание</th><th>Сумма</th><th></th></tr></thead>
                  <tbody>{filteredOffExp.map((e) => (
                    <tr key={e.id}>
                      <td className="mono muted">{fmtDate(e.date)}</td>
                      <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: CAT_COLORS[e.category] || '#888', display: 'inline-block', flexShrink: 0 }} />
                        {e.category}
                      </span></td>
                      <td>{e.description}</td>
                      <td className="mono" style={{ color: '#993C1D', fontWeight: 500 }}>{fmtMoney(e.amount, e.currency)}</td>
                      <td><div className="row-actions">
                        {canWrite && <button className="btn ghost sm" onClick={() => setOffForm({ ...e, amount: fromMinor(e.amount) })}>Изм.</button>}
                        {canWrite && <button className="btn ghost sm" onClick={() => removeOffExp(e)}>Скрыть</button>}
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          {/* Доходы — полная ширина внизу со скроллом */}
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <b style={{ fontSize: 13 }}>Доходы — из аренд</b>
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{displayRentals.length} записей</span>
            </div>
            {displayRentals.length === 0
              ? <div className="empty" style={{ padding: '20px' }}><b>Нет завершённых аренд за этот период</b></div>
              : (
                <div style={{ maxHeight: 240, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Клиент</th><th>Машина</th><th>Выдана</th><th>Возврат</th><th>Сумма</th></tr></thead>
                    <tbody>{displayRentals.map((r) => (
                      <tr key={r.id}>
                        <td><b>{r.client_name}</b></td>
                        <td className="muted">{r.car_name}</td>
                        <td className="mono muted">{fmtDate(r.issued_at)}</td>
                        <td className="mono muted">{r.returned_at ? fmtDate(r.returned_at) : (r.due_at ? fmtDate(r.due_at) : '—')}</td>
                        <td className="mono" style={{ color: '#3B6D11', fontWeight: 500 }}>{fmtMoney(r.amount, r.currency)}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )
            }
          </div>
        </div>
      </>)}

      {/* ── ВКЛАДКА: ОТЧЁТ ── */}
      {reportTab === 'report' && (<>
        {/* Выбор периода */}
        <div className="card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>Быстрый выбор</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {getPeriods().map((p) => (
                  <button key={p.label} className="btn ghost sm"
                    style={{ fontSize: 12, background: reportFrom === p.from && reportTo === p.to ? 'var(--ink)' : '', color: reportFrom === p.from && reportTo === p.to ? '#fff' : '' }}
                    onClick={() => { setReportFrom(p.from); setReportTo(p.to); }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>С</label>
              <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} style={{ width: 140 }} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>По</label>
              <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} style={{ width: 140 }} />
            </div>
            <button className="btn" onClick={exportReport} disabled={exporting} style={{ marginLeft: 'auto' }}>
              {exporting ? 'Экспорт...' : '↓ Скачать Excel'}
            </button>
          </div>
        </div>

        {/* Сводка отчёта */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 20 }}>
          {[['Доходы', repIncome, '#3B6D11'], ['Расходы машин', repCarExpSums, '#993C1D'], ['Расходы офиса', repOffExpSums, '#993C1D']].map(([label, sums, color]) => (
            <div key={label} className="card" style={{ padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>{label}</div>
              <SumLine sums={sums} color={color} />
            </div>
          ))}
          <div className="card" style={{ padding: '12px 16px', borderLeft: '3px solid var(--accent)' }}>
            <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginBottom: 4 }}>Чистая прибыль</div>
            {CURRENCIES.map((cur) => {
              const inc = repIncome[cur] || 0;
              const exp = (repCarExpSums[cur] || 0) + (repOffExpSums[cur] || 0);
              const profit = inc - exp;
              if (inc === 0 && exp === 0) return null;
              return <div key={cur} style={{ fontSize: 14, fontWeight: 600, color: profit >= 0 ? '#3B6D11' : '#993C1D' }}>{fmtMoney(profit, cur)}</div>;
            })}
          </div>
        </div>

        {/* Таблица по машинам */}
        <div className="card">
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--line)' }}>
            <b style={{ fontSize: 13 }}>По машинам</b>
          </div>
          {carReport.length === 0 ? (
            <div className="empty" style={{ padding: '20px' }}><b>Нет данных за выбранный период</b></div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Машина</th>
                  <th>Аренд</th>
                  <th>Дней</th>
                  <th>Км</th>
                  <th>Доход</th>
                  <th>Расходы</th>
                  <th>Прибыль</th>
                </tr>
              </thead>
              <tbody>
                {carReport.map(({ car, days, rentals: rCount, inc, exp, profit, km }) => (
                  <tr key={car.id}>
                    <td>
                      <b>{car.name}</b>
                      {car.plate && <div style={{ fontSize: 11, color: 'var(--ink-soft)', fontFamily: 'var(--mono)' }}>{car.plate}</div>}
                    </td>
                    <td className="mono">{rCount}</td>
                    <td className="mono">{days}</td>
                    <td className="mono">{km > 0 ? `${km.toLocaleString()} км` : '—'}</td>
                    <td>{CURRENCIES.filter(c => inc[c]).map(c => (
                      <div key={c} style={{ fontSize: 12, color: '#3B6D11', fontWeight: 500 }}>{fmtMoney(inc[c], c)}</div>
                    ))}</td>
                    <td>{CURRENCIES.filter(c => exp[c]).map(c => (
                      <div key={c} style={{ fontSize: 12, color: '#993C1D', fontWeight: 500 }}>{fmtMoney(exp[c], c)}</div>
                    ))}{!CURRENCIES.some(c => exp[c]) && <span style={{ color: 'var(--ink-soft)' }}>—</span>}</td>
                    <td>{CURRENCIES.filter(c => profit[c] !== undefined && (inc[c] || exp[c])).map(c => (
                      <div key={c} style={{ fontSize: 13, fontWeight: 600, color: profit[c] >= 0 ? '#3B6D11' : '#993C1D' }}>{fmtMoney(profit[c], c)}</div>
                    ))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>)}

      {/* Формы добавления расходов (общие для обеих вкладок) */}
      {carForm && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head"><h3>{carForm.id ? 'Изменить расход' : 'Расход машины'}</h3><button className="x" onClick={() => setCarForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field">
                <label>Машина *</label>
                <select value={carForm.car_id} onChange={setF(setCarForm, carForm)('car_id')}>
                  <option value="">— выберите —</option>
                  {cars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="field"><label>Дата *</label><input type="date" value={carForm.date} onChange={setF(setCarForm, carForm)('date')} /></div>
              <div className="field">
                <label>Категория</label>
                <select value={carForm.category} onChange={setF(setCarForm, carForm)('category')}>
                  {cats.car.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field full"><label>Описание *</label><input value={carForm.description} onChange={setF(setCarForm, carForm)('description')} placeholder="Замена масла + фильтр" /></div>
              <div className="field">
                <label>Сумма</label>
                <div className="amount-row">
                  <input value={carForm.amount} onChange={setF(setCarForm, carForm)('amount')} placeholder="0.00" />
                  <select value={carForm.currency} onChange={setF(setCarForm, carForm)('currency')}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="field full"><label>Заметка</label><input value={carForm.note || ''} onChange={setF(setCarForm, carForm)('note')} /></div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setCarForm(null)}>Отмена</button><button className="btn" onClick={saveCarExp}>Сохранить</button></div>
          </div>
        </div>
      )}

      {offForm && (
        <div className="overlay">
          <div className="modal" style={{ maxWidth: 480 }}>
            <div className="modal-head"><h3>{offForm.id ? 'Изменить расход' : 'Расход офиса'}</h3><button className="x" onClick={() => setOffForm(null)}>×</button></div>
            <div className="modal-body">
              <div className="field"><label>Дата *</label><input type="date" value={offForm.date} onChange={setF(setOffForm, offForm)('date')} /></div>
              <div className="field">
                <label>Категория</label>
                <select value={offForm.category} onChange={setF(setOffForm, offForm)('category')}>
                  {cats.office.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="field full"><label>Описание *</label><input value={offForm.description} onChange={setF(setOffForm, offForm)('description')} placeholder="Аренда офиса июнь" /></div>
              <div className="field">
                <label>Сумма</label>
                <div className="amount-row">
                  <input value={offForm.amount} onChange={setF(setOffForm, offForm)('amount')} placeholder="0.00" />
                  <select value={offForm.currency} onChange={setF(setOffForm, offForm)('currency')}>
                    {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div className="field full"><label>Заметка</label><input value={offForm.note || ''} onChange={setF(setOffForm, offForm)('note')} /></div>
            </div>
            <div className="modal-foot"><button className="btn ghost" onClick={() => setOffForm(null)}>Отмена</button><button className="btn" onClick={saveOffExp}>Сохранить</button></div>
          </div>
        </div>
      )}
    </>
  );
}
