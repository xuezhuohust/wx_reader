const api = require('../../utils/api')

Page({
  data: {
    categories: [],
    categoryIndex: 0,
    coverPath: '',
    form: {
      title: '',
      author: '',
      publisher: '',
      category: '',
      description: '',
      price: '',
      copyright: '',
      cover_url: '',
    },
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
  },

  onLoad(options) {
    const app = getApp()
    this.bookId = options.id || ''
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })
    this.loadBookCategories().then(() => {
      if (this.bookId) {
        this.loadBook()
      }
    })
  },

  loadBookCategories() {
    return api.getBookCategoryPicker(this.data.form.category)
      .then(({ categories, categoryIndex, category }) => {
        if (!categories.length) return
        const form = Object.assign({}, this.data.form)
        form.category = category
        this.setData({
          categories,
          categoryIndex,
          form,
        })
      })
      .catch((error) => {
        console.error('[publisher] loadBookCategories failed', error)
      })
  },

  loadBook() {
    api.getBookById(this.bookId).then((book) => {
      if (!book) return
      const categoryIndex = this.data.categories.indexOf(book.category)
      this.setData({
        categoryIndex: categoryIndex >= 0 ? categoryIndex : 0,
        form: {
          title: book.title || '',
          author: book.author || '',
          publisher: book.publisher || '',
          category: book.category || this.data.categories[0] || '',
          description: book.description || '',
          price: String(book.price || ''),
          copyright: book.copyright || '',
          cover_url: book.coverUrl ? api.toAbsoluteUrl(book.coverUrl) : '',
        },
      })
    })
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
    this.setData({ categoryIndex, form })
  },

  handleChooseCover() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const file = (res.tempFiles || [])[0]
        if (!file) return
        this.setData({ coverPath: file.tempFilePath })
      },
      fail: (err) => {
        if (err && err.errMsg && err.errMsg.indexOf('cancel') > -1) return
        console.error('[publisher] choose cover failed', err)
      },
    })
  },

  handleSubmit() {
    const { form, coverPath } = this.data
    if (!form.title || !form.author) {
      wx.showToast({ title: '书名和作者不能为空', icon: 'none' })
      return
    }

    wx.showLoading({ title: '保存中...' })

    const coverPromise = coverPath
      ? api.uploadCover(coverPath)
      : Promise.resolve(form.cover_url || '')

    coverPromise
      .then((coverUrl) => {
        return api.updateBookMetadata(this.bookId, {
          title: form.title,
          author: form.author,
          publisher: form.publisher,
          category: form.category,
          description: form.description,
          price: form.price,
          copyright: form.copyright,
          cover_url: coverUrl,
        })
      })
      .then(() => {
        wx.hideLoading()
        wx.showToast({ title: '保存成功', icon: 'success' })
        setTimeout(() => wx.navigateBack(), 500)
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({ title: err.message || '保存失败', icon: 'none' })
      })
  },
})
