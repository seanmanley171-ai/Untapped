// UNTAPPED matching logic — plain rules, no AI. Shared by the app and the tests.
// Score out of 100: resources 30, abilities 25, goal 20, time 10, budget 10, enjoyment 5.
(function (global) {
  'use strict';

  function evaluate(user, idea) {
    var resCats = {};
    (user.resources || []).forEach(function (r) { resCats[r.category] = r; });
    var abilByCat = {};
    (user.abilities || []).forEach(function (a) {
      if (!abilByCat[a.category] || abilByCat[a.category].level < a.level) abilByCat[a.category] = a;
    });

    var why = [], missing = [];
    var score = 0;

    // Resources: 30 points split across required categories.
    var reqRes = idea.resCats || [];
    if (reqRes.length === 0) { score += 30; }
    else {
      var per = 30 / reqRes.length, got = 0;
      reqRes.forEach(function (cat) {
        if (resCats[cat]) { got += per; why.push('You have: ' + resCats[cat].name + ' (' + cat + ')'); }
        else missing.push(cat);
      });
      score += got;
    }

    // Abilities: 25 points split across required categories. Level scales the points.
    var reqAb = idea.abilCats || [];
    if (reqAb.length === 0) { score += 25; }
    else {
      var perA = 25 / reqAb.length, gotA = 0, enjoy = 0;
      reqAb.forEach(function (cat) {
        var a = abilByCat[cat];
        if (a) {
          gotA += perA * (0.5 + a.level / 10); // level 1..5 -> 0.6..1.0 of the share
          enjoy += a.enjoyment || 0;
          why.push('You can: ' + a.name + ' (' + cat + ')');
        } else missing.push(cat + ' skill');
      });
      score += gotA;
      if (reqAb.length) score += Math.min(5, (enjoy / reqAb.length) - 1); // enjoyment bonus, up to ~5
    }

    // Goal: 20 points.
    var goal = user.setup && user.setup.goal;
    if (goal && (idea.goals || []).indexOf(goal) >= 0) { score += 20; why.push('Fits your goal: ' + goal); }

    // Time: 10 points if it fits the hours set; partial if a bit over; flag if over.
    var overTime = false, overBudget = false;
    var hrs = user.setup && user.setup.hoursPerWeek;
    if (hrs) {
      if (idea.hours <= hrs) score += 10;
      else if (idea.hours <= hrs * 1.5) { score += 5; overTime = true; }
      else overTime = true;
    }
    // Budget: 10 points if the start cost fits the money set; flag if over.
    var budget = user.setup && user.setup.budget;
    if (budget != null && budget !== '') {
      if (idea.cost <= Number(budget)) score += 10;
      else overBudget = true;
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    var band = score >= 70 ? 'Strong match' : score >= 50 ? 'Good match' : score >= 30 ? 'Possible with prep' : 'Long shot';
    return { idea: idea, score: score, band: band, why: why, missing: missing, overTime: overTime, overBudget: overBudget };
  }

  function rank(user, ideas) {
    return ideas.map(function (i) { return evaluate(user, i); })
      .sort(function (a, b) { return b.score - a.score; });
  }

  var api = { evaluate: evaluate, rank: rank };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.UNTAPPED_LOGIC = api;
})(typeof window !== 'undefined' ? window : globalThis);
