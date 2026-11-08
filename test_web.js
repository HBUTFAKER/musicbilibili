// 验证线上版：B站播放器能否正常嵌入、视频是否加载出来
const { app, BrowserWindow } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const URL_ = 'https://my-playlist-player.app.workbuddy.host/';

function allFrames(f, acc) {
  acc.push(f);
  for (const x of f.frames) allFrames(x, acc);
  return acc;
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, width: 1100, height: 900 });
  const errs = [];
  w.webContents.on('console-message', (e, level, msg) => { if (level >= 3) errs.push(msg.slice(0, 120)); });

  try {
    await w.loadURL(URL_);
  } catch (e) {
    console.log('LOAD-FAIL', e.message);
    app.quit(); return;
  }
  await sleep(7000);

  const page = await w.webContents.executeJavaScript(`(function(){
    return { title: document.title,
             total: document.getElementById('total').textContent,
             rows: document.querySelectorAll('.item').length,
             hasIframe: !!document.querySelector('#playerBox iframe'),
             iframeSrc: (document.querySelector('#playerBox iframe')||{}).src || '' };
  })()`);
  console.log('PAGE  ', JSON.stringify(page));

  const frames = allFrames(w.webContents.mainFrame, []);
  const bili = frames.filter(f => f.url.indexOf('bilibili') >= 0);
  console.log('FRAMES', frames.length, '| bilibili 帧:', bili.length);
  for (const f of bili) {
    console.log('  url:', f.url.slice(0, 90));
    try {
      const r = await f.executeJavaScript(
        "(function(){var v=document.querySelector('video');if(!v)return 'no <video>';return 'video OK | duration='+v.duration+' | paused='+v.paused;})()");
      console.log('  ->', r);
    } catch (e) { console.log('  -> err', String(e.message).slice(0, 90)); }
  }
  console.log('ERRORS', errs.length ? JSON.stringify(errs) : '无');
  app.quit();
});
