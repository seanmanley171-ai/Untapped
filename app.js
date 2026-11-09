// UNTAPPED store build — account required. Data saves on this device
// (localStorage) AND to the signed-in user's account (Supabase user_data).
(function () {
  'use strict';
  var KEY = 'untapped-store-v1';
  var RES_CATS = ['Tools & gear', 'Vehicle', 'Space', 'Tech', 'Time', 'Materials', 'Money', 'Other'];
  var ABIL_CATS = ['Fix & repair', 'Creative', 'Tech', 'Cooking', 'Teaching', 'Driving & hauling', 'Cleaning', 'Building', 'Care & people', 'Other'];
  var LEVELS = ['Just starting', 'Learning', 'Okay', 'Good', 'Great'];

  // ---------- auth / account state ----------
  var sb = null;
  try {
    if (window.supabase && window.UNTAPPED_CONFIG &&
        window.UNTAPPED_CONFIG.SUPABASE_ANON_KEY &&
        window.UNTAPPED_CONFIG.SUPABASE_ANON_KEY !== 'PASTE_ANON_KEY_HERE') {
      sb = window.supabase.createClient(window.UNTAPPED_CONFIG.SUPABASE_URL, window.UNTAPPED_CONFIG.SUPABASE_ANON_KEY);
    }
  } catch (e) { sb = null; }
  var currentUser = null, currentProfile = null;
  var SUPPORT_EMAIL = 'seanmanley171@gmail.com';
  var settingsMsg = '', adminUsers = null, adminMsg = '', adminLoading = false;
  var gate = 'loading'; // loading | auth | subscribe | app
  var authMode = 'signin'; // signin | signup
  var authMsg = '', authError = '', subMsg = '';
  var authBusy = false;
  var cloudReady = false, cloudTimer = null;
  var hadLocalSave = false;
  var loadingUserId = null;

  var state = load();
  var view = 'home';
  var editingRes = null, editingAb = null, showDismissed = false;

  function defaultState() {
    return { resources: [], abilities: [], setup: { goal: '', hoursPerWeek: '', budget: '' }, favorites: [], dismissed: [], projects: [] };
  }
  function normalizeState(s) {
    var d = defaultState();
    if (!s || typeof s !== 'object') return d;
    if (Array.isArray(s.resources)) d.resources = s.resources;
    if (Array.isArray(s.abilities)) d.abilities = s.abilities;
    if (Array.isArray(s.favorites)) d.favorites = s.favorites;
    if (Array.isArray(s.dismissed)) d.dismissed = s.dismissed;
    if (Array.isArray(s.projects)) d.projects = s.projects;
    if (s.setup && typeof s.setup === 'object') d.setup = { goal: s.setup.goal || '', hoursPerWeek: s.setup.hoursPerWeek || '', budget: s.setup.budget || '' };
    return d;
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { hadLocalSave = true; return normalizeState(JSON.parse(raw)); }
    } catch (e) {}
    return defaultState();
  }
  function saveLocal() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  function save() { saveLocal(); scheduleCloudSave(); }

  // ---------- cloud sync (Supabase user_data) ----------
  function scheduleCloudSave() {
    if (!sb || !currentUser || !cloudReady) return;
    if (cloudTimer) clearTimeout(cloudTimer);
    cloudTimer = setTimeout(upsertCloud, 1000);
  }
  function upsertCloud() {
    if (!sb || !currentUser) return Promise.resolve();
    var uidNow = currentUser.id;
    var blob = JSON.parse(JSON.stringify(state));
    return sb.from('user_data')
      .upsert({ user_id: uidNow, data: blob, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(function (res) { if (res.error) console.warn('UNTAPPED cloud save failed:', res.error.message); })
      .catch(function (e) { console.warn('UNTAPPED cloud save failed:', e); });
  }
  function loadCloudData(userId) {
    return sb.from('user_data').select('data').eq('user_id', userId).maybeSingle()
      .then(function (res) {
        if (res.error) { console.warn('UNTAPPED cloud load failed:', res.error.message); cloudReady = true; return; }
        if (res.data && res.data.data && typeof res.data.data === 'object' && Object.keys(res.data.data).length) {
          // Account copy wins over the local copy.
          state = normalizeState(res.data.data);
          saveLocal();
          cloudReady = true;
        } else {
          cloudReady = true;
          // No account copy yet: upload the local save once, if there is one
          // (this preserves the owner's existing data, e.g. "Tool equipment").
          if (hadLocalSave) return upsertCloud();
        }
      })
      .catch(function (e) { console.warn('UNTAPPED cloud load failed:', e); cloudReady = true; });
  }
  function loadProfile(userId) {
    return sb.from('profiles').select('id, email, is_admin, sub_status, sub_current_period_end').eq('id', userId).maybeSingle()
      .then(function (res) {
        if (res.error) { console.warn('UNTAPPED profile load failed:', res.error.message); return null; }
        return res.data || null;
      })
      .catch(function (e) { console.warn('UNTAPPED profile load failed:', e); return null; });
  }
  function loadAdminUsers() {
    if (!sb || adminLoading) return;
    adminLoading = true;
    sb.from('profiles').select('id, email, is_admin, sub_status, sub_current_period_end, created_at')
      .order('created_at', { ascending: true })
      .then(function (res) {
        adminLoading = false;
        if (res.error) { adminMsg = 'Could not load accounts: ' + res.error.message; adminUsers = []; }
        else adminUsers = res.data || [];
        if (view === 'settings' && gate === 'app') render();
      })
      .catch(function (e) {
        adminLoading = false; adminUsers = [];
        adminMsg = 'Could not load accounts: ' + ((e && e.message) || 'unknown error');
        if (view === 'settings' && gate === 'app') render();
      });
  }
  function adminSetStatus(userId, status) {
    if (!sb) return;
    if (userId === (currentUser && currentUser.id)) { adminMsg = 'That is your own account — the panel leaves yours alone on purpose.'; render(); return; }
    var patch = { sub_status: status };
    if (status === 'active') {
      var end = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      patch.sub_current_period_end = end.toISOString();
    }
    if (status === 'none') patch.sub_current_period_end = null;
    adminMsg = 'Saving…'; render();
    sb.from('profiles').update(patch).eq('id', userId)
      .then(function (res) {
        if (res.error) { adminMsg = 'Save failed: ' + res.error.message; render(); return; }
        adminMsg = 'Saved. The list below is fresh from the server.';
        adminUsers = null; // force reload so the panel shows the server's truth
        render();
        loadAdminUsers();
      })
      .catch(function (e) { adminMsg = 'Save failed: ' + ((e && e.message) || 'unknown error'); render(); });
  }
  function hasAccess(p) {
    if (!p) return false;
    if (p.is_admin) return true;
    if (p.sub_status === 'comped') return true; // free access granted by the admin
    if (p.sub_status === 'active' && p.sub_current_period_end) {
      return new Date(p.sub_current_period_end).getTime() > Date.now();
    }
    return false;
  }
  function afterSignIn(userObj) {
    if (!userObj) { gate = 'auth'; render(); return Promise.resolve(); }
    if (loadingUserId === userObj.id && gate !== 'auth') return Promise.resolve();
    loadingUserId = userObj.id;
    currentUser = userObj;
    gate = 'loading'; render();
    return loadProfile(userObj.id).then(function (profile) {
      currentProfile = profile;
      return loadCloudData(userObj.id);
    }).then(function () {
      loadingUserId = null;
      gate = hasAccess(currentProfile) ? 'app' : 'subscribe';
      render();
    }).catch(function (e) {
      console.warn('UNTAPPED sign-in setup failed:', e);
      loadingUserId = null;
      gate = 'subscribe';
      render();
    });
  }
  function doSignOut() {
    if (cloudTimer) { clearTimeout(cloudTimer); cloudTimer = null; }
    currentUser = null; currentProfile = null; cloudReady = false; loadingUserId = null;
    authMsg = ''; authError = ''; subMsg = ''; settingsMsg = ''; adminUsers = null; adminMsg = ''; adminLoading = false;
    gate = 'auth';
    if (sb) sb.auth.signOut().catch(function () {});
    render();
  }
  function doForgot(email) {
    if (!sb) { authError = 'Sign-in is not switched on in this build yet. Please try again later.'; render(); return; }
    if (!email) { authError = 'Type your email above first, then tap Forgot password.'; render(); return; }
    authError = ''; authMsg = '';
    sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname })
      .then(function (res) {
        if (res.error) authError = res.error.message;
        else authMsg = 'Password reset email sent. Check your inbox and follow the link.';
        render();
      })
      .catch(function (e) { authError = (e && e.message) || 'Could not send the reset email.'; render(); });
  }
  function doAuthSubmit(fd) {
    if (!sb) { authError = 'Sign-in is not switched on in this build yet. Please try again later.'; render(); return; }
    if (authBusy) return;
    var email = String(fd.get('email') || '').trim();
    var password = String(fd.get('password') || '');
    if (!email || !password) { authError = 'Enter your email and password.'; render(); return; }
    authBusy = true; authError = ''; authMsg = ''; render();
    var done = function () { authBusy = false; };
    if (authMode === 'signup') {
      sb.auth.signUp({ email: email, password: password })
        .then(function (res) {
          done();
          if (res.error) { authError = res.error.message; render(); return; }
          if (res.data && res.data.session && res.data.user) { afterSignIn(res.data.user); return; }
          authMsg = 'Account created. Check your email to confirm it, then sign in.';
          authMode = 'signin';
          render();
        })
        .catch(function (e) { done(); authError = (e && e.message) || 'Could not create the account.'; render(); });
    } else {
      sb.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          done();
          if (res.error) { authError = res.error.message; render(); return; }
          if (res.data && res.data.user) afterSignIn(res.data.user);
          else { authError = 'Sign-in did not finish. Please try again.'; render(); }
        })
        .catch(function (e) { done(); authError = (e && e.message) || 'Could not sign in.'; render(); });
    }
  }
  function initAuth() {
    gate = 'loading'; render();
    if (!sb) { gate = 'auth'; render(); return; }
    sb.auth.onAuthStateChange(function (event, session) {
      if (event === 'SIGNED_OUT' || !session) {
        if (gate !== 'auth' && !currentUser) { gate = 'auth'; render(); }
        return;
      }
      if (session.user && (!currentUser || currentUser.id !== session.user.id) && event !== 'PASSWORD_RECOVERY') {
        afterSignIn(session.user);
      }
    });
    sb.auth.getSession()
      .then(function (res) {
        var session = res.data && res.data.session;
        if (session && session.user) afterSignIn(session.user);
        else { gate = 'auth'; render(); }
      })
      .catch(function () { gate = 'auth'; render(); });
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function user() { return { resources: state.resources, abilities: state.abilities, setup: state.setup }; }
  function matches() {
    return window.UNTAPPED_LOGIC.rank(user(), window.UNTAPPED_IDEAS)
      .filter(function (m) { return state.dismissed.indexOf(m.idea.id) < 0; });
  }
  function allMatches() { return window.UNTAPPED_LOGIC.rank(user(), window.UNTAPPED_IDEAS); }

  // ---------- rendering ----------
  var app = document.getElementById('app');
  var nav = document.getElementById('nav');

  function renderNav() {
    var items = [
      ['home', 'Home'], ['resources', 'Resources'], ['abilities', 'Skills'],
      ['discover', 'Discover'], ['projects', 'Projects'], ['growth', 'Growth'], ['settings', 'Settings']
    ];
    var counts = { resources: state.resources.length, abilities: state.abilities.length, projects: state.projects.length };
    nav.innerHTML = items.map(function (it) {
      var badge = counts[it[0]] ? '<span class="badge">' + counts[it[0]] + '</span>' : '';
      return '<button class="navbtn' + (view === it[0] ? ' on' : '') + '" data-nav="' + it[0] + '">' + it[1] + badge + '</button>';
    }).join('');
  }

  function header(sub) {
    return '<div class="top"><h1>UNTAPPED</h1><p class="tag">Your potential isn\u2019t missing. It\u2019s untapped.</p>' +
      '<p class="sub">' + esc(sub) + '</p></div>';
  }

  // ---------- gate screens (loading / auth / subscribe) ----------
  function accountHTML() {
    if (!currentUser) return '';
    var adminLine = (currentProfile && currentProfile.is_admin)
      ? '<p><span class="pill gold">★ ADMIN ACCOUNT</span></p><p class="dim">This is the admin account. It never pays and never hits the subscription gate. Manage accounts in Settings.</p>' : '';
    return '<div class="panel account"><h2>Account</h2>' +
      '<p class="dim">Signed in as ' + esc(currentUser.email || '') + '</p>' + adminLine +
      '<div class="row"><button data-nav="settings">Settings & support</button><button data-act="signOut">Sign out</button></div></div>';
  }

  function settingsHTML() {
    var p = currentProfile;
    var statusLine = !p ? 'No profile loaded yet — tap Recheck.' :
      (p.is_admin ? 'Admin — full access, no subscription needed.' :
        (p.sub_status === 'comped' ? 'Free access granted by the admin (comped).' :
          (p.sub_status === 'active' ? 'Subscription active' + (p.sub_current_period_end ? ' until ' + esc(String(p.sub_current_period_end).slice(0, 10)) : '') + '.' :
            'Status: ' + esc(p.sub_status || 'none') + ' — no active subscription.')));
    var out = header('Settings') +
      '<div class="panel account"><h2>Account</h2>' +
      '<p class="dim">Signed in as ' + esc(currentUser ? (currentUser.email || '') : '') + '</p>' +
      (p && p.is_admin ? '<p><span class="pill gold">★ ADMIN ACCOUNT</span></p>' : '') +
      '<p>' + esc(statusLine) + '</p>' +
      '<p class="dim">Account check: ' + (p ? ('admin = ' + (p.is_admin ? 'yes' : 'no') + ' · status = ' + esc(p.sub_status || 'none')) : 'no profile row loaded') + '</p>' +
      (settingsMsg ? '<div class="msg">' + esc(settingsMsg) + '</div>' : '') +
      '<div class="row"><button data-act="recheck2">Recheck my account</button>' +
      '<button data-act="changePw">Change password</button>' +
      '<button data-act="signOut">Sign out</button></div></div>' +
      '<div class="panel"><h2>Support</h2>' +
      '<p>Stuck, charged wrong, or something looks broken? Email support and a real person reads it.</p>' +
      '<p><a class="btnlink primary" href="mailto:' + SUPPORT_EMAIL + '?subject=' + encodeURIComponent('UNTAPPED support') + '">Email support — ' + esc(SUPPORT_EMAIL) + '</a></p>' +
      '<p class="dim">To delete your account and its data, email support from your account email and ask for account deletion.</p>' +
      '<p class="dim"><a href="privacy.html">Privacy policy</a></p></div>';
    if (p && p.is_admin) out += adminHTML();
    return out;
  }

  function adminHTML() {
    var rows;
    if (adminUsers === null) {
      rows = '<p class="dim">' + (adminLoading ? 'Loading accounts…' : 'Loading accounts…') + '</p>';
    } else if (!adminUsers.length) {
      rows = '<p class="dim">No accounts found.</p>';
    } else {
      rows = adminUsers.map(function (u) {
        var mine = currentUser && u.id === currentUser.id;
        var pills = (u.is_admin ? '<span class="pill gold">ADMIN</span> ' : '') +
          '<span class="pill">' + esc(u.sub_status || 'none') + '</span>' +
          (u.sub_current_period_end && u.sub_status === 'active' ? ' <span class="dim">until ' + esc(String(u.sub_current_period_end).slice(0, 10)) + '</span>' : '');
        var when = u.created_at ? esc(String(u.created_at).slice(0, 10)) : '';
        var actions = mine ? '<span class="dim">This is you</span>' :
          '<div class="row">' +
          '<button data-act="adminComp" data-id="' + u.id + '">Give free access</button>' +
          '<button data-act="adminActive" data-id="' + u.id + '">Set active (30 days)</button>' +
          '<button data-act="adminNone" data-id="' + u.id + '">Remove access</button></div>';
        return '<div class="item adminuser"><div><strong>' + esc(u.email || '(no email)') + '</strong>' +
          '<div class="dim">Joined ' + when + '</div><div>' + pills + '</div></div>' + actions + '</div>';
      }).join('');
    }
    return '<div class="panel glow"><h2>Admin — all accounts</h2>' +
      '<p class="dim">Only you see this. Free access (comped) opens the app with no payment — use it to fix an account or comp a friend.</p>' +
      (adminMsg ? '<div class="msg">' + esc(adminMsg) + '</div>' : '') +
      rows +
      '<div class="row"><button data-act="adminRefresh">Refresh list</button></div></div>';
  }

  function authHTML() {
    var signup = authMode === 'signup';
    return header(signup ? 'Create your account' : 'Sign in to continue') +
      '<form id="authForm" class="form"><h2>' + (signup ? 'Create account' : 'Sign in') + '</h2>' +
      '<label>Email <input id="authEmail" name="email" type="email" autocomplete="email" required placeholder="you@example.com"></label>' +
      '<label>Password <input name="password" type="password" autocomplete="' + (signup ? 'new-password' : 'current-password') + '" required placeholder="Your password"></label>' +
      (authError ? '<div class="err">' + esc(authError) + '</div>' : '') +
      (authMsg ? '<div class="msg">' + esc(authMsg) + '</div>' : '') +
      (!sb ? '<div class="err">Sign-in is not switched on in this build yet. Please try again later.</div>' : '') +
      '<button class="primary big" type="submit"' + (authBusy ? ' disabled' : '') + '>' + (authBusy ? 'Please wait…' : (signup ? 'Create account' : 'Sign in')) + '</button>' +
      '<div class="row"><button type="button" data-act="authToggle">' + (signup ? 'Already have an account? Sign in' : 'New here? Create account') + '</button>' +
      '<button type="button" data-act="forgot">Forgot password</button></div></form>' +
      '<div class="panel"><p class="dim">An account is required. Your things, skills and projects save to your account, so they are there when you sign in on another device.</p></div>';
  }

  function subscribeHTML() {
    var email = currentUser ? (currentUser.email || '') : '';
    return header('Subscription required') +
      '<div class="panel glow"><h2>UNTAPPED — $4.99/month</h2>' +
      '<p>One monthly subscription opens the whole app: your resources, skills, matching ideas, projects and growth — saved to your account.</p>' +
      '<p class="dim">Signed in as ' + esc(email) + '</p>' +
      '<p class="dim">Account check: ' + (currentProfile ? ('admin = ' + (currentProfile.is_admin ? 'yes' : 'no') + ' · status = ' + esc(currentProfile.sub_status || 'none')) : 'no profile row loaded') + '</p>' +
      (subMsg ? '<div class="msg">' + esc(subMsg) + '</div>' : '') +
      '<button class="primary big" data-act="subscribePlaceholder">Subscribe — $4.99/month</button>' +
      '<div class="row"><button data-act="recheck">Recheck my account</button>' +
      '<button data-act="restorePlaceholder">Restore purchase</button>' +
      '<button data-act="signOut">Sign out</button></div></div>' +
      '<div class="panel"><p class="dim">Payments are handled by Google Play. You can cancel anytime in Google Play.</p></div>';
  }

  function loadingHTML() {
    return header('One moment') + '<div class="panel"><p>Loading your account…</p></div>';
  }

  function homeHTML() {
    var ms = matches();
    var step = state.resources.length === 0 ? 1 : (state.abilities.length === 0 ? 2 : 3);
    var next = step === 1 ? 'Add your first thing you have.' : step === 2 ? 'Add your first skill.' :
      (state.projects.length === 0 ? 'Open Discover and start one idea as a project.' : 'Keep your project moving — check off a step.');
    var latest = state.resources.slice(-3).reverse().map(function (r) { return '<li>' + esc(r.name) + ' <span class="dim">(' + esc(r.category) + ')</span></li>'; }).join('');
    return header('Step ' + step + ' of 3') +
      '<div class="bar"><div class="fill" style="width:' + (state.resources.length && state.abilities.length && ms.length ? 100 : step * 33) + '%"></div></div>' +
      '<div class="panel glow"><h2>Your next step</h2><p>' + esc(next) + '</p></div>' +
      '<div class="grid">' +
      card('resources', 'Resources', 'What you have', state.resources.length + ' saved') +
      card('abilities', 'Abilities', 'What you can do', state.abilities.length + ' saved') +
      card('discover', 'Discover', 'What you could do', ms.length + ' matches') +
      card('projects', 'Projects', 'What you\u2019re making happen', state.projects.length + ' started') +
      card('growth', 'Growth', 'How far you\u2019ve come', 'Your real numbers') +
      '</div>' +
      (latest ? '<div class="panel"><h2>Latest things you added</h2><ul class="plain">' + latest + '</ul></div>' : '<div class="panel"><h2>Start here</h2><p>A bike, a drill, free Sunday hours — if it can be used, it counts.</p></div>') +
      accountHTML();
    function card(v, t, d, c) { return '<button class="bigcard" data-nav="' + v + '"><span class="ct">' + t + '</span><span class="cd">' + d + '</span><span class="cc">' + c + '</span></button>'; }
  }

  function resFormHTML(r) {
    r = r || { name: '', category: RES_CATS[0], condition: 'Good', access: 'Mine', notes: '' };
    return '<form id="resForm" class="form"><h2>' + (editingRes ? 'Edit thing' : 'Add a thing') + '</h2>' +
      '<label>Name <input name="name" required value="' + esc(r.name) + '" placeholder="e.g. Cordless drill"></label>' +
      '<label>Kind <select name="category">' + RES_CATS.map(function (c) { return '<option' + (r.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label>Shape it\u2019s in <select name="condition">' + ['New', 'Good', 'Worn but works', 'Needs fixing'].map(function (c) { return '<option' + (r.condition === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label>Yours or borrowed? <select name="access">' + ['Mine', 'Borrowed', 'Shared', 'Can rent'].map(function (c) { return '<option' + (r.access === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label>Notes <input name="notes" value="' + esc(r.notes) + '" placeholder="Optional"></label>' +
      '<div class="row"><button class="primary" type="submit">Save</button><button type="button" data-act="cancelRes">Cancel</button></div></form>';
  }

  function resourcesHTML() {
    var list = state.resources.map(function (r) {
      return '<div class="item"><div><strong>' + esc(r.name) + '</strong><div class="dim">' + esc(r.category) + ' · ' + esc(r.condition) + ' · ' + esc(r.access) + (r.notes ? ' · ' + esc(r.notes) : '') + '</div></div>' +
        '<div class="row"><button data-act="editRes" data-id="' + r.id + '">Edit</button><button data-act="delRes" data-id="' + r.id + '">Delete</button></div></div>';
    }).join('');
    return header('Resources — what you have') +
      '<button class="primary big" data-act="addRes">+ Add a thing</button>' +
      (editingRes !== undefined && editingRes !== null || window.__showResForm ? resFormHTML(editingRes ? state.resources.find(function (x) { return x.id === editingRes; }) : null) : '') +
      (list || '<div class="panel"><p>Nothing yet. A bike, a drill, free Sunday hours — if it can be used, it counts.</p></div>');
  }

  function abFormHTML(a) {
    a = a || { name: '', category: ABIL_CATS[0], level: 3, enjoyment: 3, notes: '' };
    return '<form id="abForm" class="form"><h2>' + (editingAb ? 'Edit skill' : 'Add a skill') + '</h2>' +
      '<label>Name <input name="name" required value="' + esc(a.name) + '" placeholder="e.g. Fix bikes and small repairs"></label>' +
      '<label>Kind <select name="category">' + ABIL_CATS.map(function (c) { return '<option' + (a.category === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
      '<label>How good are you? <select name="level">' + LEVELS.map(function (l, i) { return '<option value="' + (i + 1) + '"' + (a.level === i + 1 ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label>' +
      '<label>How much do you like it? <select name="enjoyment">' + LEVELS.map(function (l, i) { return '<option value="' + (i + 1) + '"' + (a.enjoyment === i + 1 ? ' selected' : '') + '>' + l + '</option>'; }).join('') + '</select></label>' +
      '<label>Notes <input name="notes" value="' + esc(a.notes) + '" placeholder="Optional"></label>' +
      '<div class="row"><button class="primary" type="submit">Save</button><button type="button" data-act="cancelAb">Cancel</button></div></form>';
  }

  function abilitiesHTML() {
    var s = state.setup;
    var list = state.abilities.map(function (a) {
      return '<div class="item"><div><strong>' + esc(a.name) + '</strong><div class="dim">' + esc(a.category) + ' · Skill: ' + LEVELS[a.level - 1] + ' · Likes it: ' + LEVELS[a.enjoyment - 1] + (a.notes ? ' · ' + esc(a.notes) : '') + '</div></div>' +
        '<div class="row"><button data-act="editAb" data-id="' + a.id + '">Edit</button><button data-act="delAb" data-id="' + a.id + '">Delete</button></div></div>';
    }).join('');
    var goalOpts = [''].concat(window.UNTAPPED_GOALS).map(function (g) { return '<option value="' + esc(g) + '"' + (s.goal === g ? ' selected' : '') + '>' + (g || 'Not set') + '</option>'; }).join('');
    return header('Abilities — what you can do') +
      '<button class="primary big" data-act="addAb">+ Add a skill</button>' +
      (window.__showAbForm ? abFormHTML(editingAb ? state.abilities.find(function (x) { return x.id === editingAb; }) : null) : '') +
      (list || '<div class="panel"><p>No skills yet. “I can do this” counts. “I want to learn this” counts too — set the level low and be honest.</p></div>') +
      '<form id="setupForm" class="form"><h2>What you want</h2>' +
      '<label>Your goal <select name="goal">' + goalOpts + '</select></label>' +
      '<label>Free hours a week <input name="hoursPerWeek" type="number" min="0" step="1" value="' + esc(s.hoursPerWeek) + '" placeholder="e.g. 5"></label>' +
      '<label>Money you can put in ($) <input name="budget" type="number" min="0" step="1" value="' + esc(s.budget) + '" placeholder="e.g. 50"></label>' +
      '<button class="primary" type="submit">Save</button></form>';
  }

  function discoverHTML() {
    var ms = matches();
    var dis = allMatches().filter(function (m) { return state.dismissed.indexOf(m.idea.id) >= 0; });
    var cards = ms.map(function (m) {
      var fav = state.favorites.indexOf(m.idea.id) >= 0;
      var started = state.projects.some(function (p) { return p.ideaId === m.idea.id; });
      return '<div class="panel idea"><div class="row spread"><strong>' + esc(m.idea.title) + '</strong><span class="score">' + m.score + '</span></div>' +
        '<div class="dim">' + esc(m.band) + ' · Start cost $' + m.idea.cost + ' · About ' + m.idea.hours + ' hrs/week</div>' +
        '<p>' + esc(m.idea.desc) + '</p>' +
        (m.why.length ? '<div class="why">' + m.why.map(function (w) { return '<div>✓ ' + esc(w) + '</div>'; }).join('') + '</div>' : '') +
        (m.missing.length ? '<div class="miss">Missing: ' + esc(m.missing.join(', ')) + '</div>' : '') +
        (m.overBudget ? '<div class="flag">Over your budget — flagged, not hidden.</div>' : '') +
        (m.overTime ? '<div class="flag">Needs more time than you set — flagged, not hidden.</div>' : '') +
        '<details><summary>First steps</summary><ol>' + m.idea.steps.map(function (st) { return '<li>' + esc(st) + '</li>'; }).join('') + '</ol></details>' +
        '<div class="row"><button data-act="fav" data-id="' + m.idea.id + '">' + (fav ? '★ Saved' : '☆ Save') + '</button>' +
        (started ? '<span class="dim">In Projects ✓</span>' : '<button class="primary" data-act="start" data-id="' + m.idea.id + '">Start this project</button>') +
        '<button data-act="dismiss" data-id="' + m.idea.id + '">Not for me</button></div></div>';
    }).join('');
    return header('Discover — what you could do') +
      '<p class="dim">Plain rules match ideas to your stuff, skills, goal, hours, and budget. No AI. No made-up earnings.</p>' +
      (cards || '<div class="panel"><p>No matches yet. Add a thing you have and a skill you can do, then come back.</p></div>') +
      (dis.length ? '<button data-act="toggleDis">' + (showDismissed ? 'Hide dismissed' : 'Show dismissed (' + dis.length + ')') + '</button>' +
        (showDismissed ? dis.map(function (m) { return '<div class="item"><span>' + esc(m.idea.title) + '</span><button data-act="undismiss" data-id="' + m.idea.id + '">Bring back</button></div>'; }).join('') : '') : '');
  }

  function projectsHTML() {
    var list = state.projects.map(function (p) {
      var done = p.steps.filter(function (s) { return s.done; }).length;
      var pct = p.steps.length ? Math.round(done / p.steps.length * 100) : 0;
      return '<div class="panel"><div class="row spread"><strong>' + esc(p.title) + '</strong><span class="dim">' + done + '/' + p.steps.length + ' steps</span></div>' +
        '<div class="bar"><div class="fill" style="width:' + pct + '%"></div></div>' +
        p.steps.map(function (s, i) { return '<label class="step"><input type="checkbox" data-act="step" data-pid="' + p.id + '" data-i="' + i + '"' + (s.done ? ' checked' : '') + '> ' + esc(s.text) + '</label>'; }).join('') +
        '<form class="row addstep" data-pid="' + p.id + '"><input name="text" placeholder="Add a step" required><button class="primary" type="submit">Add step</button></form>' +
        '<button data-act="delProj" data-id="' + p.id + '">Delete project</button></div>';
    }).join('');
    return header('Projects — what you\u2019re making happen') +
      '<form id="customForm" class="form"><h2>Start your own project</h2><label>Name <input name="title" required placeholder="e.g. Build a workbench"></label><button class="primary" type="submit">Start project</button></form>' +
      (list || '<div class="panel"><p>No projects yet. Open Discover and tap “Start this project” on an idea, or start your own above.</p></div>');
  }

  function growthHTML() {
    var stepsTotal = state.projects.reduce(function (n, p) { return n + p.steps.length; }, 0);
    var stepsDone = state.projects.reduce(function (n, p) { return n + p.steps.filter(function (s) { return s.done; }).length; }, 0);
    var rows = [
      ['Things you have', state.resources.length], ['Skills you can do', state.abilities.length],
      ['Ideas saved', state.favorites.length], ['Projects started', state.projects.length],
      ['Steps done', stepsDone + ' of ' + stepsTotal]
    ];
    return header('Growth — how far you\u2019ve come') +
      '<div class="grid">' + rows.map(function (r) { return '<div class="panel stat"><div class="num">' + esc(r[1]) + '</div><div class="dim">' + esc(r[0]) + '</div></div>'; }).join('') + '</div>' +
      '<div class="panel"><p>Only your real numbers. No streaks. No pressure. Miss a week, nothing breaks.</p></div>';
  }

  function renderApp() {
    nav.style.display = '';
    renderNav();
    app.innerHTML = view === 'home' ? homeHTML() : view === 'resources' ? resourcesHTML() : view === 'abilities' ? abilitiesHTML() :
      view === 'discover' ? discoverHTML() : view === 'projects' ? projectsHTML() : view === 'settings' ? settingsHTML() : growthHTML();
    window.scrollTo(0, 0);
    if (view === 'settings' && currentProfile && currentProfile.is_admin && adminUsers === null && !adminLoading) {
      loadAdminUsers();
    }
  }

  function render() {
    if (gate === 'app') { renderApp(); return; }
    nav.innerHTML = '';
    nav.style.display = 'none';
    app.innerHTML = gate === 'auth' ? authHTML() : gate === 'subscribe' ? subscribeHTML() : loadingHTML();
    window.scrollTo(0, 0);
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var navBtn = e.target.closest('[data-nav]');
    if (navBtn) { if (gate !== 'app') return; view = navBtn.getAttribute('data-nav'); render(); return; }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
    if (act === 'signOut') { doSignOut(); return; }
    if (act === 'authToggle') { authMode = authMode === 'signin' ? 'signup' : 'signin'; authError = ''; authMsg = ''; render(); return; }
    if (act === 'forgot') { var em = document.getElementById('authEmail'); doForgot(em ? em.value.trim() : ''); return; }
    if (act === 'recheck') {
      if (!sb || !currentUser) { subMsg = 'Sign in first, then recheck.'; render(); return; }
      subMsg = 'Checking your account…'; render();
      loadProfile(currentUser.id).then(function (p) {
        currentProfile = p;
        if (hasAccess(p)) { subMsg = ''; gate = 'app'; }
        else subMsg = 'Checked just now: ' + (p ? ('admin = ' + (p.is_admin ? 'yes' : 'no') + ', status = ' + (p.sub_status || 'none')) : 'no profile row found for this account') + '.';
        render();
      });
      return;
    }
    if (act === 'recheck2') {
      if (!sb || !currentUser) { settingsMsg = 'Sign in first, then recheck.'; render(); return; }
      settingsMsg = 'Checking your account on the server…'; render();
      loadProfile(currentUser.id).then(function (p) {
        currentProfile = p;
        settingsMsg = 'Checked just now: ' + (p ? ('admin = ' + (p.is_admin ? 'yes' : 'no') + ', status = ' + (p.sub_status || 'none') + '.') : 'no profile row found for this account.');
        if (p && p.is_admin) adminUsers = null; // admin panel appears — load it fresh
        render();
      });
      return;
    }
    if (act === 'changePw') {
      if (!sb || !currentUser) { settingsMsg = 'Sign in first.'; render(); return; }
      settingsMsg = 'Sending a password reset email…'; render();
      sb.auth.resetPasswordForEmail(currentUser.email, { redirectTo: window.location.origin + window.location.pathname })
        .then(function (res) {
          settingsMsg = res.error ? ('Could not send it: ' + res.error.message) : 'Password reset email sent to ' + (currentUser.email || '') + '. Follow the link in it, then sign in with the new password.';
          render();
        })
        .catch(function (e) { settingsMsg = 'Could not send it: ' + ((e && e.message) || 'unknown error'); render(); });
      return;
    }
    if (act === 'adminRefresh') { adminUsers = null; adminMsg = ''; render(); loadAdminUsers(); return; }
    if (act === 'adminComp') { adminSetStatus(id, 'comped'); return; }
    if (act === 'adminActive') { adminSetStatus(id, 'active'); return; }
    if (act === 'adminNone') {
      if (btn.dataset.arm) { adminSetStatus(id, 'none'); }
      else { btn.dataset.arm = '1'; btn.textContent = 'Tap again to remove access'; }
      return;
    }
    if (act === 'subscribePlaceholder') { subMsg = 'Checkout opens when billing is switched on. Nothing was charged.'; render(); return; }
    if (act === 'restorePlaceholder') { subMsg = 'Restore opens when billing is switched on. Nothing was charged.'; render(); return; }
    if (act === 'addRes') { window.__showResForm = true; editingRes = null; render(); }
    if (act === 'cancelRes') { window.__showResForm = false; editingRes = null; render(); }
    if (act === 'editRes') { window.__showResForm = true; editingRes = id; render(); }
    if (act === 'delRes') { if (btn.dataset.arm) { state.resources = state.resources.filter(function (r) { return r.id !== id; }); save(); render(); } else { btn.dataset.arm = '1'; btn.textContent = 'Tap again to delete'; } }
    if (act === 'addAb') { window.__showAbForm = true; editingAb = null; render(); }
    if (act === 'cancelAb') { window.__showAbForm = false; editingAb = null; render(); }
    if (act === 'editAb') { window.__showAbForm = true; editingAb = id; render(); }
    if (act === 'delAb') { if (btn.dataset.arm) { state.abilities = state.abilities.filter(function (a) { return a.id !== id; }); save(); render(); } else { btn.dataset.arm = '1'; btn.textContent = 'Tap again to delete'; } }
    if (act === 'fav') { var i = state.favorites.indexOf(id); if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(id); save(); render(); }
    if (act === 'dismiss') { state.dismissed.push(id); save(); render(); }
    if (act === 'undismiss') { state.dismissed = state.dismissed.filter(function (x) { return x !== id; }); save(); render(); }
    if (act === 'toggleDis') { showDismissed = !showDismissed; render(); }
    if (act === 'start') {
      var idea = window.UNTAPPED_IDEAS.find(function (x) { return x.id === id; });
      if (idea && !state.projects.some(function (p) { return p.ideaId === id; })) {
        state.projects.push({ id: uid(), ideaId: id, title: idea.title, steps: idea.steps.map(function (t) { return { text: t, done: false }; }), createdAt: Date.now() });
        save();
      }
      view = 'projects'; render();
    }
    if (act === 'delProj') { if (btn.dataset.arm) { state.projects = state.projects.filter(function (p) { return p.id !== id; }); save(); render(); } else { btn.dataset.arm = '1'; btn.textContent = 'Tap again to delete'; } }
  });

  document.addEventListener('change', function (e) {
    var cb = e.target.closest('input[type=checkbox][data-act="step"]');
    if (!cb) return;
    var p = state.projects.find(function (x) { return x.id === cb.getAttribute('data-pid'); });
    if (p) { p.steps[Number(cb.getAttribute('data-i'))].done = cb.checked; save(); render(); }
  });

  document.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, fd = new FormData(f);
    if (f.id === 'authForm') { doAuthSubmit(fd); return; }
    if (f.id === 'resForm') {
      var data = { name: fd.get('name'), category: fd.get('category'), condition: fd.get('condition'), access: fd.get('access'), notes: fd.get('notes') };
      if (editingRes) { var r = state.resources.find(function (x) { return x.id === editingRes; }); Object.assign(r, data); }
      else state.resources.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
      window.__showResForm = false; editingRes = null; save(); render();
    }
    if (f.id === 'abForm') {
      var d2 = { name: fd.get('name'), category: fd.get('category'), level: Number(fd.get('level')), enjoyment: Number(fd.get('enjoyment')), notes: fd.get('notes') };
      if (editingAb) { var a = state.abilities.find(function (x) { return x.id === editingAb; }); Object.assign(a, d2); }
      else state.abilities.push(Object.assign({ id: uid(), createdAt: Date.now() }, d2));
      window.__showAbForm = false; editingAb = null; save(); render();
    }
    if (f.id === 'setupForm') {
      state.setup = { goal: fd.get('goal'), hoursPerWeek: fd.get('hoursPerWeek'), budget: fd.get('budget') };
      save(); render();
    }
    if (f.id === 'customForm') {
      state.projects.push({ id: uid(), ideaId: '', title: fd.get('title'), steps: [], createdAt: Date.now() });
      save(); render();
    }
    if (f.classList.contains('addstep')) {
      var p = state.projects.find(function (x) { return x.id === f.getAttribute('data-pid'); });
      if (p) { p.steps.push({ text: fd.get('text'), done: false }); save(); render(); }
    }
  });

  initAuth();
})();
