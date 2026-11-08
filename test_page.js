// 自动测试：加载真实应用，验证歌单增删/清空/恢复默认/存储
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

  // 1) 初始状态
  const init = await js(`(function(){
    return {
      total: document.getElementById('total').textContent,
      items: document.querySelectorAll('.item').length,
      btns: ['btnAdd','btnExport','btnImport','btnReset','btnClear'].filter(function(id){return !document.getElementById(id);}),
      delBtns: document.querySelectorAll('.item .del').length,
      modeTxt: document.getElementById('modeTxt').textContent,
      nowSong: document.getElementById('nowSong').textContent
    };
  })()`);
  console.log('INIT   ', JSON.stringify(init));

  // 2) 删掉第 1 首
  const del = await js(`(function(){
    var before = document.getElementById('total').textContent;
    document.querySelector('.item .del').click();
    return before + ' -> ' + document.getElementById('total').textContent
      + ' | 列表行数 ' + document.querySelectorAll('.item').length;
  })()`);
  console.log('DELETE ', del);

  // 3) 清空（按钮要连点两次）
  const arm = await js(`(function(){
    document.getElementById('btnClear').click();
    return document.getElementById('btnClear').innerHTML;
  })()`);
  const cleared = await js(`(function(){
    document.getElementById('btnClear').click();
    return 'total=' + document.getElementById('total').textContent
      + ' rows=' + document.querySelectorAll('.item').length
      + ' 空提示=' + (document.querySelector('.empty') ? '有' : '无')
      + ' 存储=' + (localStorage.getItem('myList_v1') || '');
  })()`);
  console.log('ARM    ', arm);
  console.log('CLEAR  ', cleared);

  // 4) 刷新页面后应保持"空"（不被默认歌单覆盖）
  await w.webContents.reload();
  await sleep(3000);
  const afterReload = await js(`(function(){
    return '刷新后 total=' + document.getElementById('total').textContent
      + ' rows=' + document.querySelectorAll('.item').length;
  })()`);
  console.log('RELOAD ', afterReload);

  // 5) 恢复默认
  await js(`document.getElementById('btnReset').click(); document.getElementById('btnReset').click();`);
  await sleep(600);
  const reset = await js(`(function(){
    return '恢复后 total=' + document.getElementById('total').textContent
      + ' rows=' + document.querySelectorAll('.item').length;
  })()`);
  console.log('RESET  ', reset);

  // 6) 导出用的 JSON 能解析回去
  const roundtrip = await js(`(function(){
    var data = JSON.parse(localStorage.getItem('myList_v1') || '[]');
    return '导出条目=' + data.length + ' 首条=' + JSON.stringify(data[0]).slice(0, 60);
  })()`);
  console.log('EXPORT ', roundtrip);

  await sleep(500);
  console.log('ERRORS ', errors.length ? JSON.stringify(errors) : '无');
  app.quit();
});
