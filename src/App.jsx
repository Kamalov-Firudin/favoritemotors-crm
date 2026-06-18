import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './lib/supabase.js';
import { getStats, getNotifications } from './lib/api.js';
import Login from './views/Login.jsx';
import Cars from './views/Cars.jsx';
import Clients from './views/Clients.jsx';
import Rentals from './views/Rentals.jsx';
import Calendar from './views/Calendar.jsx';
import Finances from './views/Finances.jsx';
import Maintenance from './views/Maintenance.jsx';
import AuditLog from './views/AuditLog.jsx';

export const CURRENCIES = ['EUR', 'USD', 'TRY'];
const SYM = { EUR: '€', USD: '$', TRY: '₺' };
export const toMinor = (s) => { const n = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const fromMinor = (m) => (Number(m || 0) / 100).toFixed(2);
export const fmtMoney = (m, cur) => `${fromMinor(m)} ${SYM[cur] || cur || ''}`.trim();
export const fmtDate = (d) => (d ? d.split('-').reverse().join('.') : '—');

const TYPE_STYLE = {
  overdue: { dot: '#b4472b', bg: '#fdf0ed', text: '#7a2710' },
  urgent:  { dot: '#c2762a', bg: '#fef6ed', text: '#7a4814' },
  warn:    { dot: '#b08a00', bg: '#fefbe8', text: '#6b5400' },
  info:    { dot: '#3f7d52', bg: '#edf5ef', text: '#1e4d30' },
};

export default function App() {
  const [session, setSession] = useState(undefined); // undefined = loading
  const [tab, setTab] = useState('bookings');
  const [stats, setStats] = useState({ total: 0, out: 0, free: 0, reserved: 0, maintenance: 0 });
  const [cars, setCars] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [readCount, setReadCount] = useState(0);
  const panelRef = useRef(null);

  // Авторизация
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const refreshAll = useCallback(async () => {
    if (!session) return;
    const [s, carsData, notes] = await Promise.all([
      getStats(),
      supabase.from('cars').select('*').neq('status', 'hidden').order('name').then(r => r.data || []),
      getNotifications(),
    ]);
    setStats(s);
    setCars(carsData);
    setNotifications(notes);
  }, [session]);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  // Закрыть панель уведомлений при клике вне
  useEffect(() => {
    if (!notifOpen) return;
    const handler = (e) => { if (panelRef.current && !panelRef.current.contains(e.target)) setNotifOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notifOpen]);

  const unread = Math.max(0, notifications.length - readCount);
  const openNotif = () => { setNotifOpen(v => { if (!v) setReadCount(notifications.length); return !v; }); };
  const goToTab = (t) => { setTab(t); setNotifOpen(false); };
  const signOut = () => supabase.auth.signOut();

  // Загрузка
  if (session === undefined) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--ink-soft)' }}>
      Загрузка...
    </div>
  );

  // Не авторизован
  if (!session) return <Login />;

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">FavoriteMotors<small>учёт аренды</small></div>
        <nav className="nav">
          {[
            ['bookings',    'Брони'],
            ['rentals',     'Аренда'],
            ['calendar',    'Календарь'],
            ['cars',        'Машины'],
            ['clients',     'Клиенты'],
            ['finances',    'Финансы'],
            ['maintenance', 'Техсостояние'],
            ['audit',       'Журнал'],
          ].map(([key, label]) => (
            <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>
          ))}
        </nav>
        <div className="rail-foot">
          <button className="backup-btn" onClick={signOut} style={{ opacity: 0.7 }}>Выйти ({session.user.email})</button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="chip"><div className="v">{stats.total}</div><div className="l">Всего машин</div></div>
          <div className="chip out"><div className="v">{stats.out}</div><div className="l">В аренде</div></div>
          {stats.reserved > 0 && <div className="chip"><div className="v">{stats.reserved}</div><div className="l">Броней</div></div>}
          <div className="chip free"><div className="v">{stats.free}</div><div className="l">Свободно</div></div>
          {stats.maintenance > 0 && <div className="chip"><div className="v">{stats.maintenance}</div><div className="l">На ремонте</div></div>}

          {/* Колокольчик */}
          <div ref={panelRef} style={{ marginLeft: 'auto', position: 'relative' }}>
            <button onClick={openNotif} style={{
              position: 'relative', background: 'none', border: '1px solid var(--line)',
              borderRadius: 10, padding: '8px 12px', cursor: 'pointer', fontSize: 18,
              color: unread > 0 ? 'var(--accent)' : 'var(--ink-soft)',
            }}>
              🔔
              {unread > 0 && (
                <span style={{
                  position: 'absolute', top: -6, right: -6,
                  background: '#b4472b', color: '#fff', borderRadius: 999,
                  fontSize: 11, fontWeight: 700, minWidth: 18, height: 18,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
                }}>{unread > 99 ? '99+' : unread}</span>
              )}
            </button>

            {notifOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 8px)', right: 0,
                width: 380, maxHeight: 480, overflowY: 'auto',
                background: 'var(--panel)', border: '1px solid var(--line)',
                borderRadius: 12, boxShadow: '0 8px 32px rgba(0,0,0,.15)', zIndex: 100,
              }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between' }}>
                  <b style={{ fontSize: 14 }}>Уведомления</b>
                  <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>{notifications.length} событий</span>
                </div>
                {notifications.length === 0
                  ? <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Всё в порядке</div>
                  : notifications.map(n => {
                    const s = TYPE_STYLE[n.type] || TYPE_STYLE.info;
                    return (
                      <div key={n.id} onClick={() => goToTab(n.tab)}
                        style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)', cursor: 'pointer', display: 'flex', gap: 10 }}
                        onMouseEnter={e => e.currentTarget.style.background = s.bg}
                        onMouseLeave={e => e.currentTarget.style.background = ''}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.dot, flexShrink: 0, marginTop: 5 }} />
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 500, color: s.text }}>{n.text}</div>
                          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{n.sub}</div>
                        </div>
                      </div>
                    );
                  })
                }
              </div>
            )}
          </div>
        </div>

        <div className="content">
          {tab === 'bookings'    && <Rentals mode="reserved" onChange={refreshAll} />}
          {tab === 'rentals'     && <Rentals mode="active"   onChange={refreshAll} />}
          {tab === 'calendar'    && <Calendar onChange={refreshAll} />}
          {tab === 'cars'        && <Cars onChange={refreshAll} />}
          {tab === 'clients'     && <Clients />}
          {tab === 'finances'    && <Finances />}
          {tab === 'maintenance' && <Maintenance cars={cars} />}
          {tab === 'audit'       && <AuditLog />}
        </div>
      </div>
    </div>
  );
}
