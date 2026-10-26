/* 全站开关机。
   一台老电脑的四个状态，全部由 <html data-power="..."> 驱动：
     off      黑屏，指示灯红色，屏幕内容 inert
     booting  开机动画 + 开机音效，指示灯绿色
     login    头像与姓名选择（Yingning）
     on       桌面
   全部界面都由这里注入，四个页面共用同一套流程。
   这是纯视觉游戏：不会关闭浏览器窗口，也不会影响设备电源或任何数据。

   桌面上的四个机构：
     · 任务栏「开始」   从左侧弹出一个纸团，点一下拆一层，拆到最后是说明纸（带礼物）
     · 纸团本身         可再次揉起，也可以直接拎到回收站
     · 电源键           开机 / 请求关机
     · 系统托盘的信息键 弹出「关闭计算机」警告窗，每点一次翻倍
     · 回收站           把纸团、警告窗、页面窗口拖上去就收进去，图标会变满

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
  var PAPER_KEY = 'site-paper-seen';
  var MUSIC_KEY = 'site-music';
  var BOOT_MS = 2200;
  /* 弹窗堆的下限和上限。实际可用数量按屏幕面积算，见 pileCapacity()。 */
  var MIN_PILE = 72;
  var MAX_PILE = 320;

  /* 拖拽判定：手指/指针挪动超过这个像素才算“拎起来”，否则仍然算点击。 */
  var DRAG_THRESHOLD = 6;
  /* 拎起来再松手时浏览器仍会补一个 click：这段时间里所有点击都当作拖拽的余波。 */
  var suppressClickUntil = 0;
  /* 落在回收站周围这么宽的范围内都算放进去。 */
  var TRASH_PAD = 20;
  /* 丢进回收站的那一下收拢动画时长，与 CSS 里的 .is-tossed 对齐。 */
  var TOSS_MS = 380;

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

  /* 回收站：老系统桌面上那只铁皮桶。空/满两只图标由 CSS 变量切换。 */
  var trash = document.createElement('button');
  trash.type = 'button';
  trash.className = 'desktop-trash';
  trash.setAttribute('data-trash', '');
  trash.setAttribute('aria-label', '回收站：空 / Recycle Bin: empty');
  trash.innerHTML =
    '<span class="desktop-trash-ico" aria-hidden="true"></span>' +
    '<span class="desktop-trash-label"><span class="lang-zh">回收站</span><span class="lang-en">Recycle Bin</span></span>';

  /* 纸团 → 说明纸。一个容器里叠两层：揉皱的纸团、摊开的纸。
     拆解/揉起只做 transform / opacity / filter，层级由 data-stage 决定。 */
  /* 纸团表面的起伏：湍流 + 漫反射光照，做成 CSS 滤镜供 .ball-core 引用。
     纯声明式，没有 JS 也照样渲染；不支持的浏览器会退回平面色。 */
  var paperDefs = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  paperDefs.setAttribute('aria-hidden', 'true');
  paperDefs.setAttribute('width', '0');
  paperDefs.setAttribute('height', '0');
  paperDefs.setAttribute('focusable', 'false');
  paperDefs.style.position = 'absolute';
  paperDefs.innerHTML =
    '<filter id="paper-relief" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.03 0.04" numOctaves="3" seed="5" result="noise"></feTurbulence>' +
      '<feDiffuseLighting in="noise" lighting-color="#fffdf0" surfaceScale="4" diffuseConstant="1" result="light">' +
        '<feDistantLight azimuth="310" elevation="55"></feDistantLight>' +
      '</feDiffuseLighting>' +
      '<feBlend in="SourceGraphic" in2="light" mode="multiply" result="shaded"></feBlend>' +
      '<feComposite in="shaded" in2="SourceGraphic" operator="in"></feComposite>' +
    '</filter>';

  /* 说明纸：只在某一颗纸团被拆开时出现。纸团本身可以有任意多颗。 */
  var paper = document.createElement('div');
  paper.className = 'paper';
  paper.hidden = true;
  paper.dataset.stage = '0';
  paper.innerHTML =
    '<div class="paper-sheet" role="dialog" aria-modal="false" aria-labelledby="paper-title" tabindex="-1">' +
      '<div class="paper-head" data-paper-handle>' +
        '<span class="paper-title" id="paper-title"><span class="lang-zh">网站简介</span><span class="lang-en">About this site</span></span>' +
        '<span class="paper-grip" aria-hidden="true"><span class="lang-zh">点一下揉起来</span><span class="lang-en">click to crumple</span></span>' +
      '</div>' +
      '<div class="paper-body">' +
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
        '<div class="paper-gift" data-music-state="idle">' +
          '<button class="gift-play" type="button" data-gift-play aria-pressed="false" aria-label="打开礼物">' +
            '<span class="gift-box" aria-hidden="true"><span class="gift-glow"></span><span class="gift-base"></span><span class="gift-lid"><span class="gift-bow"></span></span><span class="gift-spark">♪</span></span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="paper-foot">' +
        '<button class="classic-btn paper-btn" type="button" data-paper-crumple><span class="lang-zh">揉成纸团</span><span class="lang-en">Crumple it</span></button>' +
        '<button class="classic-btn paper-btn" type="button" data-paper-trash><span class="lang-zh">放进回收站</span><span class="lang-en">Put in bin</span></button>' +
      '</div>' +
    '</div>';

  /* 桌面上的纸团层：每按一次「开始」就多一颗，散布在桌面左下角一带。 */
  var ballLayer = document.createElement('div');
  ballLayer.className = 'paper-layer';
  ballLayer.setAttribute('role', 'group');
  ballLayer.setAttribute('aria-label', '纸团 / Paper balls');

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
  screen.appendChild(trash);
  screen.appendChild(pile);
  screen.appendChild(paperDefs);
  screen.appendChild(ballLayer);
  screen.appendChild(paper);

  var sheetEl = paper.querySelector('.paper-sheet');

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
  function paperSeen() {
    try { return sessionStorage.getItem(PAPER_KEY) === '1'; } catch (e) { return false; }
  }
  function markPaperSeen() {
    try { sessionStorage.setItem(PAPER_KEY, '1'); } catch (e) {}
  }
  function clearPaperSeen() {
    try { sessionStorage.removeItem(PAPER_KEY); } catch (e) {}
  }

  /* ---------- 系统音效 ----------
     声音都由振荡器/噪声现场合成：开机、收到信息、警告、纸的沙沙声。
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

  /* 纸的声音：一小段过带通的白噪声，前密后疏，像真的在揉一张纸。
     kind='crumple' 更闷更久，'unfold' 更亮更短。 */
  function rustleSound(kind) {
    var ctx = soundCtx();
    if (!ctx) return;
    var dur = kind === 'crumple' ? 0.46 : 0.3;
    var len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < len; i++) {
      var t = i / len;
      /* 两个衰减叠在一起，做出“一下一下”的褶皱而不是一条平滑的噪音。 */
      var env = Math.pow(1 - t, 1.5) * (0.55 + 0.45 * Math.abs(Math.sin(t * 34)));
      data[i] = (Math.random() * 2 - 1) * env;
    }
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = kind === 'crumple' ? 2200 : 3200;
    bp.Q.value = 0.85;
    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 850;
    var gain = ctx.createGain();
    gain.gain.value = kind === 'crumple' ? 0.18 : 0.13;
    src.connect(bp);
    bp.connect(hp);
    hp.connect(gain);
    gain.connect(ctx.destination);
    src.start();
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
    if (next !== 'on') { hidePaper(); stopMusic(); }
    if (off) hidePaper();
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

  /* 开机进桌面后，在主页先放一颗纸团（每次开机只放一次）。 */
  function greetOnHome() {
    if (!isHomePage() || paperSeen()) return false;
    markPaperSeen();
    spawnBall(false);
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
    hidePaper();
    clearBalls();
    stopMusic(true);
    pile.replaceChildren();
    serial = 0;
    pile.hidden = true;
    delete root.dataset.pile;
    clearPaperSeen();
    emptyTrash(true);
    setState('off');
    if (power) power.focus({ preventScroll: true });
    say('屏幕已关闭。按电源键重新开机。', 'Screen off. Press the power button to turn on.');
  }

  /* ---------- 纸团：每按一次「开始」掉一颗，点一下摊成说明纸 ----------
     纸团可以有任意多颗，共用一张说明纸；揉皱的形态由 paper-3d.js 画在 3D 网格上，
     这里只负责进出场、拖动、丢进回收站和焦点。 */

  var balls = [];          /* { el, surface, open } */
  var keyboardSpawn = false;
  var openBall = null;     /* 当前摊开着的那一颗 */
  var ballSeq = 0;
  var UNFOLD_MS = 780;     /* 与参考视频 1.9s→2.7s 一致 */
  var CRUMPLE_MS = 700;    /* 与参考视频 0.6s→1.35s 一致 */

  function eachBall(fn) {
    for (var i = balls.length - 1; i >= 0; i--) fn(balls[i], i);
  }

  /* 在新的一帧里把纸团从 A 状态推到 B 状态，逐帧重绘 3D 画布。 */
  function animateBall(ball, from, to, duration, done) {
    if (ball.raf) cancelAnimationFrame(ball.raf);
    var startedAt = 0;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || !ball.surface) {
      ball.surface && ball.surface.paint(to);
      if (done) done();
      return;
    }
    function step(now) {
      if (!startedAt) startedAt = now;
      var k = Math.min(1, (now - startedAt) / duration);
      ball.surface.paint(from + (to - from) * k);
      if (k < 1) ball.raf = requestAnimationFrame(step);
      else { ball.raf = 0; if (done) done(); }
    }
    ball.raf = requestAnimationFrame(step);
  }

  /* 纸团的位置：沿着桌面左下角一片随机落点，避开说明纸和回收站。 */
  function scatterPoint() {
    var area = screen.getBoundingClientRect();
    var w = 78, h = 74;
    var spanX = Math.max(0, area.width - w - 16);
    var spanY = Math.max(0, area.height - h - 60);
    /* 左下角优先，偶尔往中间偏一点，看起来像随手丢的 */
    var x = 8 + Math.random() * Math.min(spanX, area.width * 0.62);
    var y = 46 + Math.random() * spanY;
    return { left: Math.round(x), top: Math.round(y) };
  }

  function spawnBall(animate) {
    if (state !== 'on') return null;
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'paper-ball';
    el.dataset.ball = String(ballSeq++);
    el.setAttribute('aria-label', zh() ? '纸团：点击摊开' : 'Paper ball: click to unfold');
    el.innerHTML =
      '<canvas class="ball-canvas" width="240" height="240" aria-hidden="true"></canvas>' +
      '<span class="ball-core" aria-hidden="true"></span>' +
      '<span class="ball-shadow" aria-hidden="true"></span>';

    var spot = scatterPoint();
    el.style.left = spot.left + 'px';
    el.style.top = spot.top + 'px';

    var ball = { el: el, surface: null, raf: 0, open: false };
    ballLayer.appendChild(el);

    /* 有 WebGL 就画真纸团；没有就留下 CSS 的球当兜底。 */
    if (window.Paper3D && window.Paper3D.available()) {
      ball.surface = window.Paper3D.createSurface(el.querySelector('.ball-canvas'));
      if (ball.surface) {
        el.classList.add('has-3d');
        ball.surface.paint(1);
      }
    }

    balls.push(ball);
    attachBall(ball);

    if (animate !== false) {
      el.classList.add('is-spawning');
      rustleSound('crumple');
      say('又掉下来一个纸团。', 'Another paper ball dropped in.');
      el.addEventListener('animationend', function handle(event) {
        if (event.target !== el) return;
        el.classList.remove('is-spawning');
        el.removeEventListener('animationend', handle);
      });
    }
    /* 用鼠标点「开始」时不抢焦点：否则纸团上会挂一个虚线框。
       键盘触发时（event.detail === 0）才把焦点交给它。 */
    if (keyboardSpawn) el.focus({ preventScroll: true });
    return ball;
  }

  /* 把说明纸放到这颗纸团旁边，并保证不越出屏幕。 */
  function placeSheet(ball) {
    var screenRect = screen.getBoundingClientRect();
    var ballRect = ball.el.getBoundingClientRect();
    paper.hidden = false;
    /* 说明纸是复用的同一个节点：被丢进回收站时 tossToTrash 写过内联的
       opacity / transform，不清理的话内联值会一直压住样式表，纸永远是透明的。 */
    paper.style.opacity = '';
    paper.style.transform = '';
    paper.style.left = '';
    paper.style.top = '';
    paper.style.right = '';
    paper.style.bottom = '';
    /* 窄屏上说明纸几乎占满宽度：这时位置由屏幕决定，而不是由纸团决定，
       否则纸团的随机位置会把纸推出屏幕外。 */
    var narrow = screenRect.width < 620;
    var w = narrow ? screenRect.width - 16 : Math.min(paper.offsetWidth, screenRect.width - 16);
    paper.style.width = Math.round(w) + 'px';
    var h = paper.offsetHeight;
    var x = narrow ? 8 : ballRect.left - screenRect.left;
    var y = ballRect.top - screenRect.top - h - 10;
    x = Math.max(8, Math.min(x, screenRect.width - w - 8));
    if (y < 8) y = Math.min(ballRect.bottom - screenRect.top + 10, screenRect.height - h - 52);
    paper.style.left = Math.round(x) + 'px';
    y = Math.max(4, Math.min(y, Math.max(4, screenRect.height - h - 48)));
    paper.style.top = Math.round(y) + 'px';
    paper.style.bottom = 'auto';
  }

  function unfoldBall(ball) {
    if (state !== 'on' || !ball) return;
    /* 已经有一张摊开着：把上一颗立即收成团，说明纸直接换位置，
       不再演一遍“揉回去再摊开”，否则中间会闪出一张半透明的纸。 */
    if (openBall && openBall !== ball) {
      var prev = openBall;
      prev.open = false;
      prev.el.classList.remove('is-flat', 'is-opening');
      animateBall(prev, 0, 1, CRUMPLE_MS);
    }
    ball.open = true;
    openBall = ball;
    ball.el.classList.add('is-opening');
    placeSheet(ball);
    sheetEl.setAttribute('aria-hidden', 'false');
    sheetEl.removeAttribute('inert');

    animateBall(ball, 1, 0, UNFOLD_MS, function () {
      if (state !== 'on') return;
      ball.el.classList.add('is-flat');
      rustleSound('unfold');
      say('纸摊开了。', 'The paper is flat now.');
      sheetEl.focus({ preventScroll: true });
    });
    /* 等一帧再挂上“摊开”状态：元素刚从 hidden 变成可见时，
       同一帧里改样式浏览器不会启动过渡，纸会一直停在起始的透明状态。
       先强制一次重排，让起始值真正生效。 */
    requestAnimationFrame(function () {
      void paper.offsetWidth;
      if (state === 'on' && openBall === ball) paper.classList.add('is-revealed');
    });
  }

  function crumplePaper(silent) {
    if (state !== 'on' || !openBall) return;
    var ball = openBall;
    openBall = null;
    ball.open = false;
    paper.classList.remove('is-revealed');
    sheetEl.setAttribute('aria-hidden', 'true');
    sheetEl.setAttribute('inert', '');
    ball.el.classList.remove('is-flat', 'is-opening');
    animateBall(ball, 0, 1, CRUMPLE_MS);
    if (!silent) {
      rustleSound('crumple');
      say('纸又被揉成一团。', 'The paper is a ball again.');
      ball.el.focus({ preventScroll: true });
    }
    window.setTimeout(function () {
      if (openBall) return;
      paper.hidden = true;
      paper.style.left = '';
      paper.style.top = '';
    }, CRUMPLE_MS);
  }

  function hidePaper() {
    paper.hidden = true;
    paper.classList.remove('is-revealed', 'is-tossed');
    paper.style.opacity = '';
    paper.style.transform = '';
    paper.style.left = '';
    paper.style.top = '';
    sheetEl.setAttribute('aria-hidden', 'true');
    sheetEl.setAttribute('inert', '');
    openBall = null;
  }

  function clearBalls() {
    balls.slice().forEach(function (ball) {
      if (ball.raf) cancelAnimationFrame(ball.raf);
      if (ball.el.parentNode) ball.el.remove();
    });
    balls.length = 0;
  }

  function removeBall(ball) {
    if (ball.raf) cancelAnimationFrame(ball.raf);
    var i = balls.indexOf(ball);
    if (i >= 0) balls.splice(i, 1);
    if (ball.el.parentNode) ball.el.remove();
    if (openBall === ball) hidePaper();
  }

  function discardPaper() {
    var ball = openBall;
    if (!ball) return;
    var target = paper;
    tossToTrash(target, function () {
      hidePaper();
      stopMusic(true);
      removeBall(ball);
    });
  }

  /* 每颗纸团自己的点击 / 拖动。 */
  function attachBall(ball) {
    ball.el.addEventListener('click', function (event) {
      if (Date.now() < suppressClickUntil) return;
      event.preventDefault();
      if (ball.open) return;
      if (!ball.surface) {
        /* 没有 3D 时也要能打开：直接摊开说明纸。 */
        ball.open = true;
        openBall = ball;
        placeSheet(ball);
        paper.classList.add('is-revealed');
        sheetEl.setAttribute('aria-hidden', 'false');
        sheetEl.removeAttribute('inert');
        rustleSound('unfold');
        sheetEl.focus({ preventScroll: true });
        return;
      }
      unfoldBall(ball);
    });

    ball.el.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      if (event.target !== ball.el) return;
      event.preventDefault();
      ball.el.click();
    });

    attachDrag(ball.el, ball.el, function () { removeBall(ball); });
  }

  /* ---------- 回收站 ---------- */

  var trashCount = 0;
  var lastDropAt = 0;

  function emptyTrash(silent) {
    if (!trashCount) return;
    trashCount = 0;
    trash.classList.remove('is-full', 'is-bumped', 'is-over');
    trash.setAttribute('aria-label', zh() ? '回收站：空' : 'Recycle Bin: empty');
    if (!silent) {
      toneFromTrash();
      say('回收站清空了。', 'The bin is empty again.');
    }
  }

  function toneFromTrash() {
    var ctx = soundCtx();
    if (!ctx) return;
    var t = ctx.currentTime + 0.01;
    tone(ctx, 392, t, 0.2, 0.06, 'triangle');
    tone(ctx, 261.63, t + 0.06, 0.3, 0.05, 'triangle');
  }

  function fillTrash(n) {
    trashCount = Math.max(1, trashCount + (n || 1));
    trash.classList.add('is-full');
    trash.classList.remove('is-bumped');
    void trash.offsetWidth;
    trash.classList.add('is-bumped');
    trash.setAttribute('aria-label', zh() ? '回收站：有内容，点击清空' : 'Recycle Bin: has items, click to empty');
    toneFromTrash();
  }

  function overTrash(x, y) {
    var r = trash.getBoundingClientRect();
    return x >= r.left - TRASH_PAD && x <= r.right + TRASH_PAD &&
           y >= r.top - TRASH_PAD && y <= r.bottom + TRASH_PAD;
  }

  /* 一件东西被扔进回收站：先朝桶口收拢、淡出，再真的从 DOM 里消失。 */
  function tossToTrash(el, done) {
    var binRect = trash.getBoundingClientRect();
    var rect = el.getBoundingClientRect();
    var dx = (binRect.left + binRect.width / 2) - (rect.left + rect.width / 2);
    var dy = (binRect.top + binRect.height / 2) - (rect.top + rect.height / 2);
    el.classList.add('is-tossed');
    el.style.transform = 'translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px) scale(.24) rotate(-18deg)';
    el.style.opacity = '0';
    window.setTimeout(function () {
      if (typeof done === 'function') done();
      else if (el.parentNode) el.remove();
    }, TOSS_MS);
    fillTrash(1);
    lastDropAt = Date.now();
    say('已经放进回收站。', 'Dropped into the bin.');
  }

  /* ---------- 拖动：纸团、说明纸、警告窗、页面窗口共用一套 ---------- */

  /* 把任意一个绝对定位的东西“钉”成 left/top，之后拖动就好算。
     inset 定位的 .dialog-page 也要先换算成像素，否则一拖就跳回原位。 */
  function pinElement(el) {
    var screenRect = screen.getBoundingClientRect();
    if (!el.dataset.pinned) {
      var rect = el.getBoundingClientRect();
      el.style.position = 'absolute';
      el.style.inset = 'auto';
      el.style.left = Math.round(rect.left - screenRect.left) + 'px';
      el.style.top = Math.round(rect.top - screenRect.top) + 'px';
      el.style.width = Math.round(rect.width) + 'px';
      /* 页面窗口平时靠 flex 撑满；一旦脱离文档流就必须自己给出高度，
         否则内部滚动区没有高度可算。 */
      if (el.classList.contains('dialog-page')) el.style.height = Math.round(rect.height) + 'px';
      el.dataset.pinned = '1';
    }
    /* 之后每次拎起来都从当前左上角重新起算，translate 归零。 */
    el.style.transform = '';
  }

  /* handle 负责发起，target 是被搬动的那一块，onTrash 决定丢进桶里之后干什么。 */
  function attachDrag(handle, target, onTrash) {
    if (!handle || !target) return;
    var drag = null;

    /* 指针按下时只在 record 里记下起点。真正的移动/抬起挂在 document 上（捕获阶段），
       这样即使指针滑出窗口、或者目标被重新布局，事件也不会丢。 */
    function record(event) {
      if (event.button !== 0) return;
      /* 控件上按下就不要拖：但把手本身可能就是那个控件（纸团就是一个按钮）。 */
      var control = event.target.closest('button, a, input, select, textarea');
      if (control && control !== handle) return;
      if (!target.isConnected) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false,
               lastX: event.clientX, lastY: event.clientY };
      document.addEventListener('pointermove', move, true);
      document.addEventListener('pointerup', finish, true);
      document.addEventListener('pointercancel', finish, true);
    }

    function stop() {
      drag = null;
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', finish, true);
      document.removeEventListener('pointercancel', finish, true);
    }

    function move(event) {
      if (!drag || event.pointerId !== drag.id) return;
      var dx = event.clientX - drag.x;
      var dy = event.clientY - drag.y;
      if (!drag.moved) {
        if (Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        pinElement(target);
        /* 拖动期间停掉纸团的待机晃动：动画会持续改写 transform，
           浏览器会把正在进行的手势当成取消。 */
        /* 只改这一块自己的样式：拖动中不要动 body 或 touch-action，
           否则浏览器会认为手势换了归属，直接发 pointercancel。 */
        target.classList.add('is-dragging', 'is-held');
      }
      /* 已经拎起来了：这一下算拖动，不算点击。 */
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      target.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      trash.classList.toggle('is-over', overTrash(drag.lastX, drag.lastY));
    }

    function finish(event) {
      if (!drag || event.pointerId !== drag.id) return;
      var moved = drag.moved;
      /* 系统级的取消（手势被别的层接走、指针移出窗口）也按“松手”处理：
         否则东西会卡在半空中，而且这一次拖拽白做。 */
      /* pointercancel 的坐标常常是 0,0，不能拿来当落点。 */
      var x = event.type === 'pointercancel' ? drag.lastX : event.clientX;
      var y = event.type === 'pointercancel' ? drag.lastY : event.clientY;
      stop();
      target.classList.remove('is-dragging');
      /* 松手后等一拍再恢复晃动，避免同一帧里又改 transform。 */
      window.setTimeout(function () { target.classList.remove('is-held'); }, 60);
      trash.classList.remove('is-over');
      if (!moved) return;             /* 只是点了一下，交给 click 处理 */
      suppressClickUntil = Date.now() + 350;
      if (overTrash(x, y)) {
        tossToTrash(target, onTrash);
        return;
      }
      /* 停下来的地方就是新家：把 translate 结算进 left/top，保证布局正确。 */
      var m = /translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/.exec(target.style.transform || '');
      if (m) {
        target.style.left = Math.round(parseFloat(target.style.left || '0') + parseFloat(m[1])) + 'px';
        target.style.top = Math.round(parseFloat(target.style.top || '0') + parseFloat(m[2])) + 'px';
      }
      target.style.transform = '';
    }

    handle.addEventListener('pointerdown', record);

    /* 浏览器自带的原生拖放会抢走手势，并立刻发出 pointercancel。
       桌面上的一切都由我们自己搬，所以原生拖放一律关掉。 */
    handle.addEventListener('dragstart', function (event) { event.preventDefault(); });

    /* 键盘替代：焦点在窗口里时按 Delete 就是“扔进回收站”。 */
    target.addEventListener('keydown', function (event) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      tossToTrash(target, onTrash);
    });
  }

  /* ---------- 关机游戏：警告窗只会越点越多，直到铺满整个屏幕 ---------- */

  function pileSize() { return pile.children.length; }

  /* 上限不是一个写死的数字：按屏幕和窗口的实际面积比换算。
     随机摆放会出现重叠，所以不能只数“格子”；按住面积比乘 16，
     约能盖住 99.8% 以上，再留一个性能上限防止小机器卡顿。 */
  function pileCapacity() {
    var area = pile.getBoundingClientRect();
    if (!area.width || !area.height) return MIN_PILE;
    var probe = pile.firstElementChild;
    var w = (probe && probe.offsetWidth) || Math.min(330, Math.max(180, area.width - 8));
    var h = (probe && probe.offsetHeight) || 186;
    var ratio = (area.width * area.height) / Math.max(1, w * h);
    return Math.max(MIN_PILE, Math.min(MAX_PILE, Math.ceil(ratio * 16)));
  }

  /* 每个窗口出生时只抽取一次随机位置。增殖不重新排列旧窗口；
     纵向横向都允许稍微探出屏幕一点（窗口本来就能被拖到边上），
     否则贴着屏幕边的那一圈永远盖不到，堆再多也留一道缝。 */
  function placeWindows() {
    var kids = pile.children;
    if (!kids.length) return;
    var area = pile.getBoundingClientRect();
    if (!area.width || !area.height) return;
    for (var i = 0; i < kids.length; i++) {
      var win = kids[i];
      /* 被用户亲手拎过的窗口不再重新排位置。 */
      if (win.dataset.pinned) continue;
      if (win.dataset.randomX === undefined) {
        win.dataset.randomX = String(Math.random());
        win.dataset.randomY = String(Math.random());
      }
      var spanX = Math.max(0, area.width - win.offsetWidth);
      var spanY = Math.max(0, area.height - win.offsetHeight);
      var overX = win.offsetWidth * 0.25;
      var overY = win.offsetHeight * 0.25;
      var x = -overX + Number(win.dataset.randomX) * (spanX + overX * 2);
      var y = -overY + Number(win.dataset.randomY) * (spanY + overY * 2);
      win.style.left = Math.round(x) + 'px';
      win.style.top = Math.round(y) + 'px';
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
      '<div class="shutdown-titlebar" data-drag-handle>' +
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
    /* 标题栏可以拎起来，丢到回收站就消失。 */
    attachDrag(win.querySelector('[data-drag-handle]'), win, function () { win.remove(); });
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
     只有电源键能真正关机并黑屏。 */
  function guardNavigation(event) {
    if (state !== 'on' || pileSize() === 0) return;
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (Date.now() - lastDropAt < 400) return;
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
    var box = paper.querySelector('[data-music-state]');
    var btn = paper.querySelector('[data-gift-play]');
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
      if (event && event.target && event.target.closest && event.target.closest('.paper-gift')) return;
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

  /* ---------- 绑定 ---------- */

  function bindPaper() {
    /* 说明纸的抬头：点一下重新揉起来（拖动超过阈值则只是搬动）。 */
    var head = paper.querySelector('[data-paper-handle]');
    head.addEventListener('click', function (event) {
      if (Date.now() < suppressClickUntil) return;
      if (event.target.closest('button')) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) return;      /* 正在选字就别抢 */
      crumplePaper(false);
    });

    var crumpleBtn = paper.querySelector('[data-paper-crumple]');
    if (crumpleBtn) {
      crumpleBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        crumplePaper(false);
      });
    }

    var trashBtn = paper.querySelector('[data-paper-trash]');
    if (trashBtn) {
      trashBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        discardPaper();
      });
    }

    /* 焦点在纸上时，Delete 也能把纸扔进回收站。 */
    sheetEl.addEventListener('keydown', function (event) {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (event.target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      discardPaper();
    });

    /* 说明纸自己也能被拎走，丢进回收站就收起来。 */
    attachDrag(head, paper, discardPaper);
  }

  function bindGift() {
    var btn = paper.querySelector('[data-gift-play]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!musicWanted) {
        /* 重新打开礼物：从头开始放，不接着上次的位置。 */
        musicWanted = true;
        try { audio.currentTime = 0; } catch (e) {}
        playMusic();
        say('正在播放 Lullaby。', 'Playing Lullaby, from the start.');
      } else if (audio.paused) {
        try { audio.currentTime = 0; } catch (e) {}
        playMusic();
        say('正在播放 Lullaby。', 'Playing Lullaby, from the start.');
      } else {
        musicWanted = false;
        audio.pause();
        saveMusic(true);
        say('音乐已暂停。', 'Music paused.');
      }
    });
  }

  /* 页面窗口（语录 / 项目 / 联系）也能被拎进回收站：丢进去就等于关上这扇窗。 */
  function bindPageWindow() {
    var win = screen.querySelector('.dialog-page');
    if (!win || win.dataset.dragBound === '1') return;
    var bar = win.querySelector('.dialog-titlebar');
    if (!bar) return;
    win.dataset.dragBound = '1';
    attachDrag(bar, win, function () {
      location.href = 'index.html';
    });
  }

  function bindTrash() {
    trash.addEventListener('click', function () {
      if (Date.now() < suppressClickUntil) return;
      if (trashCount > 0) emptyTrash(false);
      else say('回收站是空的。', 'The bin is empty.');
    });
  }

  /* 跟手箭头只是视觉层：所有监听都是被动的，不拦截点击、滚动和拖动。
     原生滚动会取消 pointer 事件，因此用 touchmove 继续跟踪滚动中的手指。 */
  function bindTouchCursor() {
    var cursor = document.createElement('span');
    cursor.className = 'touch-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cursor);
    var timer = 0;
    var frame = 0;
    var point = null;
    function hide() {
      clearTimeout(timer);
      point = null;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      cursor.classList.remove('is-visible');
    }
    function paint() {
      frame = 0;
      if (!point) return;
      var r = screen.getBoundingClientRect();
      if (state === 'off' || point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) {
        hide(); return;
      }
      var x = Math.max(r.left, Math.min(r.right - 22, point.x + 8));
      var y = Math.max(r.top, Math.min(r.bottom - 28, point.y - 30));
      cursor.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0)';
      cursor.classList.add('is-visible');
    }
    function move(event) {
      if (event.touches.length !== 1) { hide(); return; }
      clearTimeout(timer);
      var t = event.touches[0];
      point = { x: t.clientX, y: t.clientY };
      if (!frame) frame = requestAnimationFrame(paint);
    }
    function release(event) {
      if (event.touches.length) { hide(); return; }
      timer = setTimeout(hide, 650);
    }
    document.addEventListener('touchstart', move, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', release, { passive: true });
    document.addEventListener('touchcancel', hide, { passive: true });
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);
    document.addEventListener('visibilitychange', hide);
    new MutationObserver(function () { if (state === 'off') hide(); })
      .observe(root, { attributes: true, attributeFilter: ['data-power'] });
  }

  /* ---------- 绑定 ---------- */

  function bind() {
    power = document.querySelector('[data-machine-power]');
    start = document.querySelector('[data-machine-start]');
    if (!power || !start) return false;

    /* 电源键只管开机；开机状态下点它只弹警告窗，不再关机。 */
    power.addEventListener('click', function () {
      if (state === 'off') boot();
      else if (state === 'on') multiply(1);
    });

    /* 「开始」：每按一次就掉一颗纸团，任何页面都算数。 */
    start.addEventListener('click', function (event) {
      if (state !== 'on') return;
      keyboardSpawn = event.detail === 0;   /* 键盘触发的点击没有 detail */
      spawnBall(true);
      keyboardSpawn = false;
    });

    /* 关掉警告窗上任何一个按钮，都会再多出两个一样的窗口。
        拖拽丢进回收站的那一下不算点击。 */
    pile.addEventListener('click', function (event) {
      if (Date.now() < suppressClickUntil) return;
      if (!event.target.closest('.shutdown-window')) return;
      if (event.target.closest('button')) multiply(2);
    });

    loginLayer.addEventListener('click', function (event) {
      if (event.target.closest('[data-machine-login]')) logIn();
    });

    /* 系统托盘的信息键：现在才是真正的关机键。 */
    var tray = document.querySelector('[data-machine-tray]');
    if (tray) {
      tray.addEventListener('click', function () {
        if (state === 'on') shutDown();
      });
    }

    /* 图片、文字被浏览器原生拖走同样会打断手势，整块屏幕禁掉。 */
    screen.addEventListener('dragstart', function (event) { event.preventDefault(); });
    document.addEventListener('click', guardNavigation, true);
    window.addEventListener('resize', placeWindows);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(placeWindows).observe(screen);
    new MutationObserver(function () {
      updatePowerLabel();
      setMusicState(!audio.paused);
      placeWindows();
      /* 回收站的状态文案是运行时拼的，语言一换要重新生成。 */
      trash.setAttribute('aria-label', trashCount > 0
        ? (zh() ? '回收站：有内容，点击清空' : 'Recycle Bin: has items, click to empty')
        : (zh() ? '回收站：空' : 'Recycle Bin: empty'));
      eachBall(function (ball) {
        ball.el.setAttribute('aria-label', ball.open
          ? (zh() ? '纸团：已摊开' : 'Paper ball: unfolded')
          : (zh() ? '纸团：点击摊开' : 'Paper ball: click to unfold'));
      });
    }).observe(root, { attributes: true, attributeFilter: ['data-lang'] });
    setMusicState(!audio.paused);

    bindPageWindow();
    /* 软导航只换掉窗口节点，任务栏不动；节点一换就得重新挂一次拖拽。 */
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(bindPageWindow).observe(screen, { childList: true });
    }

    bindPaper();
    bindGift();
    bindTrash();
    bindTouchCursor();
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
