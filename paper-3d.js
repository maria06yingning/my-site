/* 纸团：一张真实的网格纸被揉成团，再摊平。
   参考视频里最关键的三件事，平面 CSS 做不到：
     1. 纸面是有棱面的球体（flatShading），不是圆润的球；
     2. 纸上的字迹跟着曲面一起扭曲，因为纹理就贴在网格上；
     3. 影子随体积收缩、边缘始终虚化。
   这里用 three.js 把一张 40×32 的网格从平面插值到"揉皱的球"，进度 0..1 双向可逆。
   只画一个共享的 WebGL 画布，再把结果拷进每个纸团自己的 2D canvas，
   所以同时存在很多个纸团也只占一个 WebGL 上下文。 */
(function () {
  'use strict';

  var SIZE = 240;          /* 每张纸团画布的逻辑像素 */

  var renderer = null;
  var scene = null;
  var camera = null;
  var mesh = null;
  var geometry = null;
  var flatPos = null;      /* 摊平后的顶点 */
  var ballPos = null;      /* 揉成团后的顶点 */
  var basePos = null;

  /* 确定性噪声：同一个纸团每次揉出来的褶皱都一样，不会每帧抖动。 */
  function hash(i, j) {
    var s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }

  /* 要在网格上形成“连续的面”，噪声本身必须在空间上是连续的：
     逐顶点取随机值只会得到一张刺猬皮。这里在格点上取随机值再做平滑插值，
     相邻顶点才会落在同一个折面上。 */
  function smooth(t) { return t * t * (3 - 2 * t); }
  function noise2(x, y) {
    var xi = Math.floor(x), yi = Math.floor(y);
    var xf = smooth(x - xi), yf = smooth(y - yi);
    var a = hash(xi, yi), b = hash(xi + 1, yi);
    var c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return (a + (b - a) * xf) + ((c + (d - c) * xf) - (a + (b - a) * xf)) * yf;
  }
  /* 揉皱的关键不是起伏，而是“折”——纸一旦折住就出现一条硬边。
     把噪声取绝对值再翻过来，就得到一条条脊线（ridged noise），
     这样在网格上会出现参考里那种细长的亮棱和暗沟，而不是枕头似的鼓包。 */
  function ridge(x, y) {
    var n = noise2(x, y);
    /* 平方一下把脊线收窄：折痕是一条线，不是一个鼓包。 */
    var r = 1 - Math.abs(n * 2 - 1);
    return r * r;
  }
  function crumpleNoise(u, v) {
    /* 大尺度决定团的轮廓；中尺度是主要折面；细碎的部分用平滑噪声，
       不叠脊线，否则细看会变成一圈圈台阶。 */
    /* 频段按真实纸团的比例选：一张纸上大约压出十几到二十道折，
       所以中频要落在 8~12 之间，而不是 3。 */
    var big = ridge(u * 2.4 + 2, v * 2.4 + 6) - 0.5;
    var mid = ridge(u * 6.5 + 5, v * 6.5 + 1) - 0.5;
    var fine = ridge(u * 11.5 + 4, v * 11.5 + 7) - 0.5;
    var hair = noise2(u * 19 + 2, v * 19 + 5) - 0.5;
    return big * 0.42 + mid * 0.38 + fine * 0.26 + hair * 0.10;
  }

  /* 纸的纹理：米白底 + 淡淡的横线 + 手写笔迹（占位，可换成真实扫描件）。
     纹理贴在网格上，揉皱时自然被拉扯。 */
  function paperTexture() {
    var c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    var g = c.getContext('2d');
    g.fillStyle = '#efe9d8';
    g.fillRect(0, 0, 512, 512);
    /* 纤维感：极淡的斑驳 */
    for (var i = 0; i < 2600; i++) {
      g.fillStyle = 'rgba(190,180,158,' + (0.03 + hash(i, 3) * 0.05) + ')';
      g.fillRect(hash(i, 1) * 512, hash(i, 2) * 512, 1 + hash(i, 4) * 2, 1);
    }
    /* 手写行：短促、略斜、粗细不一，像随手写满的一页 */
    g.strokeStyle = 'rgba(38,36,33,.9)';
    g.lineCap = 'round';
    var y = 34;
    var line = 0;
    while (y < 500) {
      var x = 22 + hash(line, 7) * 14;
      var end = 486 - hash(line, 9) * 44;
      while (x < end) {
        var len = 6 + hash(x, y) * 30;
        g.lineWidth = 0.8 + hash(x, line) * 0.9;
        g.beginPath();
        g.moveTo(x, y + (hash(x, 5) - 0.5) * 2);
        g.quadraticCurveTo(x + len / 2, y - 4 + hash(x, 6) * 8, x + len, y + (hash(x, 8) - 0.5) * 4);
        g.stroke();
        x += len + 4 + hash(x, 2) * 7;
      }
      y += 21 + hash(line, 11) * 7;
      line++;
    }
    return c;
  }

  function init() {
    if (renderer) return true;
    if (typeof THREE === 'undefined') return false;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (e) { return false; }
    if (!renderer || !renderer.getContext()) return false;
    renderer.setPixelRatio(1);
    renderer.setSize(SIZE, SIZE, false);
    renderer.setClearColor(0x000000, 0);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    camera.position.set(0, 0, 2.55);
    camera.lookAt(0, 0, 0);

    /* 光压低：米白的纸很容易过曝，一过曝字迹就没了，纸团也失去棱面。 */
    scene.add(new THREE.AmbientLight(0xffffff, 0.30));
    var key = new THREE.DirectionalLight(0xfffdf4, 0.95);
    key.position.set(-0.9, 1.5, 1.9);
    scene.add(key);
    var fill = new THREE.DirectionalLight(0xdfe6ff, 0.20);
    fill.position.set(1.2, -0.6, 0.8);
    scene.add(fill);
    /* 背光把轮廓从背景里托出来，但很轻。 */
    var rim = new THREE.DirectionalLight(0xffffff, 0.14);
    rim.position.set(0.4, -0.8, -1.4);
    scene.add(rim);

    /* 40×32 段：够撑出棱面，又不至于太重。 */
    geometry = new THREE.PlaneGeometry(1.62, 1.34, 56, 44);
    basePos = geometry.attributes.position.array;
    var count = basePos.length / 3;
    flatPos = new Float32Array(count * 3);
    ballPos = new Float32Array(count * 3);

    for (var i = 0; i < count; i++) {
      var x = basePos[i * 3];
      var y = basePos[i * 3 + 1];
      var u = x / 1.62 + 0.5;      /* 0..1 */
      var v = y / 1.34 + 0.5;

      /* 摊平：几乎平的，只留一点点纸的自然起伏 */
      flatPos[i * 3] = x;
      flatPos[i * 3 + 1] = y;
      flatPos[i * 3 + 2] = 0.012 * Math.sin(u * Math.PI) * Math.cos(v * Math.PI * 1.3);

      /* 揉成团：把整张纸卷到一个不规则球面上。
         先给每个点一个起伏的 z，再归一化到半径 = 基础半径 × 噪声，
         于是纸的边角被压进团里，形成一圈一圈的褶皱。 */
      var sx = (u - 0.5) * 2;
      var sy = (v - 0.5) * 2;
      /* 关键的一步：不把平面“贴”到球上，而是按极坐标卷起来——
         纸心落在正对镜头的一点，半径越大越往球的后背绕，
         于是纸的四个角被收拢到背面，剪影才是圆的，而不是一块软垫。 */
      var r = Math.min(1.18, Math.sqrt(sx * sx * 0.92 + sy * sy * 0.92));
      var theta = Math.atan2(sy, sx);
      /* 卷到背后：纸的边缘正好在球的背面合拢 */
      var phi = Math.min(Math.PI * 0.97, r * Math.PI * 0.86);
      var lump = crumpleNoise(u, v);
      /* 折痕只沿半径方向起伏。用 sin(theta) 会在 theta = π 处对称折返，
         等于在正面拉出一道贯穿的硬缝——那是之前那道沟的来源。 */
      var crease = 0.075 * Math.sin(r * 5.1 + 0.7)
                 + 0.05 * Math.cos(r * 7.6 - 1.2);
      /* 半径带褶皱：球面被捏出棱和沟，光才有东西可打。 */
      /* 幅度要足够大才看得见棱：0.5 左右相当于半径上下浮动近三成，
         这正是“揉过”和“吹起来”的区别。 */
      /* 幅度再大一点：远景看过去才不会像个揉软的面包。 */
      var radius = 0.56 * (1 + lump * 0.78 + crease * 0.8);
      var sw = Math.sin(phi);
      ballPos[i * 3] = Math.cos(theta) * sw * radius * 1.16;
      ballPos[i * 3 + 1] = Math.sin(theta) * sw * radius * 1.0 + 0.02;
      ballPos[i * 3 + 2] = Math.cos(phi) * radius;

    }

    var material = new THREE.MeshStandardMaterial({
      map: new THREE.CanvasTexture(paperTexture()),
      flatShading: true,
      roughness: 0.94,
      metalness: 0.0
    });
    mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    return true;
  }

  /* 缓动：与样式表里的 --paper-settle 同一条曲线，末段有一点压过再回弹。 */
  function easeCrumple(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    /* 揉的过程前段快、后段慢（纸一旦折住就很难再压紧） */
    var e = 1 - Math.pow(1 - t, 2.4);
    /* 结尾多压 3%，像手心最后紧了一下 */
    var squeeze = Math.sin(t * Math.PI) * 0.05;
    return Math.min(1.06, e + squeeze);
  }

  function render(progress) {
    if (!init()) return false;
    var t = Math.max(0, Math.min(1, progress));
    var e = easeCrumple(t);
    var pos = geometry.attributes.position.array;
    for (var i = 0; i < pos.length; i++) {
      pos[i] = flatPos[i] + (ballPos[i] - flatPos[i]) * e;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();

    /* 团起来时轻微转身，让棱面朝光；摊平时正对镜头。 */
    /* 起手就转过去一点，把纸边合拢的那道接缝藏到背面。 */
    mesh.rotation.set(-0.10 * t, 1.15 + 0.30 * t, 0.05 * Math.sin(t * 2.2));
    /* 体积的错觉：摊平略大，团起来略小。 */
    var s = 1 + 0.03 * Math.sin(t * Math.PI) - 0.04 * t;
    mesh.scale.set(s, s, s);

    renderer.render(scene, camera);
    return true;
  }

  /* 每个纸团一块 2D 画布：把共享 3D 画面拷进来。
     这样同时有多个纸团，也只有一个 WebGL 上下文。 */
  function createSurface(canvas) {
    if (!canvas || !init()) return null;
    var ctx = canvas.getContext('2d');
    if (!ctx) return null;
    return {
      paint: function (progress) {
        if (!render(progress)) return;
        var src = renderer.domElement;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
      }
    };
  }

  window.Paper3D = {
    available: function () { return init(); },
    createSurface: createSurface,
    ease: easeCrumple
  };
})();
