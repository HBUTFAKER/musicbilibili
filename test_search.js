// 自动测试：歌单搜索过滤 + 按歌名搜歌添加
require('./main.js');
const { app, BrowserWindow } = require('electron');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  await sleep(4500);
  const w = BrowserWindow.getAllWindows()[0];
  const errors = [];
  w.webContents.on('console-message', (e, level, msg) => {
    if (level >= 2) errors.push('[' + level + '] ' + msg);
  });
  const js = (code) => w.webContents.executeJavaScript(code);

  // 归零到内置歌单，保证基线
  await js(`(function(){ try { localStorage.removeItem('myList_v1'); } catch (e) {} })()`);
  await w.webContents.reload();
  await sleep(3500);

  console.log('BASE   ', await js(`'total=' + document.getElementById('total').textContent
    + ' rows=' + document.querySelectorAll('.item').length`));

  // 1) 搜索框输入「陈粒」→ 列表只剩含陈粒的
  console.log('FILTER ', await js(`(function(){
    var inp = document.getElementById('inpSearch');
    inp.value = '陈粒';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var rows = Array.prototype.map.call(document.querySelectorAll('.item'), function (el) {
      return el.querySelector('.s').textContent + '/' + el.querySelector('.a').textContent + '/idx' + el.dataset.idx;
    });
    return JSON.stringify({
      total: document.getElementById('total').textContent,
      title: document.getElementById('listTitle').textContent.trim(),
      rows: rows
    });
  })()`));

  // 2) 过滤状态下删掉第一条（验证删的是真身，不是错位的那首）
  console.log('DEL-F  ', await js(`(function(){
    var el = document.querySelectorAll('.item')[0];
    var name = el.querySelector('.s').textContent;
    var realIdx = el.dataset.idx;
    el.querySelector('.del').click();
    var still = Array.prototype.map.call(document.querySelectorAll('.item'), function (x) {
      return x.querySelector('.s').textContent;
    });
    return '删掉=' + name + ' (原第' + (Number(realIdx) + 1) + '首) | 过滤视图剩=' + still.join(',')
      + ' | 存储条数=' + JSON.parse(localStorage.getItem('myList_v1') || '[]').length;
  })()`));

  // 3) 清空搜索 → 恢复全量
  console.log('CLR-SR ', await js(`(function(){
    document.getElementById('btnSearchClear').click();
    return 'total=' + document.getElementById('total').textContent
      + ' rows=' + document.querySelectorAll('.item').length
      + ' hasClass=' + document.getElementById('searchBar').classList.contains('has');
  })()`));

  // 4) 搜一个不存在的词 → 友好空提示
  console.log('NO-HIT ', await js(`(function(){
    var inp = document.getElementById('inpSearch');
    inp.value = 'zzzzz不存在的歌zzzzz';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var out = 'total=' + document.getElementById('total').textContent
      + ' 空提示=' + (document.querySelector('.empty') ? document.querySelector('.empty').textContent.slice(0, 24) : '无');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    return out;
  })()`));

  // 5) 按歌名搜歌（走主进程 B 站接口）
  await js(`(function(){
    document.getElementById('btnAdd').click();
    document.getElementById('inpQuery').value = '周杰伦 稻香';
    document.getElementById('btnAddOk').click();
  })()`);
  await sleep(7000);
  console.log('SEARCH ', await js(`(function(){
    var items = document.querySelectorAll('.sritem');
    return JSON.stringify({
      count: items.length,
      first: items[0] ? items[0].querySelector('.srt').textContent.slice(0, 40) : '',
      meta: items[0] ? items[0].querySelector('.sra').textContent.slice(0, 60) : '',
      msg: document.getElementById('addMsg').textContent
    });
  })()`));

  // 6) 点「＋ 添加」把搜索结果第一首加进歌单
  console.log('ADD    ', await js(`(function(){
    var items = document.querySelectorAll('.sritem');
    if (!items.length) return '没有结果，跳过';
    var btn = items[0].querySelector('.sradd');
    var before = Number(document.getElementById('total').textContent);
    btn.click();
    return '添加前=' + before + ' 添加后=' + document.getElementById('total').textContent
      + ' 按钮=' + btn.textContent + ' msg=' + document.getElementById('addMsg').textContent.slice(0, 40);
  })()`));

  // 7) 新加的歌能在搜索框里搜到
  console.log('FIND   ', await js(`(function(){
    var inp = document.getElementById('inpSearch');
    inp.value = '稻香';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    var out = Array.prototype.map.call(document.querySelectorAll('.item'), function (el) {
      return el.querySelector('.s').textContent.slice(0, 26);
    });
    return JSON.stringify(out);
  })()`));

  // 8) 恢复默认，别污染下次运行（顺便验证会自动清掉搜索词）
  await js(`document.getElementById('btnReset').click(); document.getElementById('btnReset').click();`);
  await sleep(800);
  console.log('RESET  ', await js(`'total=' + document.getElementById('total').textContent
    + ' 存储=' + JSON.parse(localStorage.getItem('myList_v1') || '[]').length
    + ' 搜索框=' + JSON.stringify(document.getElementById('inpSearch').value)
    + ' 过滤类=' + document.getElementById('searchBar').classList.contains('has')`));

  await sleep(300);
  console.log('ERRORS ', errors.length ? JSON.stringify(errors) : '无');
  await sleep(300);
  app.quit();
});
