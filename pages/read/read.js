const api = require('../../utils/api')

Page({
  data: {
    bookId: '',
    book: null,
    currentChapterIndex: 0,
    currentPageIndex: 0,
    currentChapterName: '',
    allChapters: [],
    allChapterNames: [],
    chapterPages: [], // 存储当前章节的分页内容
    loading: true,
    readingProgress: 0,
    totalChapters: 0,
    scrollTop: 0,
    showControls: true,
    showTocSheet: false,
    showSelectionMenu: false,
    selectedParaText: '',
    navBarHeight: 64,
    menuTop: 24,
    menuHeight: 32
  },

  onLoad(options) {
    const { id, index } = options
    const chapterIndex = parseInt(index || 0)
    
    const app = getApp()
    this.setData({
      bookId: id,
      currentChapterIndex: chapterIndex,
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })

    this.loadBookData(id)
  },

  loadBookData(id) {
    api.getBookById(id).then(book => {
      const processedChapters = this.normalizeChapters(book)
      const chapterNames = processedChapters.map(chapter => chapter.title)

      this.setData({
        book,
        totalChapters: processedChapters.length,
        allChapters: processedChapters,
        allChapterNames: chapterNames,
      })
      this.loadChapterContent()
    }).catch(err => {
      console.error('加载书籍失败:', err)
      wx.showToast({ title: '加载书籍失败', icon: 'none' })
    })
  },

  normalizeChapters(book) {
    const rawChapters = Array.isArray(book.chapterList)
      ? book.chapterList
      : (Array.isArray(book.chapter_list)
        ? book.chapter_list
        : (Array.isArray(book.chaptersJson)
          ? book.chaptersJson
          : (Array.isArray(book.chapters)
            ? book.chapters
            : (Array.isArray(book.catalog) ? book.catalog : (Array.isArray(book.sections) ? book.sections : [])))))

    return rawChapters.map((chapter, index) => {
      if (typeof chapter === 'string') {
        return {
          id: `ch-${String(index + 1).padStart(3, '0')}`,
          title: chapter || `第 ${index + 1} 章`,
        }
      }

      const title = String((chapter && (chapter.title || chapter.name)) || `第 ${index + 1} 章`)
      const id = String(
        (chapter && (chapter.id || chapter.nodeId || chapter.node_id || chapter.chapterId || chapter.chapter_id))
        || `ch-${String(index + 1).padStart(3, '0')}`
      )

      return {
        id,
        title,
      }
    })
  },

  loadChapterContent(fromDirection = 'next') {
    const { currentChapterIndex, allChapterNames, allChapters } = this.data
    const chapter = allChapters[currentChapterIndex] || {}
    const chapterName = chapter.title || allChapterNames[currentChapterIndex] || `第 ${currentChapterIndex + 1} 章`
    
    this.setData({ 
      loading: true, 
      scrollTop: 0,
      currentChapterName: chapterName
    })

    this.fetchChapterLines(chapter.id)
      .then((lines) => {
        this.buildChapterPages(lines, fromDirection)
      })
      .catch((err) => {
        console.error('加载章节原文失败:', err)
        wx.showToast({
          title: err.message || '加载章节失败',
          icon: 'none',
        })
        this.buildChapterPages([
          `章节原文加载失败：${err.message || '请稍后重试'}`,
        ], fromDirection)
      })
  },

  fetchChapterLines(chapterId) {
    const { bookId } = this.data
    if (!chapterId) {
      return Promise.reject(new Error('章节 ID 缺失'))
    }

    const limit = 200
    const lines = []

    const loadWindow = (offset) => {
      return api.getOriginalText(bookId, chapterId, offset, limit).then((data) => {
        const rows = Array.isArray(data.lines) ? data.lines : []
        rows.forEach((row) => {
          lines.push(String(row && row.text != null ? row.text : ''))
        })

        if (data.hasNext && data.nextOffset != null) {
          return loadWindow(Number(data.nextOffset))
        }

        if (!lines.length && data.content) {
          return String(data.content).split('\n')
        }

        return lines
      })
    }

    return loadWindow(0)
  },

  buildChapterPages(lines, fromDirection = 'next') {
    const { currentChapterIndex, totalChapters } = this.data
    const pages = []
    
    // 1. 返回上一章桥接页
    if (currentChapterIndex > 0) {
      pages.push({ type: 'prev-bridge', text: '正在返回上一章...' })
    }

    // 2. 正文分页逻辑
    const CHARS_PER_LINE = 18 
    const LINES_PER_PAGE = 27 // 调优后的行数，确保在各种屏幕下底部都有足够的留白
    const sourceLines = Array.isArray(lines) && lines.length ? lines : ['本章暂无原文内容']
    
    let currentPage = []
    let currentLines = 0
    
    sourceLines.forEach(line => {
      const text = String(line || '')
      const pLines = text.trim() ? Math.max(1, Math.ceil(text.length / CHARS_PER_LINE)) : 1
      
      if (currentLines + pLines > LINES_PER_PAGE && currentPage.length > 0) {
        pages.push({ type: 'content', content: currentPage })
        currentPage = []
        currentLines = 0
      }
      
      currentPage.push(text)
      currentLines += pLines
    })
    
    if (currentPage.length > 0) {
      pages.push({ type: 'content', content: currentPage })
    }

    // 3. 进入下一章桥接页
    if (currentChapterIndex < totalChapters - 1) {
      pages.push({ type: 'next-bridge', text: '正在进入下一章...' })
    }

    let startIdx = 0
    if (fromDirection === 'prev') {
      startIdx = pages.length - (currentChapterIndex < totalChapters - 1 ? 2 : 1)
    } else {
      startIdx = currentChapterIndex > 0 ? 1 : 0
    }
    
    this.setData({
      chapterPages: pages,
      loading: false,
      currentPageIndex: startIdx 
    }, () => {
      this.updateReadingProgress()
    })
  },

  updateReadingProgress() {
    const { currentPageIndex, chapterPages } = this.data
    
    // 过滤出真正的正文页
    const contentPages = chapterPages.filter(p => p.type === 'content')
    const totalContentPages = contentPages.length
    
    if (totalContentPages === 0) return

    // 找到当前页在正文页中的索引
    const currentPageObj = chapterPages[currentPageIndex]
    let progress = 0
    
    if (currentPageObj.type === 'content') {
      // 找到当前内容页是第几页（从1开始）
      const contentIdx = contentPages.indexOf(currentPageObj) + 1
      progress = Math.round((contentIdx / totalContentPages) * 100)
    } else if (currentPageObj.type === 'next-bridge') {
      progress = 100
    } else if (currentPageObj.type === 'prev-bridge') {
      progress = 0
    }

    this.setData({
      readingProgress: progress
    })
  },

  handlePrevChapter() {
    if (this.data.currentChapterIndex > 0) {
      const nextIndex = this.data.currentChapterIndex - 1
      this.setData({
        currentChapterIndex: nextIndex
      })
      this.loadChapterContent('prev')
    }
  },

  handleNextChapter() {
    if (this.data.currentChapterIndex < this.data.totalChapters - 1) {
      const nextIndex = this.data.currentChapterIndex + 1
      this.setData({
        currentChapterIndex: nextIndex
      })
      this.loadChapterContent('next')
    }
  },

  onPageChange(e) {
    const { current, source } = e.detail
    const { chapterPages, currentChapterIndex, totalChapters } = this.data
    
    if (source === 'touch') {
      const targetPage = chapterPages[current]
      
      if (targetPage && targetPage.type === 'next-bridge') {
        // 划到了“下一章”占位页
        this.handleNextChapter()
        return
      }
      
      if (targetPage && targetPage.type === 'prev-bridge') {
        // 划到了“上一章”占位页
        this.handlePrevChapter()
        return
      }
    }
    
    this.setData({ currentPageIndex: current }, () => {
      this.updateReadingProgress()
    })
  },

  handleSelectChapter(e) {
    const index = Number(e.currentTarget.dataset.index)
    if (index !== this.data.currentChapterIndex) {
      this.setData({
        currentChapterIndex: index,
        showTocSheet: false
      })
      this.loadChapterContent()
    } else {
      this.handleHideToc()
    }
  },

  handleBack() {
    wx.navigateBack()
  },

  handleScreenTap(e) {
    const { x } = e.detail
    const screenWidth = wx.getSystemInfoSync().windowWidth
    const third = screenWidth / 3

    if (x < third) {
      // 点击左侧 1/3：上一页
      if (this.data.currentPageIndex > 0) {
        this.setData({ currentPageIndex: this.data.currentPageIndex - 1 })
      } else {
        this.handlePrevChapter()
      }
    } else if (x > third * 2) {
      // 点击右侧 1/3：下一页
      if (this.data.currentPageIndex < this.data.chapterPages.length - 1) {
        this.setData({ currentPageIndex: this.data.currentPageIndex + 1 })
      } else {
        this.handleNextChapter()
      }
    } else {
      // 点击中间 1/3：切换工具栏显示
      this.setData({
        showControls: !this.data.showControls
      })
    }
  },

  handleShowToc() {
    this.setData({
      showTocSheet: true,
      showControls: false
    })
  },

  handleHideToc() {
    this.setData({
      showTocSheet: false
    })
  },

  handleToggleToc() {
    this.handleShowToc()
  },

  handleLongPressPara(e) {
    const { text } = e.currentTarget.dataset
    this.setData({
      selectedParaText: text,
      showSelectionMenu: true,
      showControls: false // 长按时隐藏上下控制栏
    })
  },

  handleCloseSelectionMenu() {
    this.setData({
      showSelectionMenu: false,
      selectedParaText: ''
    })
  },

  handleMenuAI() {
    const text = this.data.selectedParaText
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${this.data.bookId}&initialText=${encodeURIComponent(text)}`,
    })
    this.handleCloseSelectionMenu()
  },

  handleMenuCopy() {
    wx.setClipboardData({
      data: this.data.selectedParaText,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'none' })
      }
    })
    this.handleCloseSelectionMenu()
  },

  handleMenuHighlight() {
    wx.showToast({ title: '已划线', icon: 'none' })
    this.handleCloseSelectionMenu()
  },

  handleMenuShare() {
    wx.showToast({ title: '分享功能开发中', icon: 'none' })
    this.handleCloseSelectionMenu()
  },

  nop() {},

  handleStartAI() {
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${this.data.bookId}`,
    })
  }
})
