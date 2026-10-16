/* Quote of the day: reads the existing quote list instead of duplicating the text,
   so the 20 entries stay the single source of truth. */
(function () {
  'use strict';

  var hero = document.querySelector('.quote-hero');
  if (!hero) return;

  var steps = Array.prototype.slice.call(document.querySelectorAll('.descent .step'));
  if (!steps.length) {
    hero.hidden = true;
    return;
  }

  function text(root, selector) {
    var el = root.querySelector(selector);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  var quotes = steps.map(function (step, i) {
    var body = step.querySelector('.step-body');
    var source = body ? body.querySelector('.source') : null;
    return {
      no: text(step, '.step-no') || String(i + 1).padStart(2, '0'),
      zh: text(step, '.step-body div.lang-zh blockquote') || text(step, 'blockquote'),
      en: text(step, '.step-body div.lang-en blockquote'),
      citeZh: text(step, '.step-cite .lang-zh'),
      citeEn: text(step, '.step-cite .lang-en'),
      source: source ? source.textContent.replace(/\s+/g, ' ').trim() : ''
    };
  }).filter(function (q) {
    return q.zh;
  });

  if (!quotes.length) {
    hero.hidden = true;
    return;
  }

  var nodes = {
    zh: document.getElementById('hero-quote-zh'),
    en: document.getElementById('hero-quote-en'),
    citeZh: document.getElementById('hero-cite-zh'),
    citeEn: document.getElementById('hero-cite-en'),
    source: document.getElementById('hero-source'),
    count: document.getElementById('hero-count')
  };
  var shuffle = document.getElementById('hero-shuffle');
  var last = -1;

  function render(index) {
    var q = quotes[index];
    if (!q) return;
    if (nodes.zh) nodes.zh.textContent = '“' + q.zh + '”';
    if (nodes.en) nodes.en.textContent = '“' + (q.en || q.zh) + '”';
    if (nodes.citeZh) nodes.citeZh.textContent = q.citeZh || q.citeEn;
    if (nodes.citeEn) nodes.citeEn.textContent = q.citeEn || q.citeZh;
    if (nodes.source) nodes.source.textContent = q.source ? ' · ' + q.source : '';
    if (nodes.count) nodes.count.textContent = q.no + ' / ' + String(quotes.length).padStart(2, '0');
    hero.dataset.index = String(index);
  }

  function pick(avoid) {
    if (quotes.length === 1) return 0;
    var next;
    do {
      next = Math.floor(Math.random() * quotes.length);
    } while (next === avoid);
    return next;
  }

  last = pick(-1);
  render(last);

  if (shuffle) {
    shuffle.addEventListener('click', function () {
      last = pick(last);
      render(last);
    });
  }
})();
