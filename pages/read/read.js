const api = require('../../utils/api')

const FOOTER_AUTO_HIDE_MS = 1200

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
    chapterWindowOffset: 0,
    chapterWindowLimit: 100,
    chapterWindowNextOffset: null,
    chapterWindowHasNext: false,
    chapterWindowLineCount: 0,  
    loading: true,
    readingProgress: 0,
    totalChapters: 0,
    scrollTop: 0,
    showControls: true,
    showFooterBar: true,
    showTocSheet: false,
    showSelectionMenu: false,
    selectedParaText: '',
    navBarHeight: 64,
    menuTop: 24,
    menuHeight: 32,
    swiperDuration: 300 // 控制滑动动画时长
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

  onUnload() {
    this.clearFooterAutoHideTimer()
  },

  onHide() {
    this.clearFooterAutoHideTimer()
  },

  clearFooterAutoHideTimer() {
    if (this.footerAutoHideTimer) {
      clearTimeout(this.footerAutoHideTimer)
      this.footerAutoHideTimer = null
    }
  },

  scheduleFooterAutoHide() {
    this.clearFooterAutoHideTimer()
    this.footerAutoHideTimer = setTimeout(() => {
      if (this.data.showTocSheet || this.data.showSelectionMenu) return
      this.setData({ showFooterBar: false })
      this.footerAutoHideTimer = null
    }, FOOTER_AUTO_HIDE_MS)
  },

  showFooterTemporarily() {
    this.setData({ showFooterBar: true }, () => {
      this.scheduleFooterAutoHide()
    })
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
    this.loadChapterWindow(0, fromDirection)
  },

  loadChapterWindow(offset = 0, fromDirection = 'next-window') {
    const { currentChapterIndex, allChapterNames, allChapters } = this.data
    const chapter = allChapters[currentChapterIndex] || {}
    const chapterName = chapter.title || allChapterNames[currentChapterIndex] || `第 ${currentChapterIndex + 1} 章`
    const requestSeq = (this.chapterWindowRequestSeq || 0) + 1
    this.chapterWindowRequestSeq = requestSeq
    
    // 切换章节时，先将滑动动画设为 0，防止“回退”动画
    this.setData({ 
      loading: true, 
      scrollTop: 0,
      currentChapterName: chapterName,
      swiperDuration: 0
    })

    // 模拟加载延迟
    setTimeout(() => {
      this.mockChapterContent(fromDirection)
    }, 150)
  },

  mockChapterContent(fromDirection = 'next') {
    const { currentChapterIndex, totalChapters } = this.data
    const lines = windowData && Array.isArray(windowData.lines) ? windowData.lines : []
    const offset = Number((windowData && windowData.offset) || 0)
    const limit = Number((windowData && windowData.limit) || this.data.chapterWindowLimit || 100)
    const nextOffset = windowData && windowData.nextOffset != null ? Number(windowData.nextOffset) : null
    const hasNext = !!(windowData && windowData.hasNext)
    const lineCount = Number((windowData && windowData.lineCount) || 0)
    const pages = []
    
    if (offset > 0) {
      pages.push({
        type: 'prev-window',
        text: '正在加载上一页...',
        offset: Math.max(0, offset - limit),
      })
    } else if (currentChapterIndex > 0) {
      pages.push({ type: 'prev-bridge', text: '正在返回上一章...' })
    }

    // 2. 正文分页逻辑
    // 寻找呼吸感：下调行数上限，恢复合理的段间距权重
    const CHARS_PER_LINE = 18 
    const LINES_PER_PAGE = 27 // 调优后的行数，确保在各种屏幕下底部都有足够的留白
    const paragraphs = fullContent.split('\n')
    
    let currentPage = []
    let currentLines = 0
    
    paragraphs.forEach(p => {
      if (!p.trim()) return
      
      // 恢复段间距权重为 1 行，增加垂直节奏感
      const pLines = Math.ceil(p.length / CHARS_PER_LINE) + 1
      
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

    if (hasNext && nextOffset != null) {
      pages.push({
        type: 'next-window',
        text: '继续阅读下一页...',
        offset: nextOffset,
      })
    } else if (currentChapterIndex < totalChapters - 1) {
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
      chapterWindowOffset: offset,
      chapterWindowLimit: limit,
      chapterWindowNextOffset: nextOffset,
      chapterWindowHasNext: hasNext,
      chapterWindowLineCount: lineCount,
      showFooterBar: true,
      loading: false,
      currentPageIndex: startIdx 
    }, () => {
      this.updateReadingProgress()
    })
  },

  updateReadingProgress() {
    const {
      currentPageIndex,
      chapterPages,
      chapterWindowOffset,
      chapterWindowLineCount,
      chapterWindowNextOffset,
    } = this.data
    
    // 过滤出真正的正文页
    const contentPages = chapterPages.filter(p => p.type === 'content')
    const totalContentPages = contentPages.length
    
    if (totalContentPages === 0) return

    // 找到当前页在正文页中的索引
    const currentPageObj = chapterPages[currentPageIndex]
    if (!currentPageObj) return
    let progress = 0
    
    if (currentPageObj.type === 'content') {
      const linesBeforePage = contentPages
        .slice(0, contentPages.indexOf(currentPageObj))
        .reduce((sum, page) => sum + (Array.isArray(page.content) ? page.content.length : 0), 0)
      const currentPageLines = Array.isArray(currentPageObj.content) ? currentPageObj.content.length : 0
      const readLines = Number(chapterWindowOffset || 0) + linesBeforePage + currentPageLines
      progress = chapterWindowLineCount > 0
        ? Math.round(Math.min(1, readLines / chapterWindowLineCount) * 100)
        : Math.round(((contentPages.indexOf(currentPageObj) + 1) / totalContentPages) * 100)
    } else if (currentPageObj.type === 'next-window') {
      progress = chapterWindowLineCount > 0 && chapterWindowNextOffset != null
        ? Math.round(Math.min(1, Number(chapterWindowNextOffset) / chapterWindowLineCount) * 100)
        : 100
    } else if (currentPageObj.type === 'next-bridge') {
      progress = 100
    } else if (currentPageObj.type === 'prev-window') {
      progress = chapterWindowLineCount > 0
        ? Math.round(Math.min(1, Number(chapterWindowOffset || 0) / chapterWindowLineCount) * 100)
        : 0
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
    const { chapterPages } = this.data
    
    if (source === 'touch') {
      const targetPage = chapterPages[current]
      if (this.handleBridgePage(targetPage)) {
        return
      }
    }
    
    this.setData({ currentPageIndex: current }, () => {
      this.updateReadingProgress()
    })
  },

  handleBridgePage(page) {
    if (!page) return false
    if (page.type === 'next-window') {
      this.loadChapterWindow(Number(page.offset || 0), 'next-window')
      return true
    }
    if (page.type === 'prev-window') {
      this.loadChapterWindow(Number(page.offset || 0), 'prev-window')
      return true
    }
    if (page.type === 'next-bridge') {
      this.handleNextChapter()
      return true
    }
    if (page.type === 'prev-bridge') {
      this.handlePrevChapter()
      return true
    }
    return false
  },

  goToPage(index) {
    const targetPage = this.data.chapterPages[index]
    if (this.handleBridgePage(targetPage)) {
      return
    }
    this.setData({ currentPageIndex: index }, () => {
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
    if (!this.data.showFooterBar) {
      this.showFooterTemporarily()
      return
    }

    this.scheduleFooterAutoHide()

    const { x } = e.detail
    const screenWidth = wx.getSystemInfoSync().windowWidth
    const third = screenWidth / 3

    if (x < third) {
      // 点击左侧 1/3：上一页
      if (this.data.currentPageIndex > 0) {
        this.goToPage(this.data.currentPageIndex - 1)
      } else {
        this.handlePrevChapter()
      }
    } else if (x > third * 2) {
      // 点击右侧 1/3：下一页
      if (this.data.currentPageIndex < this.data.chapterPages.length - 1) {
        this.goToPage(this.data.currentPageIndex + 1)
      } else {
        this.handleNextChapter()
      }
    } else {
      // 点击中间 1/3：切换工具栏显示
      const nextShowControls = !this.data.showControls
      this.setData({
        showControls: nextShowControls,
        showFooterBar: nextShowControls,
      }, () => {
        if (nextShowControls) {
          this.scheduleFooterAutoHide()
        } else {
          this.clearFooterAutoHideTimer()
        }
      })
    }
  },

  handleShowToc() {
    this.clearFooterAutoHideTimer()
    this.setData({
      showTocSheet: true,
      showControls: false,
      showFooterBar: false
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
    this.clearFooterAutoHideTimer()
    this.setData({
      selectedParaText: text,
      showSelectionMenu: true,
      showControls: false, // 长按时隐藏上下控制栏
      showFooterBar: false
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
