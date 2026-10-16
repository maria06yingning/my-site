(function () {
  'use strict';

  var LANG_KEY = 'site-lang';

  function currentLang() {
    return document.documentElement.dataset.lang || 'zh';
  }

  function applyLang(lang) {
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.querySelectorAll('.lang-toggle button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.lang === lang);
      b.setAttribute('aria-pressed', String(b.dataset.lang === lang));
    });
    syncAllLabel();
  }

  /* 语言敏感的按钮文字 */
  function syncAllLabel() {
    var lang = currentLang();
    var allBtn = document.getElementById('fog-all');
    if (!allBtn) return;
    var steps = Array.from(document.querySelectorAll('.step'));
    var opened = steps.filter(function (el) { return el.classList.contains('is-open'); }).length;
    var counter = document.getElementById('fog-count');
    if (counter) counter.textContent = String(opened).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
    steps.forEach(function (el) {
      var tick = el.querySelector('.step-tick');
      if (tick) tick.textContent = el.classList.contains('is-open') ? '−' : '+';
    });
    var allOpen = steps.length === opened;
    allBtn.innerHTML = allOpen
      ? (lang === 'zh' ? '全部收起' : 'close all')
      : (lang === 'zh' ? '全部展开' : 'open all');
  }

  /* 时钟 */
  function tickClock() {
    var d = new Date();
    var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    document.querySelectorAll('.clock').forEach(function (c) { c.textContent = t; });
  }

  /* 窗口控制：最小化 / 最大化 / 关闭并重开 */
  function bindWindowControls() {
    var content = document.getElementById('content');
    if (!content) return;
    var win = content.classList.contains('desktop-win') ? content : content.closest('.dialog-page');
    if (!win) return;

    var reopen = document.querySelector('[data-welcome-reopen]');
    function setReopenVisible(visible) {
      if (reopen) reopen.hidden = !visible;
    }

    win.querySelectorAll('[data-window]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.window;
        if (action === 'minimize') {
          win.classList.toggle('is-minimized');
          var activeLink = document.querySelector('.task-links a.active');
          if (activeLink) activeLink.focus();
        } else if (action === 'maximize') {
          win.classList.toggle('is-maximized');
          win.classList.remove('is-minimized');
          btn.setAttribute('aria-pressed', win.classList.contains('is-maximized') ? 'true' : 'false');
        } else if (action === 'close') {
          win.classList.add('is-closed');
          setReopenVisible(true);
          if (reopen) reopen.focus();
        }
      });
    });

    if (reopen) {
      reopen.addEventListener('click', function () {
        win.classList.remove('is-closed', 'is-minimized');
        setReopenVisible(false);
        var heading = win.querySelector('h1');
        if (heading) {
          heading.tabIndex = -1;
          heading.focus();
        }
      });
    }

    /* 窗口一旦被关闭，桌面图标接管导航，底部任务栏的首页按钮可重新打开它。 */
    document.querySelectorAll('.task-links a[data-page="index.html"]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (!win.classList.contains('is-closed') || !reopen) return;
        event.preventDefault();
        reopen.click();
      });
    });
  }

  /* 语录展开/收起 */
  function initDescent() {
    var grid = document.querySelector('.descent');
    if (!grid) return;

    document.querySelectorAll('.step').forEach(function (el) {
      var btn = el.querySelector('.step-fog');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        syncAllLabel();
      });
    });

    var allBtn = document.getElementById('fog-all');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        var anyClosed = document.querySelectorAll('.step:not(.is-open)').length > 0;
        document.querySelectorAll('.step').forEach(function (el) {
          el.classList.toggle('is-open', anyClosed);
          var btn = el.querySelector('.step-fog');
          if (btn) btn.setAttribute('aria-expanded', anyClosed ? 'true' : 'false');
        });
        syncAllLabel();
      });
    }
  }

  /* 项目展开/收起 */
  function initDoors() {
    document.querySelectorAll('.door').forEach(function (el) {
      var btn = el.querySelector('.door-face');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /* 语言切换按钮 */
  document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
    btn.addEventListener('click', function () { applyLang(btn.dataset.lang); });
  });

  /* 底部任务栏标明当前页，并可还原最小化窗口而不刷新内容。 */
  var page = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.task-links a').forEach(function (link) {
    if (link.dataset.page !== page) return;
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
    link.addEventListener('click', function (event) {
      var win = document.querySelector('.dialog-page');
      if (!win) return;
      event.preventDefault();
      win.classList.remove('is-minimized');
      var heading = win.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  });

  /* 初始化 */
  var savedLang = null;
  try { savedLang = localStorage.getItem(LANG_KEY); } catch (e) {}
  applyLang(savedLang === 'en' ? 'en' : 'zh');
  tickClock();
  window.setInterval(tickClock, 15000);
  initDescent();
  initDoors();
  bindWindowControls();
})();
