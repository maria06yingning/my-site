/* ============================================================
   WEBCORE / DREAMCORE
   风格 / 明暗 / 语言切换，任务栏，语录与项目交互
   ============================================================ */

(function () {
  'use strict';

  var THEME_KEY = 'site-theme';
  var LANG_KEY = 'site-lang';
  var STYLE_KEY = 'site-style';

  function read(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function store(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* 无痕模式忽略 */ }
  }

  /* ---------------- 明暗两套视觉系统 ---------------- */

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    store(THEME_KEY, theme);
    document.querySelectorAll('.ctrl[data-theme-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    });
  }

  function toggleTheme() {
    applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  }

  /* ---------------- 风格：网核 / 梦核 ---------------- */

  var dreamFontsRequested = false;

  // 梦核用到的两款字体：只在切到梦核时才异步加载，网核完全不请求外部字体
  function loadDreamFonts() {
    if (dreamFontsRequested) return;
    dreamFontsRequested = true;
    var l = document.createElement('link');
    l.rel = 'stylesheet';
    l.media = 'print';
    l.onload = function () { l.media = 'all'; };
    l.href = 'https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap';
    document.head.appendChild(l);
  }

  function currentStyle() {
    return document.documentElement.getAttribute('data-style') === 'dream' ? 'dream' : 'web';
  }

  function applyStyle(style) {
    document.documentElement.setAttribute('data-style', style);
    store(STYLE_KEY, style);
    document.querySelectorAll('.ctrl[data-style-toggle]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', style === 'dream' ? 'true' : 'false');
    });
    if (style === 'dream') loadDreamFonts();
    layoutDescent();
  }

  function toggleStyle() {
    applyStyle(currentStyle() === 'dream' ? 'web' : 'dream');
  }

  /* ---------------- 语言 ---------------- */

  function currentLang() {
    return document.documentElement.getAttribute('data-lang') === 'zh' ? 'zh' : 'en';
  }

  function applyLang(lang) {
    document.documentElement.setAttribute('data-lang', lang);
    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh-CN' : 'en');
    store(LANG_KEY, lang);
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
    layoutDescent();   // 中英文字长度不同，需要重新排布台阶
  }

  /* ---------------- 局部载入（含离线兜底） ---------------- */

  var NAV_FALLBACK = '<nav>' +
    '  <a class="logo" href="index.html">' +
    '    <span class="logo-mark dream-only" aria-hidden="true"></span>' +
    '    <i class="ico ico-flag web-only" aria-hidden="true"></i>' +
    '    <span class="lang-zh">我的第一个自制网站</span>' +
    '    <span class="lang-en">My First Self-Made Website</span>' +
    '  </a>' +
    '' +
    '  <ul class="links">' +
    '    <li><a href="index.html" data-page="index.html"><i class="num dream-only">01</i><i class="ico ico-pc web-only" aria-hidden="true"></i><span class="lang-zh">首页</span><span class="lang-en">Home</span></a></li>' +
    '    <li><a href="quote.html" data-page="quote.html"><i class="num dream-only">02</i><i class="ico ico-doc web-only" aria-hidden="true"></i><span class="lang-zh">语录</span><span class="lang-en">Quotes</span></a></li>' +
    '    <li><a href="project.html" data-page="project.html"><i class="num dream-only">03</i><i class="ico ico-folder web-only" aria-hidden="true"></i><span class="lang-zh">项目</span><span class="lang-en">Projects</span></a></li>' +
    '    <li><a href="contact.html" data-page="contact.html"><i class="num dream-only">04</i><i class="ico ico-mail web-only" aria-hidden="true"></i><span class="lang-zh">联系</span><span class="lang-en">Contact</span></a></li>' +
    '  </ul>' +
    '' +
    '  <div class="controls">' +
    '    <button class="ctrl" type="button" data-style-toggle aria-pressed="true" title="切换风格 / switch style" aria-label="切换风格 / switch style">' +
    '      <i class="ctrl-glyph" aria-hidden="true">✦</i>' +
    '      <span class="lang-zh only-web">网核</span><span class="lang-en only-web">Webcore</span>' +
    '      <span class="lang-zh only-dream">梦核</span><span class="lang-en only-dream">Dreamcore</span>' +
    '    </button>' +
    '    <button class="ctrl" type="button" data-theme-toggle aria-pressed="true" aria-label="切换明暗 / toggle light and dark">' +
    '      <span class="ctrl-glyph only-dark dream-only" aria-hidden="true">☾</span><span class="ctrl-glyph only-light dream-only" aria-hidden="true">☀</span>' +
    '      <i class="ico ico-moon only-dark web-only" aria-hidden="true"></i><i class="ico ico-sun only-light web-only" aria-hidden="true"></i>' +
    '      <span class="lang-zh only-dark">夜间</span><span class="lang-en only-dark">Night</span>' +
    '      <span class="lang-zh only-light">白天</span><span class="lang-en only-light">Day</span>' +
    '    </button>' +
    '    <div class="lang-toggle" role="group" aria-label="语言 / language">' +
    '      <button type="button" data-lang="zh">中</button>' +
    '      <button type="button" data-lang="en">EN</button>' +
    '    </div>' +
    '    <span class="clock web-only" aria-hidden="true">--:--</span>' +
    '  </div>' +
    '</nav>';

  var FOOTER_FALLBACK = '' +
    '<p class="lang-zh">由 Yingning Pan 搭建 · Web Technologies 2026</p>' +
    '<p class="lang-en">Built by Yingning Pan · Web Technologies 2026</p>' +
    '<p><a href="mailto:stupidmaria@foxmail.com">stupidmaria@foxmail.com</a></p>';

  function loadPartial(file, targetId, fallback) {
    var host = document.getElementById(targetId);
    if (!host) return;

    fetch(file)
      .then(function (res) {
        if (!res.ok) throw new Error('partial unavailable');
        return res.text();
      })
      .then(function (html) {
        host.innerHTML = html;
      })
      .catch(function () {
        // 直接用 file:// 双击打开时 fetch 会被浏览器拦截，这里兜底
        host.innerHTML = fallback;
      })
      .then(function () {
        if (targetId === 'site-header') bindHeader();
      });
  }

  /* ---------------- 导航交互 ---------------- */

  function tickClock() {
    var d = new Date();
    var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    document.querySelectorAll('.clock').forEach(function (c) { c.textContent = t; });
  }

  function bindHeader() {
    var path = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav .links a').forEach(function (link) {
      if (link.getAttribute('data-page') === path) link.classList.add('active');
    });

    document.querySelectorAll('.ctrl[data-theme-toggle]').forEach(function (btn) {
      btn.addEventListener('click', toggleTheme);
    });

    document.querySelectorAll('.ctrl[data-style-toggle]').forEach(function (btn) {
      btn.addEventListener('click', toggleStyle);
    });

    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        applyLang(btn.getAttribute('data-lang'));
      });
    });

    applyStyle(currentStyle());
    applyTheme(currentTheme());
    applyLang(currentLang());
    tickClock();
    window.setInterval(tickClock, 15000);
  }

  /* ---------------- 语录：逐级向下 + 散雾 ---------------- */

  var STEPS = [];

  function stepLength(el) {
    var lang = currentLang();
    var block = el.querySelector('.lang-' + lang + ' blockquote');
    var raw = block ? block.textContent.replace(/\s+/g, ' ').trim().length : 0;
    // 中文信息密度更高，折算成等效英文长度
    return lang === 'zh' ? raw * 1.5 : raw;
  }

  function layoutDescent() {
    if (!STEPS.length) return;

    var narrow = window.innerWidth <= 780;
    var CYCLE = 5;

    STEPS.forEach(function (el, i) {
      el.style.setProperty('--i', i);

      if (narrow) {
        el.style.removeProperty('--col');
        return;
      }

      var len = stepLength(el);
      // 长短自适应：短句窄，长段宽
      var span = len < 70 ? 3 : len < 170 ? 4 : len < 300 ? 5 : 6;

      // 阶梯：先向右下行进，到边后折回，形成逐级向下的错觉
      var k = i % CYCLE;
      var rightward = Math.floor(i / CYCLE) % 2 === 0;
      var pos = rightward ? k : (CYCLE - 1 - k);
      var start = Math.min(1 + pos, 12 - span + 1);

      el.style.setProperty('--col', start + ' / span ' + span);
    });
  }

  function initDescent() {
    var grid = document.querySelector('.descent');
    if (!grid) return;

    STEPS = Array.prototype.slice.call(grid.querySelectorAll('.step'));
    if (!STEPS.length) return;

    var counter = document.getElementById('fog-count');
    var allBtn = document.getElementById('fog-all');

    function updateCount() {
      if (!counter) return;
      var open = STEPS.filter(function (s) { return s.classList.contains('is-open'); }).length;
      counter.textContent = pad(open) + ' / ' + pad(STEPS.length);
    }

    function pad(n) {
      return (n < 10 ? '0' : '') + n;
    }

    function setOpen(el, open) {
      el.classList.toggle('is-open', open);
      var btn = el.querySelector('.step-fog');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }

    function syncAllLabel() {
      if (!allBtn) return;
      var allOpen = STEPS.every(function (s) { return s.classList.contains('is-open'); });
      allBtn.innerHTML = allOpen
        ? '<span class="lang-zh">全部收起</span><span class="lang-en">close all</span>'
        : '<span class="lang-zh">全部展开</span><span class="lang-en">open all</span>';
    }

    STEPS.forEach(function (el) {
      var btn = el.querySelector('.step-fog');
      if (!btn) return;
      btn.addEventListener('click', function () {
        setOpen(el, !el.classList.contains('is-open'));
        updateCount();
        syncAllLabel();
      });
    });

    if (allBtn) {
      allBtn.addEventListener('click', function () {
        var anyClosed = STEPS.some(function (s) { return !s.classList.contains('is-open'); });

        if (anyClosed) {
          // 顺着语录一级一级散开
          STEPS.forEach(function (el, i) {
            if (el.classList.contains('is-open')) return;
            window.setTimeout(function () {
              setOpen(el, true);
              updateCount();
            }, 90 * i);
          });
          window.setTimeout(syncAllLabel, 90 * STEPS.length + 400);
        } else {
          STEPS.forEach(function (el) { setOpen(el, false); });
          updateCount();
          syncAllLabel();
        }
      });
    }

    layoutDescent();
    updateCount();
    syncAllLabel();

    var resizeTimer;
    window.addEventListener('resize', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(layoutDescent, 160);
    });
  }

  /* ---------------- 项目：一扇扇门 ---------------- */

  function initDoors() {
    document.querySelectorAll('.door').forEach(function (el, i) {
      el.style.setProperty('--i', i);
      var btn = el.querySelector('.door-face');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });
  }

  /* ---------------- 启动 ---------------- */

  applyStyle(currentStyle());
  applyTheme(currentTheme());
  applyLang(currentLang());

  initDescent();
  initDoors();

  loadPartial('nav.html', 'site-header', NAV_FALLBACK);
  loadPartial('footer.html', 'site-footer', FOOTER_FALLBACK);
})();
