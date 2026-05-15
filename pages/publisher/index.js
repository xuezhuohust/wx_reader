const api = require('../../utils/api')
const { ensureRole, getUserRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')

Page({
  data: {
    publisher: null,
    stats: {},
    entries: [
      {
        title: '书目管理',
        desc: '搜索、上下架与状态掌控',
        path: '/pages/publisher/books',
        type: 'tab',
        iconClass: 'icon-library-orange',
        tintClass: 'tint-peach'
      },
      {
        title: '上传书籍',
        desc: '录入新书目并同步源文件',
        path: '/pages/publisher/upload',
        type: 'page',
        iconClass: 'icon-upload-blue',
        tintClass: 'tint-sky'
      },
      {
        title: '建库任务',
        desc: '启动 AI 建库并追踪进度',
        path: '/pages/publisher/build',
        type: 'tab',
        iconClass: 'icon-build-purple',
        tintClass: 'tint-lavender'
      },
    ],
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    activityData: [],
    maxActivity: 100,
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
    syncRoleTabBar(this, 'pages/publisher/index')
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
        // Generate mock activity data based on totalChatCount
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        const total = res.totalChatCount || 0
        const activityData = days.map((day, index) => {
          // Create some variance
          const base = total / 7
          const value = Math.floor(base * (0.5 + Math.random()))
          return { day, value: value || Math.floor(Math.random() * 20) + 5 }
        })
        
        const maxActivity = Math.max(...activityData.map(d => d.value), 10)

        this.setData({
          publisher: res.publisher,
          stats: res,
          activityData,
          maxActivity: maxActivity * 1.2, // Add some headroom
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

  handleGoBooks() {
    wx.switchTab({
      url: '/pages/publisher/books',
    })
  },

  handleSwitchToReader() {
    const app = getApp()
    wx.showLoading({ title: '正在切换...' })
    
    app.switchUserRole('reader')
      .then((identity) => {
        syncRoleTabBar(this, 'pages/index/index', identity)
        wx.hideLoading()
        wx.switchTab({
          url: '/pages/index/index',
          success: () => {
            wx.showToast({ title: '已回到读者模式', icon: 'success' })
          }
        })
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '切换失败', icon: 'none' })
      })
  },

  guardPublisherRole() {
    const { loadIdentity } = require('../../utils/storage')
    const identity = loadIdentity()
    const role = getUserRole(identity)
    
    if (role === 'reader') {
      wx.switchTab({
        url: '/pages/index/index',
      })
      return false
    }
    return true
  },
})
