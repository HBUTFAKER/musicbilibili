// 自动测试：本地歌单的数据版本迁移（现场版 -> 录音室版）
require('./main.js');
const { app, BrowserWindow } = require('electron');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(4500);
  const w = BrowserWindow.getAllWindows()[0];
  const js = (code) => w.webContents.executeJavaScript(code);

  // 1) 归零到内置歌单
  await js(`(function(){
    localStorage.removeItem('myList_v1');
    localStorage.removeItem('myList_ver');
  })()`);
  await w.webContents.reload();
  await sleep(3200);

  // 2) 触发一次保存（点「恢复默认」两次），让本地存下一份歌单，并假装是"旧版数据"
  const seeded = await js(`(function(){
    document.getElementById('btnReset').click();
    document.getElementById('btnReset').click();
    var cur = JSON.parse(localStorage.getItem('myList_v1') || '[]');
    // 塞一首"用户自己加的"歌，验证迁移不会动它
    cur.push({ song: '我自己加的歌', artist: '我', bvid: 'BV1xx411c7mD', play: 123, playTxt: '123',
               title: '自定义', dur: 200, durTxt: '3:20', __custom: true });
    // 把 3 首改回旧的现场版 BV，模拟老数据
    var OLD = { '富士山下': 'BV1H3411C7ZJ', '小情歌': 'BV1vz4y117h9', 'BLUE': 'BV1HAKUzTEJA' };
    cur.forEach(function (s) {
      if (OLD[s.song]) { s.bvid = OLD[s.song]; s.title = '【旧现场版】' + s.song; }
    });
    localStorage.setItem('myList_v1', JSON.stringify(cur));
    localStorage.removeItem('myList_ver');   // 清掉版本号 = 待迁移
    return '命中旧数据的歌: ' + cur.filter(function (s) { return String(s.title).indexOf('【旧现场版】') === 0; }).length
      + ' | 本地共 ' + cur.length + ' 首';
  })()`);
  console.log('SEED   ', seeded);

  // 3) 重新加载页面 → 应自动迁移
  await w.webContents.reload();
  await sleep(3200);

  console.log('MIGRATE', await js(`(function(){
    var cur = JSON.parse(localStorage.getItem('myList_v1') || '[]');
    var out = {};
    ['富士山下', '小情歌', 'BLUE'].forEach(function (n) {
      var x = cur.filter(function (s) { return s.song === n; })[0];
      out[n] = x ? (x.bvid + ' 《' + x.title.slice(0, 26) + '》') : '缺失';
    });
    out['版本号'] = localStorage.getItem('myList_ver');
    out['自定义歌还在'] = cur.some(function (s) { return s.song === '我自己加的歌'; });
    out['总首数'] = cur.length;
    return JSON.stringify(out);
  })()`));

  // 4) 页面列表里显示的是不是新版本
  console.log('VIEW   ', await js(`(function(){
    var inp = document.getElementById('inpSearch');
    inp.value = '富士山下';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var row = document.querySelector('.item');
    var t = row ? row.querySelector('.s').textContent : 'none';
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return '搜到: ' + t + ' | 列表里已无"旧现场版"标记: '
      + !document.body.innerHTML.includes('【旧现场版】');
  })()`));

  // 5) 清理，恢复干净状态
  await js(`(function(){
    localStorage.removeItem('myList_v1');
    localStorage.removeItem('myList_ver');
  })()`);
  await w.webContents.reload();
  await sleep(2500);
  console.log('CLEAN  ', await js(`'total=' + document.getElementById('total').textContent`));

  await sleep(300);
  app.quit();
});
