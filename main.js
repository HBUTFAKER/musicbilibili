const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const https = require('https');

// 关键：放开自动播放限制 —— 打开即播、自动连播，无需手动点击
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 递归收集所有子框架
function allFrames(frame, acc) {
  acc.push(frame);
  for (const f of frame.frames) allFrames(f, acc);
  return acc;
}
// 只看 B 站播放器那一帧
function biliFrames(wc) {
  return allFrames(wc.mainFrame, []).filter(f => f.url.indexOf('bilibili.com') >= 0);
}

// 在播放器帧里执行 JS，返回第一个非 'none'/null 的结果
async function runInPlayer(wc, code) {
  for (const f of biliFrames(wc)) {
    try {
      const r = await f.executeJavaScript(code);
      if (r !== 'none' && r !== null && r !== undefined) return r;
    } catch (e) { /* 该帧暂不可用 */ }
  }
  return null;
}

// ---- 暂停 / 播放 ----
ipcMain.handle('player-ctl', async (event, action) => {
  const code = action === 'pause'
    ? "(function(){var v=document.querySelector('video');if(!v)return 'none';v.pause();return 'paused='+v.paused;})()"
    : "(function(){var v=document.querySelector('video');if(!v)return 'none';v.play();return 'playing='+(!v.paused);})()";
  return (await runInPlayer(event.sender, code)) || 'no-video';
});

// ---- 读取真实播放状态（进度条同步用）----
ipcMain.handle('player-state', async (event) => {
  const code = "(function(){var v=document.querySelector('video');if(!v)return null;return {t:v.currentTime,d:v.duration,p:v.paused};})()";
  return await runInPlayer(event.sender, code);
});

// ---- 拖动进度条跳转 ----
ipcMain.handle('player-seek', async (event, sec) => {
  const s = Number(sec) || 0;
  const code = "(function(){var v=document.querySelector('video');if(!v)return 'none';v.currentTime=" + s + ";return 'ok';})()";
  return (await runInPlayer(event.sender, code)) === 'ok';
});

// ---- 添加歌曲：解析 BV 号并查询视频信息 ----
function biliGet(url, needCookie) {
  return new Promise((resolve) => {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      'Referer': 'https://www.bilibili.com/'
    };
    // 搜索接口需要带 buvid3，否则会被风控挡掉
    if (needCookie) headers['Cookie'] = 'buvid3=A1B2C3D4-1234-5678-9012-345678901234infoc';
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(12000, () => { req.destroy(); resolve(null); });
  });
}

function stripTags(t) {
  return String(t == null ? '' : t)
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&hellip;/g, '…').trim();
}

function fmtPlay(n) {
  n = Number(n) || 0;
  return n >= 100000000 ? (n / 100000000).toFixed(1) + '亿'
    : n >= 10000 ? (n / 10000).toFixed(1) + '万' : String(n);
}

function secToTxt(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}

// 搜索接口返回的 duration 是 "4:53" 这种字符串，转成秒
function parseDurStr(s) {
  if (typeof s === 'number') return s;
  const parts = String(s == null ? '' : s).split(':');
  let sec = 0;
  for (const p of parts) sec = sec * 60 + (parseInt(p, 10) || 0);
  return sec;
}

// 疑似翻唱 / 乐器 / 合集之类的关键词，命中了在结果里给个提醒
const SUSPECT_WORDS = ['cover', '翻唱', '伴奏', '鼓谱', '琴谱', '谱', '指弹', '教学',
  '合集', '串烧', 'remix', '改编', '纯音乐', '钢琴', '吉他', '贝斯', 'bass', '空耳',
  '音译', '直拍', '音乐节', '混剪', '片段', '副歌', '动态', '自制'];
function suspectOf(title) {
  const t = String(title || '').toLowerCase();
  for (const w of SUSPECT_WORDS) { if (t.indexOf(w) >= 0) return w; }
  return '';
}

// ---- 按歌名 / 歌名+歌手 搜索 B 站视频（结果给用户挑）----
ipcMain.handle('search-song', async (event, keyword) => {
  const kw = String(keyword || '').trim();
  if (!kw) return { error: '请输入歌名，或者「歌名 歌手」' };

  const url = 'https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword='
    + encodeURIComponent(kw);
  const r = await biliGet(url, true);
  if (!r) return { error: '搜索失败：网络不通或被拦截，稍后再试' };
  if (r.code !== 0) return { error: '搜索失败：' + (r.message || ('code ' + r.code)) };

  const list = (r.data && r.data.result) || [];
  const out = [];
  for (const it of list) {
    if (!it || !it.bvid) continue;
    const title = stripTags(it.title);
    if (!title) continue;
    const dur = parseDurStr(it.duration);
    out.push({
      bvid: it.bvid,
      title: title,
      song: title,
      artist: stripTags(it.author),
      dur: dur,
      durTxt: secToTxt(dur),
      play: Number(it.play) || 0,
      playTxt: fmtPlay(it.play),
      suspect: suspectOf(title)
    });
    if (out.length >= 12) break;
  }
  if (!out.length) return { error: '没搜到结果，换个关键词试试（比如只输歌名，或用「歌名 歌手」）' };
  return { list: out };
});

ipcMain.handle('add-song', async (event, payload) => {
  const raw = String((payload && payload.bvid) || '').trim();
  const m = raw.match(/BV[0-9A-Za-z]{10}/);
  const bvid = m ? m[0] : '';
  if (!bvid) return { error: '没识别出 BV 号，请粘贴 B 站视频链接或 BV 号' };

  const r = await biliGet('https://api.bilibili.com/x/web-interface/view?bvid=' + bvid);
  if (!r || r.code !== 0) return { error: '获取视频信息失败：' + ((r && r.message) || '网络错误') };

  const d = r.data || {};
  const dur = d.duration || 0;
  const play = (d.stat && d.stat.view) || 0;
  const playTxt = play >= 100000000 ? (play / 100000000).toFixed(1) + '亿'
    : play >= 10000 ? (play / 10000).toFixed(1) + '万' : String(play);
  const title = stripTags(d.title);

  return {
    song: ((payload.song || '').trim()) || title,
    artist: ((payload.artist || '').trim()) || stripTags((d.owner && d.owner.name) || ''),
    bvid: bvid,
    play: play,
    playTxt: playTxt,
    title: title,
    dur: dur,
    durTxt: Math.floor(dur / 60) + ':' + String(dur % 60).padStart(2, '0')
  };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1020,
    height: 920,
    minWidth: 820,
    minHeight: 680,
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: '我的歌单',
    icon: path.join(__dirname, 'music_icon.ico'),
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '我的歌单_自动连播.html'));

  // 给 B 站请求补上 Referer，避免 file:// 下被防盗链拦
  try {
    win.webContents.session.webRequest.onBeforeSendHeaders((details, cb) => {
      if (/bilibili\.com/.test(details.url)) {
        details.requestHeaders['Referer'] = 'https://www.bilibili.com/';
      }
      cb({ requestHeaders: details.requestHeaders });
    });
  } catch (e) { /* 忽略 */ }

  // 导出歌单时弹「另存为」，默认文件名 我的歌单.json
  try {
    win.webContents.session.on('will-download', (e, item) => {
      try {
        item.setSaveDialogOptions({
          title: '导出歌单',
          defaultPath: item.getFilename() || '我的歌单.json',
          filters: [{ name: 'JSON 歌单文件', extensions: ['json'] }]
        });
      } catch (err) { /* 忽略 */ }
    });
  } catch (e) { /* 忽略 */ }

  // 外部链接用系统浏览器打开，不在窗口内跳走
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
