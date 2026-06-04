const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')
const { bootstrapUserIdentity, syncProfileIdentity } = require('../../services/user')
const { saveIdentity } = require('../../utils/storage')
const { appVersion } = require('../../utils/version')

function shouldShowProfileModal(identity) {
  if (!identity) {
    return false
  }

  const displayName = String(identity.displayName || '').trim()
  return !displayName || displayName.indexOf('微信用户') > -1
}

function isValidDisplayName(displayName) {
  const normalizedName = String(displayName || '').trim()
  return !!(normalizedName && normalizedName !== '微信用户')
}

Page({
  data: {
    books: [],
    identity: null,
    showProfileModal: false,
    nicknameDraft: '',
    profileSaving: false,
    appVersion,
    navBarHeight: 0,
    statusBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
  },

  onLoad() {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })
  },

  onShow() {
    this.loadBooks()

    const { getUserRole } = require('../../utils/role')
    const { loadIdentity } = require('../../utils/storage')
    const identity = loadIdentity()
    const role = getUserRole(identity)

    this.setData({
      identity,
      currentRole: role
    })
    syncRoleTabBar(this, 'pages/my-books/my-books', identity)
    this.setProfileTabBarHidden(this.data.showProfileModal)
  },

  onHide() {
    this.setProfileTabBarHidden(false)
  },

  onUnload() {
    this.setProfileTabBarHidden(false)
  },

  setProfileTabBarHidden(hidden) {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar && typeof tabBar.setHidden === 'function') {
      tabBar.setHidden(!!hidden)
    }
  },

  bootstrapIdentity() {
    bootstrapUserIdentity()
      .then((identity) => {
        const displayName = identity ? String(identity.displayName || '').trim() : ''
        this.setData({
          identity,
          nicknameDraft: displayName,
        })
      })
  },

  handleOpenProfile() {
    if (!this.data.identity) {
      this.bootstrapIdentity()
      return
    }

    this.setData({
      showProfileModal: true,
    })
    this.setProfileTabBarHidden(true)
  },

  onChooseAvatar(event) {
    const { avatarUrl } = event.detail
    const { identity } = this.data

    if (!identity || !avatarUrl) {
      return
    }

    syncProfileIdentity({ avatarUrl })
      .then((nextIdentity) => {
        this.setData({ identity: nextIdentity })
      })
      .catch((error) => {
        console.error('sync avatar failed:', error)
        const nextIdentity = saveIdentity(Object.assign({}, identity, {
          avatarUrl,
          updatedAt: Date.now(),
        }))
        this.setData({ identity: nextIdentity })
      })
  },

  handleNicknameDraftInput(event) {
    const displayName = String(event.detail.value || '')
    this.setData({
      nicknameDraft: displayName,
    })
  },

  handleProfileSubmit() {
    const { identity, nicknameDraft, profileSaving } = this.data
    const displayName = String(nicknameDraft || '').trim()

    if (profileSaving) {
      return
    }

    if (!identity) {
      return
    }

    if (!isValidDisplayName(displayName)) {
      wx.showToast({
        title: '请输入有效昵称',
        icon: 'none',
      })
      return
    }

    this.setData({
      profileSaving: true,
    })

    syncProfileIdentity({ displayName })
      .then((nextIdentity) => {
        this.setData({
          identity: nextIdentity,
          nicknameDraft: displayName,
          profileSaving: false,
          showProfileModal: false,
        })
        this.setProfileTabBarHidden(false)

        wx.showToast({
          title: '身份同步成功',
          icon: 'success',
        })
      })
      .catch((error) => {
        console.error('sync nickname failed:', error)
        const nextIdentity = saveIdentity(Object.assign({}, identity, {
          displayName,
          updatedAt: Date.now(),
        }))

        this.setData({
          identity: nextIdentity,
          nicknameDraft: displayName,
          profileSaving: false,
          showProfileModal: false,
        })
        this.setProfileTabBarHidden(false)

        wx.showToast({
          title: '身份同步成功',
          icon: 'success',
        })
      })
  },

  handleCloseProfile() {
    this.setData({
      showProfileModal: false,
    })
    this.setProfileTabBarHidden(false)
  },

  handleStopPropagation() {},

  onPullDownRefresh() {
    this.loadBooks(() => {
      wx.stopPullDownRefresh()
    })
  },

  loadBooks(done) {
    api.getPurchasedBooks()
      .then((books) => {
        this.setData({ books })
      })
      .catch((error) => {
        console.error('loadPurchasedBooks failed:', error)
        this.setData({ books: [] })
      })
      .finally(() => {
        if (typeof done === 'function') {
          done()
        }
      })
  },

  handleBookTap(event) {
    const { book } = event.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleOpenSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  },

  handleFeedback() {
    wx.showToast({ title: '反馈功能开发中', icon: 'none' })
  },

  handleAbout() {
    wx.showModal({
      title: '关于我们',
      content: `智能伴读小程序 v${appVersion}\n专注于为您提供沉浸式的阅读体验。`,
      showCancel: false
    })
  },

  handleDeveloping() {
    wx.showToast({
      title: '功能开发中',
      icon: 'none',
      duration: 2000
    })
  },

  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出当前账号吗？',
      success: (res) => {
        if (res.confirm) {
          const { clearIdentity } = require('../../utils/storage')
          clearIdentity()
          this.setData({ identity: null })
          wx.showToast({ title: '已退出登录', icon: 'success' })
        }
      }
    })
  },

  handleRoleChange(event) {
    const { role } = event.currentTarget.dataset
    const app = getApp()
    
    wx.showLoading({ title: '切换中...' })
    app.switchUserRole(role)
      .then((identity) => {
        this.setData({ 
          identity,
          currentRole: role 
        })
        
        // 关键修复：切换身份后先刷新底栏，再执行跳转
        syncRoleTabBar(this, 'pages/my-books/my-books', identity)
        
        wx.hideLoading()
        wx.showToast({ title: '身份已切换', icon: 'success' })
        
        // 跳转到对应角色的首页/仪表盘
        if (role === 'publisher') {
          wx.switchTab({ url: '/pages/publisher/index' })
        } else {
          wx.switchTab({ url: '/pages/index/index' })
        }
      })
      .catch(() => {
        wx.hideLoading()
        wx.showToast({ title: '切换失败', icon: 'none' })
      })
  },

  handleActionTap(event) {
    const { book } = event.detail
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleExplore() {
    wx.switchTab({
      url: '/pages/index/index',
    })
  },

  guardReaderRole() {
    if (ensureRole('reader')) {
      return true
    }

    wx.showToast({
      title: '请先切换为读者身份',
      icon: 'none',
    })
    wx.switchTab({
      url: '/pages/index/index',
    })
    return false
  },
})
