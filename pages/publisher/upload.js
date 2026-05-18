const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')

Page({
  data: {
    categories: ['文学', '科技', '经管', '教育', '武侠', '科幻', '历史', '悬疑'],
    categoryIndex: 0,
    fileName: '',
    filePath: '',
    form: {
      title: '',
      author: '',
      publisher: '【测试】出版社',
      category: '文学',
      description: '',
      price: '',
      copyright: '',
    },
    navBarHeight: 0,
    statusBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    showUploadPrivacyModal: false,
  },

  onLoad() {
    const app = getApp()
    this.pendingChooseFileAfterPrivacy = false
    this.registerPrivacyAuthorization()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      statusBarHeight: app.globalData.statusBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })
  },

  registerPrivacyAuthorization() {
    if (typeof wx.onNeedPrivacyAuthorization !== 'function') {
      return
    }

    wx.onNeedPrivacyAuthorization((resolve) => {
      getApp().globalData._privacyResolve = resolve
      this.setData({ showUploadPrivacyModal: true })
    })
  },

  onShow() {
    this.guardPublisherRole()
  },

  handleBack() {
    wx.navigateBack()
  },

  handleInput(event) {
    const field = event.currentTarget.dataset.field
    const form = Object.assign({}, this.data.form, {
      [field]: event.detail.value,
    })
    this.setData({ form })
  },

  handleCategoryChange(event) {
    const categoryIndex = Number(event.detail.value)
    const form = Object.assign({}, this.data.form, {
      category: this.data.categories[categoryIndex],
    })
    this.setData({
      categoryIndex,
      form,
    })
  },

  handleChooseFile() {
    this.pendingChooseFileAfterPrivacy = true
    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      this.setData({ showUploadPrivacyModal: true })
      return
    }

    wx.requirePrivacyAuthorize({
      success: () => {
        if (!this.pendingChooseFileAfterPrivacy) {
          return
        }
        this.pendingChooseFileAfterPrivacy = false
        wx.setStorageSync('upload_file_privacy_authorized_by_button', true)
        this.chooseBookFile()
      },
      fail: (error) => {
        this.pendingChooseFileAfterPrivacy = false
        console.error('[publisher] upload privacy authorize failed', error)
        wx.showToast({
          title: error && error.errno === 112
            ? '请先在隐私指引声明文件上传用途'
            : '未获得文件上传授权',
          icon: 'none',
        })
      },
    })
  },

  handleAgreeUploadPrivacy(event) {
    wx.setStorageSync('upload_file_privacy_agreed', true)
    wx.setStorageSync('upload_file_privacy_authorized_by_button', true)
    this.setData({ showUploadPrivacyModal: false })
    getApp().resolvePrivacy(true, event)
    if (typeof wx.requirePrivacyAuthorize !== 'function' && this.pendingChooseFileAfterPrivacy) {
      this.pendingChooseFileAfterPrivacy = false
      this.chooseBookFile()
    }
  },

  handleDisagreeUploadPrivacy(event) {
    this.pendingChooseFileAfterPrivacy = false
    this.setData({ showUploadPrivacyModal: false })
    getApp().resolvePrivacy(false, event)
  },

  chooseBookFile() {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file) {
          return
        }
        this.setData({
          fileName: file.name,
          filePath: file.path,
        })
        wx.showToast({
          title: '文件已选择',
          icon: 'success',
        })
      },
      fail: (error) => {
        console.error('[publisher] choose file failed', error)
        wx.showToast({
          title: (error && error.errMsg) || '选取文件失败',
          icon: 'none',
        })
      },
    })
  },

  handleStopPropagation() {},

  handleSubmit() {
    const { form, fileName, filePath } = this.data
    if (!form.title || !form.author || !form.publisher || !form.category || !form.description || !form.price || !form.copyright) {
      wx.showToast({
        title: '请填写完整信息',
        icon: 'none',
      })
      return
    }

    if (!fileName || !filePath) {
      wx.showToast({
        title: '请先选择文件',
        icon: 'none',
      })
      return
    }

    wx.showLoading({ title: '上传中...' })
    api.uploadBook(Object.assign({}, form, { filePath }))
      .then((book) => {
        wx.hideLoading()
        wx.showToast({
          title: '上传成功',
          icon: 'success',
        })
        setTimeout(() => {
          getApp().globalData.publisherBuildIntent = {
            bookId: book.id,
            autoStart: true,
          }
          wx.switchTab({
            url: '/pages/publisher/build',
          })
        }, 500)
      })
      .catch((error) => {
        wx.hideLoading()
        wx.showToast({
          title: error.message || '上传失败',
          icon: 'none',
        })
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
