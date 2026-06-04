const { syncProfileIdentity } = require('../../services/user')
const { loadIdentity, saveIdentity } = require('../../utils/storage')

Page({
  data: {
    identity: null,
    nicknameDraft: '',
    saving: false,
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    menuWidth: 0,
    menuRight: 0,
    scrolled: false,
  },

  onLoad() {
    const app = getApp()
    const identity = loadIdentity()
    const displayName = identity ? String(identity.displayName || '').trim() : ''
    this.setData({
      identity,
      nicknameDraft: displayName,
      placeholderInitial: displayName ? displayName.charAt(0).toUpperCase() : '?',
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      menuWidth: app.globalData.menuWidth,
      menuRight: app.globalData.menuRight,
    })
  },

  onShow() {
    const identity = loadIdentity()
    if (identity) {
      const displayName = String(identity.displayName || '').trim()
      this.setData({
        identity,
        nicknameDraft: displayName,
        placeholderInitial: displayName ? displayName.charAt(0).toUpperCase() : '?',
      })
    }
  },

  handleBack() {
    wx.navigateBack()
  },

  handleScroll(e) {
    this.setData({ scrolled: e.detail.scrollTop > 10 })
  },

  onChooseAvatar(event) {
    const { avatarUrl } = event.detail
    const { identity } = this.data

    if (!identity || !avatarUrl) return

    syncProfileIdentity({ avatarUrl })
      .then((nextIdentity) => {
        this.setData({ identity: nextIdentity })
        wx.showToast({ title: '头像已更新', icon: 'success' })
      })
      .catch(() => {
        const nextIdentity = saveIdentity(Object.assign({}, identity, {
          avatarUrl,
          updatedAt: Date.now(),
        }))
        this.setData({ identity: nextIdentity })
        wx.showToast({ title: '头像已更新', icon: 'success' })
      })
  },

  handleNicknameDraftInput(event) {
    this.setData({
      nicknameDraft: String(event.detail.value || ''),
    })
  },

  handleSave() {
    const { identity, nicknameDraft, saving } = this.data
    const displayName = String(nicknameDraft || '').trim()

    if (saving) return

    if (!identity) {
      wx.showToast({ title: '请先登录', icon: 'none' })
      return
    }

    if (!displayName) {
      wx.showToast({ title: '请输入昵称', icon: 'none' })
      return
    }

    if (displayName === '微信用户' || displayName.startsWith('微信用户 ')) {
      wx.showToast({ title: '请输入有效昵称', icon: 'none' })
      return
    }

    this.setData({ saving: true })

    syncProfileIdentity({ displayName })
      .then((nextIdentity) => {
        this.setData({
          identity: nextIdentity,
          nicknameDraft: displayName,
          placeholderInitial: displayName.charAt(0).toUpperCase(),
          saving: false,
        })
        wx.showToast({ title: '保存成功', icon: 'success' })
      })
      .catch(() => {
        const nextIdentity = saveIdentity(Object.assign({}, identity, {
          displayName,
          updatedAt: Date.now(),
        }))
        this.setData({
          identity: nextIdentity,
          nicknameDraft: displayName,
          placeholderInitial: displayName.charAt(0).toUpperCase(),
          saving: false,
        })
        wx.showToast({ title: '保存成功', icon: 'success' })
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
          wx.switchTab({ url: '/pages/index/index' })
        }
      }
    })
  },

})
