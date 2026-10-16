/* 全站开关机。
   一台老电脑的四个状态，全部由 <html data-power="..."> 驱动：
     off      黑屏，指示灯红色，屏幕内容 inert
     booting  开机动画 + 开机音效，指示灯绿色
     login    头像与姓名选择（Yingning）
     on       桌面
   全部界面都由这里注入，四个页面共用同一套流程。
   这是纯视觉游戏：不会关闭浏览器窗口，也不会影响设备电源或任何数据。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var monitor = document.querySelector('.monitor');
  var screen = document.querySelector('.screen');
  if (!monitor || !screen) return;

  var SESSION_KEY = 'site-session';
  var MAX_WINDOWS = 40;
  var BOOT_MS = 2200;

  var power = null;      /* 由导航注入，稍后再取 */
  var start = null;
  var bootTimer = null;
  var serial = 0;
  var state = 'off';

  /* ---------- 界面骨架 ---------- */

  var bootLayer = document.createElement('div');
  bootLayer.className = 'boot-layer';
  bootLayer.hidden = true;
  bootLayer.setAttribute('aria-hidden', 'true');
  bootLayer.innerHTML =
    '<div class="boot-mark">' +
      '<span class="boot-brand">MARIA<span class="boot-brand-thin">OS</span></span>' +
      '<span class="boot-sub"><span class="lang-zh">正在启动…</span><span class="lang-en">Starting up…</span></span>' +
      '<span class="boot-bar" aria-hidden="true"><i></i><i></i><i></i></span>' +
    '</div>';

  var loginLayer = document.createElement('div');
  loginLayer.className = 'login-layer';
  loginLayer.hidden = true;
  loginLayer.innerHTML =
    '<div class="login-strip" aria-hidden="true"></div>' +
    '<div class="login-card">' +
      '<p class="login-hello"><span class="lang-zh">要登录到这台计算机，请选择账户。</span><span class="lang-en">To log on, select your account.</span></p>' +
      '<button class="login-user" type="button" data-machine-login>' +
        '<span class="login-avatar"><img src="avatar-yingning.png" alt="" width="96" height="96" decoding="async"></span>' +
        '<span class="login-name">Yingning</span>' +
      '</button>' +
      '<p class="login-hint"><span class="lang-zh">点击头像进入桌面</span><span class="lang-en">Click the avatar to enter</span></p>' +
    '</div>' +
    '<div class="login-foot" aria-hidden="true"><span class="login-foot-note">Maria Pan</span><span class="mono login-foot-time">--:--</span></div>';

  var balloon = document.createElement('div');
  balloon.className = 'balloon';
  balloon.hidden = true;
  balloon.setAttribute('role', 'dialog');
  balloon.setAttribute('aria-labelledby', 'balloon-title');
  balloon.innerHTML =
    '<div class="balloon-arrow" aria-hidden="true"></div>' +
    '<div class="balloon-bar">' +
      '<i class="ico ico-info" aria-hidden="true"></i>' +
      '<span class="dtb-title" id="balloon-title"><span class="lang-zh">网站简介</span><span class="lang-en">About this site</span></span>' +
      '<button class="balloon-x" type="button" data-balloon-close aria-label="关闭提示 / Close"><i class="ico ico-x" aria-hidden="true"></i></button>' +
    '</div>' +
    '<div class="balloon-body">' +
      '<p class="lang-zh">hi 欢迎你来到过去。</p>' +
      '<p class="lang-en">hi, welcome to the past.</p>' +
      '<p class="lang-zh">你知道，不管外界如何变化，总有一个地方，或多或少一直都在那里。</p>' +
      '<p class="lang-en">You know, no matter how the world outside changes, there is always somewhere that stays, more or less, right where it was.</p>' +
      '<p class="lang-zh">我是 Maria，这是我第一个 HTML 文件，这里是我的秘密基地！</p>' +
      '<p class="lang-en">I am Maria. This is my very first HTML file, and this is my secret base.</p>' +
      '<p class="lang-zh">希望你能找到一些有趣的，要离开时记得给电脑关机呀！</p>' +
      '<p class="lang-en">I hope you find something fun here. When you leave, remember to shut the computer down.</p>' +
      '<p class="lang-zh">也不知道是不是初次见面，这是一个小礼物！</p>' +
      '<p class="lang-en">I do not know if this is our first meeting — here is a small gift.</p>' +
      '<div class="balloon-gift" data-music-state="idle">' +
        '<button class="gift-play" type="button" data-gift-play aria-pressed="false">' +
          '<i class="ico ico-music" aria-hidden="true"></i>' +
          '<span class="lang-zh">点击播放音乐</span><span class="lang-en">Click to play</span>' +
        '</button>' +
        '<span class="gift-note">' +
          '<span class="gift-note-idle"><span class="lang-zh">Lullaby · 小礼物</span><span class="lang-en">Lullaby · a small gift</span></span>' +
          '<span class="gift-note-playing"><span class="lang-zh">正在播放… 再点一下暂停</span><span class="lang-en">Playing… click again to pause</span></span>' +
        '</span>' +
      '</div>' +
    '</div>' +
    '<div class="balloon-status"><span class="lang-zh">网站说明</span><span class="lang-en">Site note</span></div>';

  var audio = new Audio('Lullaby.mp3');
  audio.loop = true;
  audio.preload = 'none';

  var pile = document.createElement('div');
  pile.className = 'shutdown-layer';
  pile.hidden = true;

  var status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  monitor.appendChild(status);

  screen.appendChild(bootLayer);
  screen.appendChild(loginLayer);
  screen.appendChild(pile);
  screen.appendChild(balloon);

  /* ---------- 小工具 ---------- */

  function zh() { return root.dataset.lang !== 'en'; }
  function say(chinese, english) { status.textContent = zh() ? chinese : english; }

  function readSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === 'on'; } catch (e) { return false; }
  }
  function writeSession(on) {
    try { if (on) sessionStorage.setItem(SESSION_KEY, 'on'); else sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* 开机音效：在电源键点击这个用户手势里创建 AudioContext，浏览器才允许发声。 */
  function chime() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    var ctx;
    try { ctx = new Ctx(); } catch (e) { return; }
    var now = ctx.currentTime;
    [[523.25, 0], [783.99, 0.16], [1046.5, 0.32]].forEach(function (note) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note[0];
      gain.gain.setValueAtTime(0.0001, now + note[1]);
      gain.gain.exponentialRampToValueAtTime(0.16, now + note[1] + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note[1] + 0.42);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + note[1]);
      osc.stop(now + note[1] + 0.46);
    });
    window.setTimeout(function () {
      if (ctx.state !== 'closed') ctx.close();
    }, 1400);
  }

  /* ---------- 状态切换 ---------- */

  function setState(next) {
    state = next;
    root.dataset.power = next;
    var off = next === 'off';
    screen.inert = off;
    if (off) screen.setAttribute('aria-hidden', 'true');
    else screen.removeAttribute('aria-hidden');
    bootLayer.hidden = next !== 'booting';
    loginLayer.hidden = next !== 'login';
    if (next !== 'on') { closeBalloon(false); stopMusic(); }
    if (off) closeBalloon(true);
    updatePowerLabel();
  }

  function updatePowerLabel() {
    if (!power) return;
    var label;
    if (state === 'off') label = zh() ? '电源：开机' : 'Power: turn on';
    else if (state === 'on') label = zh() ? '电源：请求关机' : 'Power: request shutdown';
    else label = zh() ? '电源：正在启动' : 'Power: starting';
    power.setAttribute('aria-label', label);
    power.setAttribute('aria-pressed', String(state === 'on'));
    power.disabled = state === 'booting';
  }

  function boot() {
    if (state === 'booting' || state === 'on') return;
    chime();
    setState('booting');
    say('正在启动。', 'Starting up.');
    window.clearTimeout(bootTimer);
    bootTimer = window.setTimeout(function () {
      if (state !== 'booting') return;
      if (readSession()) {
        setState('on');
        say('已开机。', 'Power on.');
        if (power) power.focus({ preventScroll: true });
      } else {
        setState('login');
        say('请选择账户登录。', 'Select an account to log on.');
        var user = loginLayer.querySelector('[data-machine-login]');
        if (user) user.focus({ preventScroll: true });
      }
    }, BOOT_MS);
  }

  function logIn() {
    if (state !== 'login') return;
    writeSession(true);
    setState('on');
    say('已登录。欢迎回来。', 'Logged on. Welcome back.');
    var first = screen.querySelector('.task-links a[aria-current="page"]') || power;
    if (first) first.focus({ preventScroll: true });
  }

  function shutDown() {
    window.clearTimeout(bootTimer);
    writeSession(false);
    closeBalloon(true);
    pile.replaceChildren();
    serial = 0;
    pile.hidden = true;
    setState('off');
    if (power) power.focus({ preventScroll: true });
    say('屏幕已关闭。按电源键重新开机。', 'Screen off. Press the power button to turn on.');
  }

  /* ---------- 关机游戏：警告窗只会越点越多 ---------- */

  function pileSize() { return pile.children.length; }

  function placeWindows() {
    var area = pile.getBoundingClientRect();
    Array.prototype.forEach.call(pile.children, function (win) {
      var n = Number(win.dataset.order);
      var maxX = Math.max(0, area.width - win.offsetWidth - 8);
      var maxY = Math.max(0, area.height - win.offsetHeight - 8);
      /* 第一个落在中间，之后层层错开。 */
      var x = n === 0 ? 0.5 : ((n * 29 + 35) % 101) / 100;
      var y = n === 0 ? 0.42 : ((n * 19 + 20) % 101) / 100;
      win.style.left = (4 + maxX * x) + 'px';
      win.style.top = (4 + maxY * y) + 'px';
    });
  }

  function addWindow() {
    if (pileSize() >= MAX_WINDOWS) pile.firstElementChild.remove();
    var n = serial++;
    var win = document.createElement('section');
    win.className = 'shutdown-window';
    win.dataset.order = String(n);
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-labelledby', 'shutdown-title-' + n);
    win.setAttribute('aria-describedby', 'shutdown-message-' + n);
    win.innerHTML =
      '<div class="shutdown-titlebar">' +
        '<i class="ico ico-pc" aria-hidden="true"></i>' +
        '<span class="shutdown-title" id="shutdown-title-' + n + '"><span class="lang-zh">关闭计算机</span><span class="lang-en">Shut Down Computer</span></span>' +
        '<button type="button" class="shutdown-control" aria-label="最小化 / Minimize" style="background-image:var(--g-min)"></button>' +
        '<button type="button" class="shutdown-control" aria-label="放大窗口 / Maximize" style="background-image:var(--g-max)"></button>' +
        '<button type="button" class="shutdown-control" aria-label="关闭 / Close" style="background-image:var(--g-x)"></button>' +
      '</div>' +
      '<div class="shutdown-body">' +
        '<span class="shutdown-warning" aria-hidden="true">!</span>' +
        '<p id="shutdown-message-' + n + '"><span class="lang-zh">有内容未保存，确定关机吗？</span><span class="lang-en">You have unsaved content. Are you sure you want to shut down?</span></p>' +
      '</div>' +
      '<div class="shutdown-actions">' +
        '<button type="button" class="classic-btn shutdown-confirm"><span class="lang-zh">确定</span><span class="lang-en">OK</span></button>' +
        '<button type="button" class="classic-btn"><span class="lang-zh">取消</span><span class="lang-en">Cancel</span></button>' +
      '</div>';
    pile.appendChild(win);
    return win;
  }

  function multiply(amount) {
    if (state !== 'on') return;
    pile.hidden = false;
    var latest;
    for (var i = 0; i < amount; i++) latest = addWindow();
    placeWindows();
    var confirmBtn = latest.querySelector('.shutdown-confirm');
    if (confirmBtn) confirmBtn.focus({ preventScroll: true });
    say('有内容未保存，确定关机吗？', 'You have unsaved content. Shut down?');
  }

  /* 弹窗堆起来的时候，站内链接不再跳转，而是继续增殖——想从窗口里逃出去是不行的。
     只有左下角的「开始」能真正清空它们并黑屏。 */
  function guardNavigation(event) {
    if (state !== 'on' || pileSize() === 0) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    var link = event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (!href || href.charAt(0) === '#') return;   /* 页内锚点不值得拦 */
    event.preventDefault();
    multiply(2);
  }

  /* ---------- 小礼物：点一下放音乐，再点一下暂停 ---------- */

  function setMusicState(playing) {
    var box = balloon.querySelector('[data-music-state]');
    var btn = balloon.querySelector('[data-gift-play]');
    if (box) box.dataset.musicState = playing ? 'playing' : 'idle';
    if (btn) btn.setAttribute('aria-pressed', String(playing));
  }

  function stopMusic() {
    if (!audio.paused) audio.pause();
    setMusicState(false);
  }

  function bindGift() {
    var btn = balloon.querySelector('[data-gift-play]');
    if (!btn) return;
    /* 必须由点击这个用户手势触发播放，浏览器才允许出声。 */
    btn.addEventListener('click', function () {
      if (audio.paused) {
        var started = audio.play();
        if (started && typeof started.catch === 'function') {
          started.then(function () {
            setMusicState(true);
            say('正在播放 Lullaby。', 'Playing Lullaby.');
          }).catch(function () {
            setMusicState(false);
            say('音乐无法播放，请确认 Lullaby.mp3 就在网页旁边。', 'Audio could not play. Make sure Lullaby.mp3 sits next to the page.');
          });
        } else {
          setMusicState(true);
        }
      } else {
        audio.pause();
        setMusicState(false);
        say('音乐已暂停。', 'Music paused.');
      }
    });
    audio.addEventListener('ended', function () { setMusicState(false); });
  }

  /* ---------- 系统气泡 ---------- */

  function openBalloon() {
    if (state !== 'on') return;
    balloon.hidden = false;
    root.dataset.balloon = 'open';
    var toggle = document.querySelector('[data-balloon-toggle]');
    if (toggle) toggle.setAttribute('aria-pressed', 'true');
  }
  function closeBalloon(force) {
    if (state !== 'on' && !force) return;
    balloon.hidden = true;
    delete root.dataset.balloon;
    var toggle = document.querySelector('[data-balloon-toggle]');
    if (toggle) toggle.setAttribute('aria-pressed', 'false');
  }
  function bindBalloon() {
    var toggle = document.querySelector('[data-balloon-toggle]');
    var close = balloon.querySelector('[data-balloon-close]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (balloon.hidden) openBalloon();
        else closeBalloon(false);
      });
    }
    if (close) {
      close.addEventListener('click', function (event) {
        event.preventDefault();
        closeBalloon(false);
        var again = document.querySelector('[data-balloon-toggle]');
        if (again) again.focus({ preventScroll: true });
      });
    }
  }

  /* ---------- 绑定 ---------- */

  function bind() {
    power = document.querySelector('[data-machine-power]');
    start = document.querySelector('[data-machine-start]');
    if (!power || !start) return false;

    power.addEventListener('click', function () {
      if (state === 'off') boot();
      else if (state === 'on') multiply(1);
    });

    /* 关掉界面上任何一个按钮，都会再多出两个一样的窗口。 */
    pile.addEventListener('click', function (event) {
      if (event.target.closest('button')) multiply(2);
    });

    start.addEventListener('click', shutDown);

    loginLayer.addEventListener('click', function (event) {
      if (event.target.closest('[data-machine-login]')) logIn();
    });

    document.addEventListener('click', guardNavigation, true);
    window.addEventListener('resize', placeWindows);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(placeWindows).observe(screen);
    new MutationObserver(updatePowerLabel).observe(root, { attributes: true, attributeFilter: ['data-lang'] });
    bindBalloon();
    bindGift();
    return true;
  }

  function start_() {
    if (!bind()) return;   /* 没有电源键的页面不动它 */
    /* 刷新内页时，保持已经登录的状态：直接进入桌面并显示说明气泡。 */
    if (readSession()) {
      setState('on');
      openBalloon();
    } else {
      setState('off');
    }
  }

  /* nav.js 已经排在前面并把任务栏注入完毕；若它这次是异步完成的，再等一次事件。 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start_);
  } else {
    start_();
  }
})();
