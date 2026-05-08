const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')
const { syncRoleTabBar } = require('../../utils/tab-bar')
const { bootstrapUserIdentity, syncProfileIdentity } = require('../../services/user')
const { saveIdentity } = require('../../utils/storage')

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
  },

  onShow() {
    if (!this.guardReaderRole()) {
      return
    }

    syncRoleTabBar(this, 'pages/my-books/my-books')
    this.bootstrapIdentity()
    this.loadBooks()
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
    const { book } = event.detail
    wx.navigateTo({
      url: `/pages/book-detail/book-detail?id=${book.id}`,
    })
  },

  handleActionTap(event) {
    const { book } = event.detail
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${book.id}`,
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
