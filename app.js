// UNTAPPED store build — all data stays on this device (localStorage). No account, no server.
(function () {
  'use strict';
  var KEY = 'untapped-store-v1';
  var RES_CATS = ['Tools & gear', 'Vehicle', 'Space', 'Tech', 'Time', 'Materials', 'Money', 'Other'];
  var ABIL_CATS = ['Fix & repair', 'Creative', 'Tech', 'Cooking', 'Teaching', 'Driving & hauling', 'Cleaning', 'Building', 'Care & people', 'Other'];
  var LEVELS = ['Just starting', 'Learning', 'Okay', 'Good', 'Great'];

  var state = load();
  var view = 'home';
  var editingRes = null, editingAb = null, showDismissed = false;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return { resources: [], abilities: [], setup: { goal: '', hoursPerWeek: '', budget: '' }, favorites: [], dismissed: [], projects: [] };
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
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
      ['discover', 'Discover'], ['projects', 'Projects'], ['growth', 'Growth']
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
      (latest ? '<div class="panel"><h2>Latest things you added</h2><ul class="plain">' + latest + '</ul></div>' : '<div class="panel"><h2>Start here</h2><p>A bike, a drill, free Sunday hours — if it can be used, it counts.</p></div>');
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

  function render() {
    renderNav();
    app.innerHTML = view === 'home' ? homeHTML() : view === 'resources' ? resourcesHTML() : view === 'abilities' ? abilitiesHTML() :
      view === 'discover' ? discoverHTML() : view === 'projects' ? projectsHTML() : growthHTML();
    window.scrollTo(0, 0);
  }

  // ---------- events ----------
  document.addEventListener('click', function (e) {
    var navBtn = e.target.closest('[data-nav]');
    if (navBtn) { view = navBtn.getAttribute('data-nav'); render(); return; }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
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

  render();
})();
