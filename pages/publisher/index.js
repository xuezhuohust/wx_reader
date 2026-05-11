const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')

Page({
  data: {
    publisher: null,
    stats: {},
    entries: [
      {
        title: '书目管理',
        desc: '搜索、上下架与查看详情',
        path: '/pages/publisher/books',
        type: 'tab',
      },
      {
        title: '上传书籍',
        desc: '录入书目并上传源文件',
        path: '/pages/publisher/upload',
        type: 'page',
      },
      {
        title: '建库任务',
        desc: '启动建库并查看进度',
        path: '/pages/publisher/build',
        type: 'tab',
      },
    ],
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
  },

  onLoad() {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })
  },

  onShow() {
    if (!this.guardPublisherRole()) {
      return
    }
    this.loadStats()
  },

  onPullDownRefresh() {
    this.loadStats(() => {
      wx.stopPullDownRefresh()
    })
  },

  loadStats(done) {
    api.getPublisherStats()
      .then((res) => {
        this.setData({
          publisher: res.publisher,
          stats: res,
        })
      })
      .catch((error) => {
        console.error('loadStats failed:', error)
        this.setData({
          publisher: null,
          stats: {},
        })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handleEntryTap(event) {
    const { path, type } = event.currentTarget.dataset

    if (type === 'tab') {
      wx.switchTab({
        url: path,
      })
      return
    }

    wx.navigateTo({
      url: path,
    })
  },

  guardPublisherRole() {
    if (ensureRole('publisher')) {
      return true
    }

    wx.showToast({
      title: '请先切换为出版社身份',
      icon: 'none',
    })
    wx.switchTab({
      url: '/pages/index/index',
    })
    return false
  },
})
