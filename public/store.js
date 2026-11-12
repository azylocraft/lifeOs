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
 * With Supabase configured (config.js) it saves to the `entries` table for the signed-in
 * person. Until someone signs in, the app keeps working on this device and whatever was
 * saved here is uploaded on first sign-in.
 */
(() => {
  'use strict';
  const LOCAL_KEY = 'myLifeOS.db';   // older local-only saves
  const cfg = window.LIFEOS_CONFIG || {};
  const hasSupabase = !!(cfg.supabaseUrl && cfg.supabaseKey && window.supabase && window.supabase.createClient);
  const sb = hasSupabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
    // implicit flow: an emailed link works even if it opens in a different browser than the one that asked for it
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  }) : null;

  const label = { title: 'Saved on this device', body: 'Sign in to save to your database.' };

  /* ---------- small helpers ---------- */
  const readLocal = () => {
    try { const v = JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}'); return v && typeof v === 'object' ? v : {}; }
    catch (e) { return {}; }
  };
  const clearOldLocal = () => { try { localStorage.removeItem(LOCAL_KEY); } catch (e) {} };
  const wrapErr = (error) => {
    const e = new Error((error && error.message) || 'Save failed');
    const msg = String((error && error.message) || '');
    e.code = /fetch|network|timeout|Failed to/i.test(msg) ? 'unavailable' : (error && error.code) || 'error';
    return e;
  };

  /* ---------- Supabase collection ---------- */
  function createSupabaseCollection(userId) {
    let cache = new Map();          // id -> data
    const listeners = new Set();
    let channel = null, refetchTimer = null;

    const snapshot = () => ({ docs: [...cache].map(([id, data]) => ({ id, data: () => ({ ...data }) })) });
    const emit = () => { const s = snapshot(); listeners.forEach(fn => fn(s)); };

    async function fetchAll() {
      const rows = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb.from('entries').select('id,data').eq('user_id', userId).range(from, from + 999);
        if (error) throw wrapErr(error);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      cache = new Map(rows.map(r => [r.id, { ...r.data, id: r.id }]));
    }
    async function upsert(id, data) {
      const { error } = await sb.from('entries').upsert(
        { user_id: userId, id, data, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,id' });
      if (error) throw wrapErr(error);
    }
    /* entries saved by the older local-only version are uploaded once */
    async function uploadOldLocal() {
      const old = readLocal(), ids = Object.keys(old).filter(id => !cache.has(id));
      for (const id of ids) { await upsert(id, { ...old[id], id }); cache.set(id, { ...old[id], id }); }
      clearOldLocal();
    }
    function listen(onError) {
      channel = sb.channel('entries-' + userId)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'entries', filter: 'user_id=eq.' + userId }, () => {
          clearTimeout(refetchTimer);
          refetchTimer = setTimeout(() => fetchAll().then(emit).catch(() => {}), 300);
        })
        .subscribe(status => { if (status === 'CHANNEL_ERROR') console.warn('Live updates unavailable; changes from other devices appear on reload.'); });
      void onError;
    }

    return {
      onSnapshot(onData, onError) {
        listeners.add(onData);
        fetchAll().then(uploadOldLocal).then(() => { emit(); if (!channel) listen(onError); })
          .catch(err => { listeners.delete(onData); if (onError) onError(err); });
        return () => { listeners.delete(onData); if (channel) sb.removeChannel(channel); };
      },
      doc(id) {
        return {
          async set(obj) { const d = { ...obj, id }; cache.set(id, d); emit(); await upsert(id, d); },
          async update(patch) {
            const d = { ...(cache.get(id) || { id }), ...patch, id };
            cache.set(id, d); emit(); await upsert(id, d);
          },
          async delete() {
            cache.delete(id); emit();
            const { error } = await sb.from('entries').delete().eq('user_id', userId).eq('id', id);
            if (error) throw wrapErr(error);
          }
        };
      }
    };
  }

  /* ---------- sign-in panel ---------- */
  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      .auth-card { position:fixed; right:20px; bottom:calc(20px + env(safe-area-inset-bottom,0px)); z-index:30; width:min(340px, calc(100vw - 32px));
        background:var(--card); color:var(--text); border:1px solid var(--line-soft); border-radius:24px; padding:20px; box-shadow:var(--shadow) }
      .auth-card h2 { font-size:16px; margin:0 0 4px }
      .auth-card .sub { margin:0 0 14px }
      .auth-card .row { display:flex; gap:8px; flex-wrap:wrap }
      .auth-close { position:absolute; top:12px; right:12px }
      .auth-msg { font-size:12.5px; color:var(--muted); margin-top:10px }
      @media (max-width:620px) { .auth-card { right:16px; bottom:calc(96px + env(safe-area-inset-bottom,0px)) } }
      .acct-row { display:flex; justify-content:space-between; align-items:center; gap:8px; margin:12px 6px 0; padding-top:12px; border-top:1px solid var(--line-soft); font-size:12px; color:var(--muted) }
      .acct-row span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0 }`;
    document.head.appendChild(s);
  }

  /* an emailed link that failed comes back as #error=…&error_description=… */
  function linkError() {
    try {
      const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1));
      const d = p.get('error_description') || p.get('error');
      if (!d) return '';
      history.replaceState(null, '', location.pathname);
      return /expired|invalid/i.test(d) ? 'That email link has expired or was already used. Sign in with your password, or ask for a new link.' : 'Sign-in link failed: ' + d.replace(/\+/g, ' ');
    } catch (e) { return ''; }
  }

  function showSignIn() {
    if (document.getElementById('authCard')) return;
    const el = document.createElement('div');
    el.className = 'auth-card'; el.id = 'authCard';
    el.innerHTML = `
      <button type="button" class="icon-btn auth-close" aria-label="Close">✕</button>
      <h2>Save to your account</h2>
      <p class="sub">Sign in to keep your data in the database and see it on every device.</p>
      <form id="authForm">
        <div class="field"><label for="authEmail">Email</label><input id="authEmail" type="email" required autocomplete="email" placeholder="you@example.com"></div>
        <div class="field"><label for="authPass">Password</label><input id="authPass" type="password" minlength="6" autocomplete="current-password" placeholder="At least 6 characters"></div>
        <div class="row"><button class="btn" type="submit" id="authIn">Sign in</button><button class="btn secondary" type="button" id="authUp">Create account</button></div>
        <div class="row" style="margin-top:8px"><button class="btn secondary small" type="button" id="authLink">Email me a sign-in link instead</button><button class="btn secondary small" type="button" id="authReset">Forgot password?</button></div>
        <div class="auth-msg" id="authMsg" role="status" aria-live="polite"></div>
      </form>`;
    document.body.appendChild(el);
    const $ = s => el.querySelector(s), msg = $('#authMsg');
    const say = t => { msg.textContent = t; };
    const busy = on => el.querySelectorAll('button.btn').forEach(b => { b.disabled = on; });
    const creds = () => ({ email: $('#authEmail').value.trim(), password: $('#authPass').value });
    const redirect = location.origin + location.pathname;
    const err = linkError(); if (err) say(err);

    $('.auth-close').addEventListener('click', () => el.remove());
    $('#authForm').addEventListener('submit', async e => {
      e.preventDefault();
      const { email, password } = creds();
      if (!password) { say('Type your password, or use “Email me a sign-in link instead”.'); return; }
      busy(true); say('Signing in…');
      const { error } = await sb.auth.signInWithPassword({ email, password });
      busy(false);
      if (!error) return;   // the session listener takes it from here
      say(/confirm/i.test(error.message) ? 'Confirm your email first: open the link Supabase sent you, then sign in here.'
        : /invalid/i.test(error.message) ? 'Wrong email or password. New here? Tap Create account.'
        : 'Could not sign in: ' + error.message);
    });
    $('#authUp').addEventListener('click', async () => {
      const { email, password } = creds();
      if (!$('#authEmail').checkValidity()) { say('Type a valid email.'); return; }
      if (password.length < 6) { say('Choose a password of at least 6 characters.'); return; }
      busy(true); say('Creating your account…');
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      busy(false);
      if (error) { say('Could not create the account: ' + error.message); return; }
      if (!data.session) say('Account created. Open the confirmation email (any browser is fine), then come back and tap Sign in.');
    });
    $('#authLink').addEventListener('click', async () => {
      const { email } = creds();
      if (!$('#authEmail').checkValidity() || !email) { say('Type your email first.'); return; }
      busy(true); say('Sending…');
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
      busy(false);
      say(error ? 'Could not send: ' + error.message : 'Check your inbox and open the link in this same browser.');
    });
    $('#authReset').addEventListener('click', async () => {
      const { email } = creds();
      if (!$('#authEmail').checkValidity() || !email) { say('Type your email first.'); return; }
      busy(true); say('Sending reset email…');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect });
      busy(false);
      say(error ? 'Could not send: ' + error.message : 'Check your inbox for a password reset link. After setting your password, come back and sign in.');
    });
  }

  function showAccount(email) {
    const panel = document.getElementById('themePanel');
    if (!panel || document.getElementById('acctRow')) return;
    const row = document.createElement('div');
    row.className = 'acct-row'; row.id = 'acctRow';
    row.innerHTML = `<span></span><div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn secondary small" id="acctSetPw">Set password</button><button type="button" class="btn secondary small" id="acctOut">Sign out</button></div>`;
    row.querySelector('span').textContent = email || 'Signed in';
    row.querySelector('#acctOut').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    row.querySelector('#acctSetPw').addEventListener('click', () => {
      const pw = prompt('Enter a new password (at least 6 characters):');
      if (!pw || pw.length < 6) { if (pw !== null) alert('Password must be at least 6 characters.'); return; }
      sb.auth.updateUser({ password: pw }).then(({ error }) => {
        if (error) alert('Could not set password: ' + error.message);
        else { alert('Password set! You can now sign in with email and password.'); row.querySelector('#acctSetPw').remove(); }
      });
    });
    panel.appendChild(row);
  }

  /* ---------- what app.js calls ---------- */
  window.LifeOSStore = {
    label,
    async connect() {
      if (!sb) { console.warn('Supabase not configured; saving on this device only.'); return null; }
      injectStyles();
      const { data } = await sb.auth.getSession();
      let session = data && data.session;
      if (!session) {
        showSignIn();
        // wait for the sign-in link to bring the person back (or for another tab to sign in)
        session = await new Promise(resolve => {
          const { data: sub } = sb.auth.onAuthStateChange((_evt, s) => { if (s) { sub.subscription.unsubscribe(); resolve(s); } });
        });
        const card = document.getElementById('authCard'); if (card) card.remove();
      }
      const email = session.user.email || '';
      label.title = 'Saved to your account';
      label.body = email ? 'Signed in as ' + email + '. Synced to your database.' : 'Synced to your database.';
      showAccount(email);
      sb.auth.onAuthStateChange(evt => { if (evt === 'SIGNED_OUT') location.reload(); });
      return createSupabaseCollection(session.user.id);
    }
  };
})();
