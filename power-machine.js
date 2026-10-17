/* 全站开关机。
   一台老电脑的四个状态，全部由 <html data-power="..."> 驱动：
     off      黑屏，指示灯红色，屏幕内容 inert
     booting  开机动画 + 开机音效，指示灯绿色
     login    头像与姓名选择（Yingning）
     on       桌面
   全部界面都由这里注入，四个页面共用同一套流程。
   这是纯视觉游戏：不会关闭浏览器窗口，也不会影响设备电源或任何数据。

   两点补充：
   · 音乐的状态和进度记在 sessionStorage 里，换页后自动接着放（同一次浏览会话）。
   · 系统音效全部用 Web Audio 现场合成，不依赖任何音频文件，也不涉及他人录音的版权。 */
(function () {
  'use strict';

  var root = document.documentElement;
  var monitor = document.querySelector('.monitor');
  var screen = document.querySelector('.screen');
  if (!monitor || !screen) return;

  var SESSION_KEY = 'site-session';
  var BALLOON_KEY = 'site-balloon-seen';
  var MUSIC_KEY = 'site-music';
  var BOOT_MS = 2200;
  /* 弹窗堆的下限和上限。实际可用数量按屏幕面积算，见 pileCapacity()。 */
  var MIN_PILE = 72;
  var MAX_PILE = 320;

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
        '<button class="gift-play" type="button" data-gift-play aria-pressed="false" aria-label="打开礼物">' +
          '<span class="gift-box" aria-hidden="true"><span class="gift-glow"></span><span class="gift-base"></span><span class="gift-lid"><span class="gift-bow"></span></span><span class="gift-spark">♪</span></span>' +
        '</button>' +
      '</div>' +
    '</div>' +
    '<div class="balloon-status"><span class="lang-zh">网站说明</span><span class="lang-en">Site note</span></div>';

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

  function isHomePage() {
    var file = location.pathname.split('/').pop();
    return file === '' || file === 'index.html';
  }

  function readSession() {
    try { return sessionStorage.getItem(SESSION_KEY) === 'on'; } catch (e) { return false; }
  }
  function writeSession(on) {
    try { if (on) sessionStorage.setItem(SESSION_KEY, 'on'); else sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function balloonSeen() {
    try { return sessionStorage.getItem(BALLOON_KEY) === '1'; } catch (e) { return false; }
  }
  function markBalloonSeen() {
    try { sessionStorage.setItem(BALLOON_KEY, '1'); } catch (e) {}
  }
  function clearBalloonSeen() {
    try { sessionStorage.removeItem(BALLOON_KEY); } catch (e) {}
  }

  /* ---------- 系统音效 ----------
     三个声音都由振荡器现场合成：开机、收到信息、警告。
     共用一个 AudioContext —— 它必须在用户点击里被创建/唤醒，之后才能随时发声。 */

  var audioCtx = null;
  var lastWarnAt = 0;

  function soundCtx() {
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      try { audioCtx = new Ctx(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
      try { audioCtx.resume(); } catch (e) {}
    }
    return audioCtx;
  }

  /* 一个带衰减的音符。bell 用两个泛音叠出老系统提示音那种“叮”的金属感。 */
  function tone(ctx, freq, at, dur, level, type) {
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  /* 开机：三连上行。 */
  function bootChime() {
    var ctx = soundCtx();
    if (!ctx) return;
    var t = ctx.currentTime + 0.01;
    [[523.25, 0], [783.99, 0.16], [1046.5, 0.32]].forEach(function (note) {
      tone(ctx, note[0], t + note[1], 0.44, 0.14, 'sine');
    });
  }

  /* 收到信息：老 Windows 那种两声轻快的“叮—咚”。 */
  function notifySound() {
    var ctx = soundCtx();
    if (!ctx) return;
    var t = ctx.currentTime + 0.02;
    tone(ctx, 987.77, t, 0.42, 0.10, 'sine');
    tone(ctx, 1975.5, t, 0.24, 0.026, 'sine');
    tone(ctx, 1318.51, t + 0.14, 0.56, 0.085, 'triangle');
    tone(ctx, 2637.02, t + 0.14, 0.28, 0.02, 'sine');
  }

  /* 警告：下行的“咚—叮”，带一点老系统那种生硬的钟味。
     弹窗越多，音高略升，像机器越来越急。 */
  function warnSound() {
    var now = window.performance && performance.now ? performance.now() : Date.now();
    if (now - lastWarnAt < 130) return;
    lastWarnAt = now;
    var ctx = soundCtx();
    if (!ctx) return;
    var lift = 1 + Math.min(pileSize(), 20) * 0.009;
    var t = ctx.currentTime + 0.01;
    tone(ctx, 830.61 * lift, t, 0.26, 0.085, 'triangle');
    tone(ctx, 1661.22 * lift, t, 0.14, 0.02, 'sine');
    tone(ctx, 622.25 * lift, t + 0.15, 0.5, 0.08, 'triangle');
    tone(ctx, 311.13 * lift, t + 0.15, 0.34, 0.026, 'sine');
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

  /* 开机进桌面后，在主页把说明气泡缓缓放出来（每次开机只放一次）。 */
  function greetOnHome() {
    if (!isHomePage() || balloonSeen()) return false;
    markBalloonSeen();
    openBalloon(true);
    return true;
  }

  function boot() {
    if (state === 'booting' || state === 'on') return;
    bootChime();
    setState('booting');
    say('正在启动。', 'Starting up.');
    window.clearTimeout(bootTimer);
    bootTimer = window.setTimeout(function () {
      if (state !== 'booting') return;
      if (readSession()) {
        setState('on');
        say('已开机。', 'Power on.');
        greetOnHome();
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
    /* 这一下点击已经把音频上下文唤醒了，提示音现在才发得出来。 */
    if (greetOnHome()) window.setTimeout(notifySound, 140);
    var first = screen.querySelector('.task-links a[aria-current="page"]') || power;
    if (first) first.focus({ preventScroll: true });
  }

  function shutDown() {
    window.clearTimeout(bootTimer);
    writeSession(false);
    closeBalloon(true);
    stopMusic(true);
    pile.replaceChildren();
    serial = 0;
    pile.hidden = true;
    delete root.dataset.pile;
    clearBalloonSeen();
    setState('off');
    if (power) power.focus({ preventScroll: true });
    say('屏幕已关闭。按电源键重新开机。', 'Screen off. Press the power button to turn on.');
  }

  /* ---------- 关机游戏：警告窗只会越点越多，直到铺满整个屏幕 ---------- */

  function pileSize() { return pile.children.length; }

  /* 上限不是一个写死的数字：按当前屏幕和窗口实际尺寸算出需要几个才铺满。
     随机摆放会出现重叠，所以不能只按“格子数”算——按随机覆盖估算，
     乘 7 后约能盖住 99.9% 的面积，边缘也会被压住。 */
  function pileCapacity() {
    var area = pile.getBoundingClientRect();
    if (!area.width || !area.height) return MIN_PILE;
    var probe = pile.firstElementChild;
    var w = (probe && probe.offsetWidth) || Math.min(330, Math.max(180, area.width - 8));
    var h = (probe && probe.offsetHeight) || 186;
    var cols = Math.max(1, Math.ceil(area.width / Math.max(1, w)));
    var rows = Math.max(1, Math.ceil(area.height / Math.max(1, h)));
    return Math.max(MIN_PILE, Math.min(MAX_PILE, Math.ceil(cols * rows * 7)));
  }

  /* 每个窗口出生时只抽取一次随机位置。增殖不重新排列旧窗口；
     缩放屏幕时沿用相对坐标，避免越界，也不会变成整齐的网格。 */
  function placeWindows() {
    var kids = pile.children;
    if (!kids.length) return;
    var area = pile.getBoundingClientRect();
    if (!area.width || !area.height) return;
    for (var i = 0; i < kids.length; i++) {
      var win = kids[i];
      if (win.dataset.randomX === undefined) {
        win.dataset.randomX = String(Math.random());
        win.dataset.randomY = String(Math.random());
      }
      var spanX = Math.max(0, area.width - win.offsetWidth);
      var spanY = Math.max(0, area.height - win.offsetHeight);
      win.style.left = Math.round(Number(win.dataset.randomX) * spanX) + 'px';
      win.style.top = Math.round(Number(win.dataset.randomY) * spanY) + 'px';
    }
  }

  function addWindow() {
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
    root.dataset.pile = 'open';
    var cap = pileCapacity();
    var latest;
    for (var i = 0; i < amount; i++) {
      /* 到达上限后不再无限堆 DOM，而是把最早的那个挪走：画面保持铺满，性能也不塌。 */
      if (pileSize() >= cap) {
        var oldest = pile.firstElementChild;
        if (oldest) oldest.remove();
      }
      latest = addWindow();
    }
    placeWindows();
    warnSound();
    if (latest) {
      var confirmBtn = latest.querySelector('.shutdown-confirm');
      if (confirmBtn) confirmBtn.focus({ preventScroll: true });
    }
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

  /* ---------- 小礼物：点一下放音乐，再点一下暂停 ----------
     换页时把“是否在放”和播放位置记进 sessionStorage，
     新页面载入后自动接上，不用再点一次。 */

  var audio = new Audio('Lullaby.mp3');
  audio.loop = true;
  audio.preload = 'auto';

  var musicWanted = false;    /* 用户希望音乐在放（即使此刻被浏览器拦着） */
  var resumeArmed = false;
  var lastSaveAt = 0;

  function readMusic() {
    try { return JSON.parse(sessionStorage.getItem(MUSIC_KEY) || 'null'); }
    catch (e) { return null; }
  }

  function saveMusic(force) {
    if (!force && !musicWanted) return;
    try {
      sessionStorage.setItem(MUSIC_KEY, JSON.stringify({
        on: musicWanted,
        time: audio.currentTime || 0
      }));
    } catch (e) {}
  }

  function clearMusic() {
    try { sessionStorage.removeItem(MUSIC_KEY); } catch (e) {}
  }

  function setMusicState(playing) {
    var box = balloon.querySelector('[data-music-state]');
    var btn = balloon.querySelector('[data-gift-play]');
    if (box) box.dataset.musicState = playing ? 'playing' : 'idle';
    if (btn) {
      btn.setAttribute('aria-pressed', String(playing));
      btn.setAttribute('aria-label', playing
        ? (zh() ? '合上礼物，暂停音乐' : 'Close gift, pause music')
        : (zh() ? '打开礼物' : 'Open gift'));
    }
  }

  function playMusic() {
    if (!musicWanted) return;
    var started = audio.play();
    if (started && typeof started.then === 'function') {
      started.then(function () {
        setMusicState(true);
        saveMusic(true);
      }).catch(function () {
        setMusicState(false);
        armResume();
      });
    } else {
      setMusicState(true);
    }
  }

  /* 浏览器不许无手势自动播放时：等你在新页面上的第一下点击，再从原处接上。 */
  function armResume() {
    if (!musicWanted || resumeArmed) return;
    resumeArmed = true;
    var once = function (event) {
      /* 点礼物按钮本身交给它自己的处理函数，免得播放和暂停互相抵消。 */
      if (event && event.target && event.target.closest && event.target.closest('.balloon-gift')) return;
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
      resumeArmed = false;
      playMusic();
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
  }

  function restoreMusic() {
    var saved = readMusic();
    if (!saved || !saved.on) return;
    musicWanted = true;
    try { audio.currentTime = Math.max(0, Number(saved.time) || 0); } catch (e) {}
    playMusic();
    setMusicState(!audio.paused);
  }

  function stopMusic(forget) {
    var wasWanted = musicWanted;
    musicWanted = false;
    resumeArmed = false;
    if (!audio.paused) audio.pause();
    setMusicState(false);
    if (forget) clearMusic();
    else if (wasWanted) saveMusic(true);
  }

  audio.addEventListener('play', function () { setMusicState(true); });
  audio.addEventListener('pause', function () { setMusicState(false); });
  audio.addEventListener('timeupdate', function () {
    var now = Date.now();
    if (now - lastSaveAt < 900) return;
    lastSaveAt = now;
    if (musicWanted) saveMusic(false);
  });
  /* 离开页面（含换页、刷新、关标签）时把进度写下来。 */
  window.addEventListener('pagehide', function () { saveMusic(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') saveMusic(true);
  });

  function bindGift() {
    var btn = balloon.querySelector('[data-gift-play]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!musicWanted) {
        musicWanted = true;
        playMusic();
        say('正在播放 Lullaby。', 'Playing Lullaby.');
      } else if (audio.paused) {
        playMusic();
        say('正在播放 Lullaby。', 'Playing Lullaby.');
      } else {
        musicWanted = false;
        audio.pause();
        saveMusic(true);
        say('音乐已暂停。', 'Music paused.');
      }
    });
  }

  /* ---------- 系统气泡 ---------- */

  function openBalloon(animate) {
    if (state !== 'on') return;
    balloon.hidden = false;
    root.dataset.balloon = 'open';
    if (animate) {
      balloon.classList.remove('is-appearing');
      void balloon.offsetWidth;      /* 强制重排，动画才能重播 */
      balloon.classList.add('is-appearing');
    }
    var toggle = document.querySelector('[data-balloon-toggle]');
    if (toggle) toggle.setAttribute('aria-pressed', 'true');
  }
  function closeBalloon(force) {
    if (state !== 'on' && !force) return;
    balloon.hidden = true;
    balloon.classList.remove('is-appearing');
    delete root.dataset.balloon;
    var toggle = document.querySelector('[data-balloon-toggle]');
    if (toggle) toggle.setAttribute('aria-pressed', 'false');
    if (state === 'on') markBalloonSeen();
  }
  function bindBalloon() {
    var toggle = document.querySelector('[data-balloon-toggle]');
    var close = balloon.querySelector('[data-balloon-close]');
    if (toggle) {
      toggle.addEventListener('click', function () {
        if (balloon.hidden) openBalloon(true);
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
    balloon.addEventListener('animationend', function () {
      balloon.classList.remove('is-appearing');
    });
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
    new MutationObserver(function () {
      updatePowerLabel();
      setMusicState(!audio.paused);
      placeWindows();
    }).observe(root, { attributes: true, attributeFilter: ['data-lang'] });
    setMusicState(!audio.paused);
    bindBalloon();
    bindGift();
    return true;
  }

  function start_() {
    if (!bind()) return;   /* 没有电源键的页面不动它 */
    /* 换页或刷新后保持已登录状态，并接着放刚才那首歌。 */
    if (readSession()) {
      setState('on');
      restoreMusic();
      greetOnHome();
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
