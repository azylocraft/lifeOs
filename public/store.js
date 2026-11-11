/*
 * Storage layer for My Life OS.
 *
 * The app only ever talks to this "collection" shape:
 *
 *   collection.onSnapshot(onData, onError)  -> calls onData({docs:[{id, data()}]}) now and after every change
 *   collection.doc(id).set(obj)             -> create / replace one entry
 *   collection.doc(id).update(patch)        -> merge fields into one entry
 *   collection.doc(id).delete()             -> remove one entry
 *
 * Every entry is a plain object with an `id` and a `kind`
 * ('task' | 'note' | 'expense' | 'trip' | 'plan' | 'project' | 'settings').
 *
 * Right now it saves to localStorage. To use a real database later, write another
 * object with the same four methods (Firebase, Supabase, your own API…) and return
 * it from LifeOSStore.connect() below. Nothing in app.js needs to change.
 */
(() => {
  'use strict';
  const KEY = 'myLifeOS.db';

  function createLocalCollection() {
    const listeners = new Set();
    const read = () => {
      try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
      catch (e) { return {}; }
    };
    const write = all => {
      try { localStorage.setItem(KEY, JSON.stringify(all)); }
      catch (e) { const err = new Error('Storage is full'); err.code = 'quota_exceeded'; throw err; }
      emit();
    };
    const snapshot = () => ({
      docs: Object.entries(read()).map(([id, data]) => ({ id, data: () => ({ ...data }) }))
    });
    const emit = () => { const s = snapshot(); listeners.forEach(fn => fn(s)); };

    // keep several open tabs in step
    window.addEventListener('storage', e => { if (e.key === KEY) emit(); });

    return {
      onSnapshot(onData) {
        listeners.add(onData);
        setTimeout(() => onData(snapshot()), 0);
        return () => listeners.delete(onData);
      },
      doc(id) {
        return {
          async set(obj) { const all = read(); all[id] = { ...obj, id }; write(all); },
          async update(patch) { const all = read(); if (all[id]) { all[id] = { ...all[id], ...patch }; write(all); } },
          async delete() { const all = read(); delete all[id]; write(all); }
        };
      }
    };
  }

  window.LifeOSStore = {
    // shown in the sidebar
    label: { title: 'Saved on this device', body: 'Kept in this browser. Connect a database to sync.' },
    async connect() {
      return createLocalCollection();
    }
  };
})();
