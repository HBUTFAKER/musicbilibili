const { contextBridge, ipcRenderer } = require('electron');

// 暴露给页面：控制 B 站播放器 + 搜歌 / 添加歌曲
// 这些能力浏览器里跨域做不到，独立窗口通过主进程直接操作播放器 / 请求接口
contextBridge.exposeInMainWorld('__playerCtl', {
  control: (action) => ipcRenderer.invoke('player-ctl', action),
  state: () => ipcRenderer.invoke('player-state'),
  seek: (sec) => ipcRenderer.invoke('player-seek', sec),
  addSong: (payload) => ipcRenderer.invoke('add-song', payload),
  search: (keyword) => ipcRenderer.invoke('search-song', keyword)
});
