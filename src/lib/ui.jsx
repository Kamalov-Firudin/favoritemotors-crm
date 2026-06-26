import React, { useState, useEffect } from 'react';

// Глобальные всплывашки и подтверждения под дизайн системы.
// toast(msg, type) — ненавязчивое уведомление; confirmDialog(msg, opts) — Promise<boolean>.
let _toast = null;
let _confirm = null;

export function toast(message, type = 'info') {
  if (_toast) _toast(message, type);
  else window.alert(message);
}

export function confirmDialog(message, opts = {}) {
  return new Promise((resolve) => {
    if (_confirm) _confirm({ message, resolve, ...opts });
    else resolve(window.confirm(message));
  });
}

export function UIRoot() {
  const [toasts, setToasts] = useState([]);
  const [cf, setCf] = useState(null);

  useEffect(() => {
    _toast = (message, type) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, message, type }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), type === 'error' ? 6000 : 4000);
    };
    _confirm = (c) => setCf(c);
    return () => { _toast = null; _confirm = null; };
  }, []);

  const done = (val) => { if (cf) cf.resolve(val); setCf(null); };

  return (
    <>
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.type}`} onClick={() => setToasts((ts) => ts.filter((x) => x.id !== t.id))}>
            {t.message}
          </div>
        ))}
      </div>
      {cf && (
        <div className="overlay" style={{ zIndex: 1000 }}>
          <div className="modal" style={{ maxWidth: 440 }}>
            <div className="modal-head"><h3>{cf.title || 'Подтверждение'}</h3><button className="x" onClick={() => done(false)}>×</button></div>
            <div className="modal-body" style={{ display: 'block', whiteSpace: 'pre-line', fontSize: 14, lineHeight: 1.5 }}>{cf.message}</div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => done(false)}>{cf.cancelText || 'Отмена'}</button>
              <button className={`btn ${cf.danger ? 'danger' : ''}`} onClick={() => done(true)} autoFocus>{cf.okText || 'Да'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
