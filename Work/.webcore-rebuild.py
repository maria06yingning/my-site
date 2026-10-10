from pathlib import Path
import re
nav='''<nav class="taskbar" aria-label="主导航">
  <span class="start-label" aria-hidden="true"><i class="ico ico-flag"></i><span class="start-word lang-zh">开始</span><span class="start-word lang-en">Start</span></span>
  <span class="taskbar-divider" aria-hidden="true"></span>
  <ul class="task-links">
'''
for file,icon,zh,en in [('index','pc','首页','Home'),('quote','doc','语录','Quotes'),('project','folder','项目','Projects'),('contact','mail','联系','Contact')]:
    nav+=f'    <li><a href="{file}.html" data-page="{file}.html"><i class="ico ico-{icon}" aria-hidden="true"></i><span class="lang-zh">{zh}</span><span class="lang-en">{en}</span></a></li>\n'
nav+='''  </ul>
  <div class="system-tray">
    <div class="lang-toggle" role="group" aria-label="语言"><button type="button" data-lang="zh" aria-label="中文">中</button><button type="button" data-lang="en" aria-label="English">EN</button></div>
    <time class="clock" aria-label="本地时间">--:--</time>
  </div>
</nav>'''
Path('nav.html').write_text(nav+'\n')
for file,title in [('index','桌面'),('quote','语录'),('project','项目'),('contact','联系')]:
    content=''
    if file!='index':
        old=Path(file+'.html').read_text()
        content=old[old.index('<div class="dialog-page'):old.index('<!-- Dreamcore 内容 -->')]
        content=content.replace('<div class="dialog-page web-only">','<div class="dialog-page" id="content">')
        content=content.replace('<div class="dialog-win" role="main">','<div class="dialog-win" role="main" aria-label="'+title+'">')
        content=content.replace('aria-label="Minimize"','type="button" data-window="minimize" aria-label="最小化" title="最小化"').replace('aria-label="Maximize"','type="button" data-window="maximize" aria-label="最大化" title="最大化" aria-pressed="false"').replace('aria-label="Close"','aria-label="关闭并返回首页" title="关闭并返回首页"')
        content=content.replace('class="step"','class="step is-open"').replace('class="door"','class="door is-open"').replace('aria-expanded="false"','aria-expanded="true"')
        content=content.replace('轻触卡片，展开每一句话。','每一句话，都是一个打开的窗口。点击蓝色标题栏可收起。').replace('Tap a card to read the quote.','A small window for every thought. Click a blue title bar to fold it away.')
        content=content.replace('我做过和正在做的小项目，点一下查看简介。','我做过和正在做的小项目。点击文件夹可收起或展开简介。').replace("Small projects I'm working on or thinking about. Tap one to read more.","Small projects I'm working on or thinking about. Click a folder to fold or unfold it.")
        content=content.replace('全部展开','全部收起').replace('open all','close all').replace('00 / 20','20 / 20')
        content=content.replace('</div><!-- .dialog-body -->','</div><!-- .dialog-body -->\n<div class="window-status"><span class="lang-zh">就绪</span><span class="lang-en">Ready</span></div>')
    else:
        content='<main id="content" class="sr-only"><h1>Maria Pan</h1><p>个人网站桌面</p></main>'
    html='''<!DOCTYPE html>
<html lang="zh-CN" data-lang="zh" data-style="web" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#c0c0c0">
  <title>'''+title+''' — Maria Pan</title>
  <link rel="icon" href="favicon.png" type="image/png">
  <link rel="preload" href="bliss.jpg" as="image">
  <link rel="stylesheet" href="style.css">
  <script>
    try {
      var language = localStorage.getItem('site-lang') === 'en' ? 'en' : 'zh';
      document.documentElement.dataset.lang = language;
      document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    } catch (e) { /* 中文默认值支持离线和禁用存储的浏览器。 */ }
  </script>
  <script src="nav.js" defer></script>
</head>
<body class="page-'''+file+'''">
<a class="skip-link" href="#content">跳至内容</a>
<div class="computer-stage">
  <div class="computer">
    <div class="monitor">
      <div class="screen-rim">
        <div class="screen">
          <img class="wallpaper" src="bliss.jpg" alt="" fetchpriority="high" decoding="async">
          <div class="crt-glass" aria-hidden="true"></div>
'''+content+'''
          <header id="site-header">
'''+nav+'''
          </header>
        </div>
      </div>
      <div class="monitor-chin" aria-hidden="true"><span class="monitor-brand">MARIA</span><div class="monitor-hardware"><span class="vents"></span><span class="power-led"></span><span class="power-mark">⏻</span></div></div>
    </div>
    <div class="monitor-neck" aria-hidden="true"></div>
    <div class="monitor-foot" aria-hidden="true"></div>
  </div>
</div>
</body>
</html>
'''
    Path(file+'.html').write_text(html)
