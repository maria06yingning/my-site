/* 全站唯一一份导航。
   四个页面各自只留一个空的 <header id="site-header"></header>，任务栏标记由这里注入，
   页面之间不可能再各自走样（原来四份内嵌的标记已经删除）。
   这里直接注入字符串，而不是 fetch nav.html —— 用 file:// 直接打开本地文件时也能工作。
   nav.html 保留为同一份标记的可读镜像，方便对照。

   常驻链接走“软导航”：只替换窗口里的内容，不重新载入整个文档。
   这样音乐不会因为换页被打断（音频元素挂在文档上，文档一直没走），
   URL 仍然通过 history 正常变化，刷新和直接打开某个页面也照旧是普通的多页 HTML。 */
(function () {
  'use strict';

  var LANG_KEY = 'site-lang';
  var LANG_CHOSEN_KEY = 'site-lang-chosen';
  var SKIP_SCRIPTS = ['nav.js', 'power-machine.js'];
  var navToken = 0;

  var NAV_HTML =
    '<nav class="taskbar" aria-label="主导航">\n' +
    '  <button class="start-label" type="button" data-machine-start aria-label="开始 / Start"><i class="ico ico-flag" aria-hidden="true"></i><span class="start-word lang-zh">开始</span><span class="start-word lang-en">Start</span></button>\n' +
    '  <span class="taskbar-divider" aria-hidden="true"></span>\n' +
    '  <ul class="task-links">\n' +
    '    <li><a href="index.html" data-page="index.html"><i class="ico ico-pc" aria-hidden="true"></i><span class="lang-zh">首页</span><span class="lang-en">Home</span></a></li>\n' +
    '    <li><a href="quote.html" data-page="quote.html"><i class="ico ico-doc" aria-hidden="true"></i><span class="lang-zh">语录</span><span class="lang-en">Quotes</span></a></li>\n' +
    '    <li><a href="project.html" data-page="project.html"><i class="ico ico-folder" aria-hidden="true"></i><span class="lang-zh">项目</span><span class="lang-en">Projects</span></a></li>\n' +
    '    <li><a href="contact.html" data-page="contact.html"><i class="ico ico-mail" aria-hidden="true"></i><span class="lang-zh">联系</span><span class="lang-en">Contact</span></a></li>\n' +
    '  </ul>\n' +
    '  <div class="system-tray">\n' +
    '    <button class="tray-balloon" type="button" data-balloon-toggle aria-label="网站简介 / About this site" aria-pressed="false"><i class="ico ico-info" aria-hidden="true"></i></button>\n' +
    '    <div class="lang-toggle" role="group" aria-label="语言"><button type="button" data-lang="zh" aria-label="中文">中</button><button type="button" data-lang="en" aria-label="English">EN</button></div>\n' +
    '    <time class="clock" aria-label="本地时间">--:--</time>\n' +
    '  </div>\n' +
    '</nav>';

  function currentLang() {
    return document.documentElement.dataset.lang || 'zh';
  }

  function applyLang(lang, chosen) {
    document.documentElement.dataset.lang = lang;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    try {
      localStorage.setItem(LANG_KEY, lang);
      /* 只在用户真的按过语言按钮时才记“已选择”，
         否则登录界面没法区分“默认中文”和“用户选了中文”。 */
      if (chosen) {
        localStorage.setItem(LANG_CHOSEN_KEY, '1');
        document.documentElement.dataset.langChosen = '1';
      }
    } catch (e) { /* 隐私模式下忽略 */ }
    document.querySelectorAll('.lang-toggle button').forEach(function (b) {
      var on = b.dataset.lang === lang;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    syncAllLabel();
  }

  /* 语言敏感的文案：全部展开 / 全部收起 */
  function syncAllLabel() {
    var allBtn = document.getElementById('fog-all');
    if (!allBtn) return;
    var lang = currentLang();
    var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
    var opened = steps.filter(function (el) { return el.classList.contains('is-open'); }).length;
    var counter = document.getElementById('fog-count');
    if (counter) counter.textContent = String(opened).padStart(2, '0') + ' / ' + String(steps.length).padStart(2, '0');
    steps.forEach(function (el) {
      var tick = el.querySelector('.step-tick');
      if (tick) tick.textContent = el.classList.contains('is-open') ? '−' : '+';
    });
    allBtn.innerHTML = (steps.length === opened)
      ? (lang === 'zh' ? '全部收起' : 'close all')
      : (lang === 'zh' ? '全部展开' : 'open all');
  }

  function tickClock() {
    var d = new Date();
    var t = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    document.querySelectorAll('.clock').forEach(function (c) { c.textContent = t; });
  }

  /* 语言切换按钮：注入之后再绑定，保证一定生效 */
  function bindLangToggle() {
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      btn.addEventListener('click', function () { applyLang(btn.dataset.lang, true); });
    });
  }

  /* 当前页高亮。软导航之后要能重算，所以每次都按 URL 重新标记。 */
  function markActive() {
    var page = location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.task-links a').forEach(function (link) {
      var on = link.dataset.page === page;
      link.classList.toggle('active', on);
      if (on) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  /* 点自己那一页：不重新载入，只是把被最小化的窗口还原回来。 */
  function bindActiveLink() {
    var links = document.querySelector('.task-links');
    if (!links || links.dataset.bound === '1') return;
    links.dataset.bound = '1';
    links.addEventListener('click', function (event) {
      var link = event.target.closest('a[data-page]');
      if (!link || !link.classList.contains('active')) return;
      var win = document.querySelector('.dialog-page');
      if (!win) return;             /* 首页本身没有窗口，点了等于刷新 */
      event.preventDefault();
      win.classList.remove('is-minimized');
      var heading = win.querySelector('h1');
      if (heading) {
        heading.tabIndex = -1;
        heading.focus();
      }
    });
  }

  /* 窗口控制：最小化 / 最大化 */
  function bindWindowControls() {
    var win = document.querySelector('.dialog-page');
    if (!win) return;
    win.querySelectorAll('[data-window]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.window;
        if (action === 'minimize') {
          win.classList.toggle('is-minimized');
          var active = document.querySelector('.task-links a.active');
          if (active) active.focus();
        } else if (action === 'maximize') {
          win.classList.toggle('is-maximized');
          win.classList.remove('is-minimized');
          btn.setAttribute('aria-pressed', String(win.classList.contains('is-maximized')));
        }
      });
    });
  }

  /* 语录 / 项目的展开收起 */
  function initDescent() {
    if (!document.querySelector('.descent')) return;
    document.querySelectorAll('.step').forEach(function (el) {
      var btn = el.querySelector('.step-fog');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
        syncAllLabel();
      });
    });
    var allBtn = document.getElementById('fog-all');
    if (allBtn) {
      allBtn.addEventListener('click', function () {
        var openAll = document.querySelectorAll('.step:not(.is-open)').length > 0;
        document.querySelectorAll('.step').forEach(function (el) {
          el.classList.toggle('is-open', openAll);
          var btn = el.querySelector('.step-fog');
          if (btn) btn.setAttribute('aria-expanded', String(openAll));
        });
        syncAllLabel();
      });
    }
  }

  function initDoors() {
    document.querySelectorAll('.door').forEach(function (el) {
      var btn = el.querySelector('.door-face');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = !el.classList.contains('is-open');
        el.classList.toggle('is-open', open);
        btn.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /* 内容换过之后的重新绑定。任务栏是常驻的，只重算高亮；窗口内的绑定随新节点重来。 */
  function reinitContent() {
    markActive();
    bindWindowControls();
    initDescent();
    initDoors();
    syncAllLabel();
  }

  function mountNav() {
    var host = document.getElementById('site-header');
    if (!host) return;
    host.innerHTML = NAV_HTML;
  }

  /* ---------- 软导航 ---------- */

  function canSoftNav() {
    return location.protocol !== 'file:' && 'fetch' in window && 'DOMParser' in window && 'history' in window;
  }

  /* 只接手本地的 .html 链接；外链、锚点、下载、新窗口一律交给浏览器。 */
  function internalUrl(link) {
    if (!link || !link.getAttribute) return null;
    if (link.target && link.target !== '_self') return null;
    if (link.hasAttribute('download')) return null;
    var href = link.getAttribute('href');
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) return null;
    if (!/\.html($|[?#])/i.test(href)) return null;
    var url;
    try { url = new URL(href, location.href); } catch (e) { return null; }
    if (url.origin !== location.origin) return null;
    return url;
  }

  /* 页面内容就是窗口本身；首页没有窗口，只有一个 sr-only 的 main，两者可以互相替换。 */
  function contentNode(doc) {
    if (!doc) return null;
    return doc.querySelector('.dialog-page') || doc.querySelector('.screen > main#content');
  }

  function currentContent() {
    return document.querySelector('.screen > .dialog-page') || document.querySelector('.screen > main#content');
  }

  function runPageScripts(doc) {
    Array.prototype.forEach.call(doc.querySelectorAll('script[src]'), function (old) {
      var src = old.getAttribute('src');
      if (!src) return;
      var skip = SKIP_SCRIPTS.some(function (name) { return src.indexOf(name) !== -1; });
      if (skip) return;
      var s = document.createElement('script');
      s.src = src;
      document.body.appendChild(s);
    });
  }

  function softLoad(url, push) {
    var mine = ++navToken;
    fetch(url.href, { credentials: 'same-origin' })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.text();
      })
      .then(function (html) {
        if (mine !== navToken) return;
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var next = contentNode(doc);
        var screen = document.querySelector('.screen');
        var header = document.getElementById('site-header');
        if (!next || !screen) throw new Error('no content');
        var node = document.importNode(next, true);
        var cur = currentContent();
        if (cur) cur.replaceWith(node);
        else screen.insertBefore(node, header);
        document.title = doc.title;
        if (doc.body && doc.body.className) document.body.className = doc.body.className;
        if (push) history.pushState({ soft: true }, '', url.href);
        reinitContent();
        runPageScripts(doc);
        /* 让键盘用户知道自己已经到了新窗口，鼠标点击不会留下焦点框。 */
        var win = document.querySelector('.dialog-page');
        if (win) {
          win.tabIndex = -1;
          win.focus({ preventScroll: true });
        }
      })
      .catch(function (err) {
        console.warn('SOFTNAV_FAIL', err && err.message, err && err.stack);
        if (mine !== navToken) return;
        location.href = url.href;   /* 任何一步失败都退回普通跳转，功能不受影响 */
      });
  }

  function bindSoftNav() {
    document.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      var root = document.documentElement;
      if (root.dataset.power !== 'on') return;
      /* 关机游戏进行中时，站内链接归 power-machine.js 管：点一下只会多出两个窗口。 */
      if (root.dataset.pile === 'open') return;
      var link = event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || link.classList.contains('active')) return;
      var url = internalUrl(link);
      if (!url || !canSoftNav()) return;
      event.preventDefault();
      softLoad(url, true);
    }, false);

    window.addEventListener('popstate', function () {
      if (!canSoftNav()) return;
      softLoad(new URL(location.href), false);
    });
  }

  function init() {
    mountNav();
    bindLangToggle();
    applyLang(document.documentElement.dataset.lang === 'en' ? 'en' : 'zh');
    tickClock();
    window.setInterval(tickClock, 15000);
    markActive();
    bindActiveLink();
    bindWindowControls();
    initDescent();
    initDoors();
    bindSoftNav();
    /* 电源脚本依赖这里的 Start 按钮。nav.js 在页面里排在它前面，所以标志位此时已经就绪。 */
    window.__siteNavReady = true;
    document.dispatchEvent(new CustomEvent('site:nav-ready'));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
