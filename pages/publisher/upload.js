const api = require('../../utils/api')
const { ensureRole } = require('../../utils/role')

Page({
  data: {
    categories: ['文学', '科技', '经管', '教育'],
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
  },

  onShow() {
    this.guardPublisherRole()
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
      fail: () => {
        wx.showToast({
          title: '选取文件失败',
          icon: 'none',
        })
      },
    })
  },

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
