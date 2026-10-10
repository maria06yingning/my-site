/* A deliberately useless shutdown dialog. Only Start actually powers off.
   This is a local visual effect: no data, browser windows or device power are changed. */
(function () {
  'use strict';
  var monitor = document.querySelector('.monitor');
  var screen = document.querySelector('.screen');
  var power = document.querySelector('[data-machine-power]');
  var start = document.querySelector('[data-machine-start]');
  if (!monitor || !screen || !power || !start) return;

  var off = false;
  var serial = 0;
  var MAX_WINDOWS = 40;
  var layer = document.createElement('div');
  layer.className = 'shutdown-layer';
  layer.hidden = true;
  screen.appendChild(layer);
  var status = document.createElement('span');
  status.className = 'sr-only';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  monitor.appendChild(status);

  function zh() { return document.documentElement.dataset.lang !== 'en'; }
  function announce(chinese, english) { status.textContent = zh() ? chinese : english; }
  function updatePowerLabel() {
    power.setAttribute('aria-label', off
      ? (zh() ? '电源：开机' : 'Power: turn on')
      : (zh() ? '电源：请求关机' : 'Power: request shutdown'));
    power.setAttribute('aria-pressed', String(!off));
  }
  function positionWindows() {
    var area = layer.getBoundingClientRect();
    Array.from(layer.children).forEach(function (win) {
      var n = Number(win.dataset.order);
      var maxX = Math.max(0, area.width - win.offsetWidth - 8);
      var maxY = Math.max(0, area.height - win.offsetHeight - 8);
      // Begin in the middle, then cascade across the available screen area.
      var x = n === 0 ? .5 : ((n * 29 + 35) % 101) / 100;
      var y = n === 0 ? .42 : ((n * 19 + 20) % 101) / 100;
      win.style.left = (4 + maxX * x) + 'px';
      win.style.top = (4 + maxY * y) + 'px';
    });
  }
  function addWindow() {
    // Recycle the oldest dialogs rather than consuming memory without a limit.
    if (layer.children.length >= MAX_WINDOWS) layer.firstElementChild.remove();
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
    layer.appendChild(win);
    return win;
  }
  function multiply(amount) {
    if (off) return;
    layer.hidden = false;
    var latest;
    for (var i = 0; i < amount; i++) latest = addWindow();
    positionWindows();
    latest.querySelector('.shutdown-confirm').focus({ preventScroll: true });
    announce('有内容未保存，确定关机吗？', 'You have unsaved content. Shut down?');
  }
  function shutDown() {
    if (off) return;
    off = true;
    layer.replaceChildren();
    layer.hidden = true;
    serial = 0;
    power.focus({ preventScroll: true });
    screen.inert = true;
    screen.setAttribute('aria-hidden', 'true');
    monitor.classList.add('is-powered-off');
    updatePowerLabel();
    announce('屏幕已关闭。按电源键重新开机。', 'Screen off. Press the power button to turn on.');
  }
  function boot() {
    off = false;
    screen.inert = false;
    screen.removeAttribute('aria-hidden');
    monitor.classList.remove('is-powered-off');
    updatePowerLabel();
    announce('已开机。', 'Power on.');
    power.focus({ preventScroll: true });
  }
  power.addEventListener('click', function () {
    if (off) boot();
    else multiply(1);
  });
  // Every button INSIDE a shutdown window makes two more identical windows.
  layer.addEventListener('click', function (event) {
    if (event.target.closest('button')) multiply(2);
  });
  start.addEventListener('click', shutDown);
  window.addEventListener('resize', positionWindows);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(positionWindows).observe(screen);
  new MutationObserver(updatePowerLabel).observe(document.documentElement, { attributes: true, attributeFilter: ['data-lang'] });
  updatePowerLabel();
})();
