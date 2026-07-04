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
    chapterWindowLimit: 1000, // 调大窗口限制，尽量一次性加载整章，避免因为分页截断导致段落无法合并和页面留白
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
    menuWidth: 80,
    menuRight: 7,
    swiperDuration: 300 // 控制滑动动画时长
  },

  onLoad(options) {
    const { id, index } = options
    let chapterIndex = index !== undefined ? parseInt(index) : null

    // 如果没有指定章节，尝试从本地缓存读取上次进度
    if (chapterIndex === null) {
      const allProgress = wx.getStorageSync('reading_progress') || {}
      if (allProgress[id]) {
        chapterIndex = allProgress[id].chapterIndex
      } else {
        chapterIndex = 0
      }
    }

    const app = getApp()
    this.setData({
      bookId: id,
      currentChapterIndex: chapterIndex,
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      menuWidth: app.globalData.menuWidth,
      menuRight: app.globalData.menuRight,
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
    // 移除自动隐藏逻辑，改为手动控制
    this.clearFooterAutoHideTimer()
  },

  showFooterTemporarily() {
    this.setData({ 
      showFooterBar: true,
      showControls: true
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

    this.fetchOriginalTextWindow(chapter.id, offset)
      .then((windowData) => {
        if (requestSeq !== this.chapterWindowRequestSeq) return
        this.buildOriginalTextPages(windowData, fromDirection)
      })
      .catch((err) => {
        if (requestSeq !== this.chapterWindowRequestSeq) return
        console.error('加载章节原文失败:', err)
        wx.showToast({
          title: err.message || '加载章节失败',
          icon: 'none',
        })
        this.buildOriginalTextPages({
          lines: [`章节原文加载失败：${err.message || '请稍后重试'}`],
          offset,
          limit: Number(this.data.chapterWindowLimit || 1000),
          nextOffset: null,
          hasNext: false,
          lineCount: 1,
        }, fromDirection)
      })
  },

  fetchOriginalTextWindow(chapterId, offset = 0) {
    const { bookId, chapterWindowLimit } = this.data
    if (!chapterId) {
      return Promise.reject(new Error('章节 ID 缺失'))
    }

    const limit = Number(chapterWindowLimit || 1000)

    return api.getOriginalText(bookId, chapterId, offset, limit).then((data) => {
      return this.normalizeOriginalTextWindow(data, offset, limit)
    })
  },

  normalizeOriginalTextWindow(data, offset = 0, limit = 1000) {
    const source = Array.isArray(data) ? { lines: data } : (data || {})
    const rows = Array.isArray(source.lines)
      ? source.lines
      : (Array.isArray(source.rows) ? source.rows : [])
    let lines = rows.map((row) => {
      if (row == null) return ''
      if (typeof row === 'string' || typeof row === 'number') return String(row)
      if (row.text != null) return String(row.text)
      if (row.content != null) return String(row.content)
      if (row.line != null) return String(row.line)
      return ''
    })

    if (!lines.length && source.content) {
      lines = String(source.content).split('\n')
    }

    const chapter = source.chapter || {}
    const nextOffset = source.nextOffset != null
      ? Number(source.nextOffset)
      : (source.next_offset != null ? Number(source.next_offset) : null)
    const hasNext = source.hasNext != null
      ? !!source.hasNext
      : (source.has_next != null ? !!source.has_next : nextOffset != null)

    return {
      lines,
      offset: Number(source.offset != null ? source.offset : offset || 0),
      limit: Number(source.limit || limit),
      nextOffset,
      hasNext,
      lineCount: Number(chapter.lineCount || chapter.line_count || source.lineCount || source.line_count || 0),
    }
  },

  getPaginationConfig() {
    return {
      charsPerLine: 18,
      maxLinesPerPage: 22, // 调整行数预算，增加单页显示内容，减少底部留白
    }
  },

  isDividerLine(text) {
    return /^[\-_=~·—─]{6,}$/.test(text)
  },

  paginateSourceLines(sourceLines) {
    const { charsPerLine, maxLinesPerPage } = this.getPaginationConfig()
    const contentPages = []
    let currentPage = []
    let consumedLines = 0

    const flushPage = () => {
      if (currentPage.length > 0) {
        contentPages.push({
          type: 'content',
          content: currentPage,
          showChapterEnd: false,
        })
        currentPage = []
        consumedLines = 0
      }
    }

    // 判断全文是否使用了缩进（若超过 5% 的非空行有缩进，即认为使用了缩进）
    let indentCount = 0;
    let validLinesCount = 0;
    for (let i = 0; i < sourceLines.length; i++) {
      const line = String(sourceLines[i] || '').replace(/\r/g, '');
      if (line.trim().length > 0) {
        validLinesCount++;
        if (/^[ \t　]{1,}/.test(line)) indentCount++;
      }
    }
    const usesIndents = validLinesCount > 0 && (indentCount / validLinesCount) > 0.05;

    const paragraphs = [];
    const paraSourceMap = []; // 记录每个合并后的段落对应原始 sourceLines 的范围
    let currentPara = '';
    let paraStartIdx = 0;

    for (let i = 0; i < sourceLines.length; i++) {
      const raw = String(sourceLines[i] || '').replace(/\r/g, '');
      const trimmed = raw.trim();

      if (!trimmed) {
        if (currentPara) { 
          paragraphs.push(currentPara); 
          paraSourceMap.push(i - 1); // 记录当前段落结束的原始索引
          currentPara = ''; 
        }
        continue;
      }
      if (!currentPara) {
        currentPara = trimmed;
        paraStartIdx = i;
        continue;
      }
      
      const hasIndent = /^[ \t　]{1,}/.test(raw);
      if (usesIndents) {
        if (hasIndent) {
          paragraphs.push(currentPara);
          paraSourceMap.push(i - 1);
          currentPara = trimmed;
        } else {
          currentPara += trimmed;
        }
      } else {
        const endsWithPunct = /[。！？；：…”’"」』》】>\])）~—]$/.test(currentPara);
        if (endsWithPunct) {
          paragraphs.push(currentPara);
          paraSourceMap.push(i - 1);
          currentPara = trimmed;
        } else {
          currentPara += trimmed;
        }
      }
    }
    if (currentPara) {
      paragraphs.push(currentPara);
      paraSourceMap.push(sourceLines.length - 1);
    }

    if (!paragraphs.length) {
      paragraphs.push('本章暂无原文内容')
      paraSourceMap.push(0)
    }

    for (let i = 0; i < paragraphs.length; i++) {
      let text = paragraphs[i]
      const sourceIdx = paraSourceMap[i] // 当前段落在原始数据中的结束位置
      const isDivider = this.isDividerLine(text)

      if (isDivider) {
        if (consumedLines + 1 > maxLinesPerPage && currentPage.length > 0) {
          flushPage()
        }
        currentPage.push({
          text,
          progressUnits: 1,
          sourceIdx, // 记录原始索引
          isBlank: false,
          isDivider: true,
          isSplitTop: false,
          isSplitBottom: false,
        })
        consumedLines += 1
        continue
      }

      while (text.length > 0) {
        const availableLines = maxLinesPerPage - consumedLines
        if (availableLines <= 0) {
          flushPage()
          continue
        }

        const totalLinesNeeded = Math.ceil(text.length / charsPerLine)

        if (totalLinesNeeded <= availableLines) {
          currentPage.push({
            text,
            progressUnits: totalLinesNeeded,
            sourceIdx, // 记录原始索引
            isBlank: false,
            isDivider: false,
            isSplitTop: text !== paragraphs[i],
            isSplitBottom: false,
          })
          consumedLines += totalLinesNeeded
          consumedLines += 0.5 // Simulate margin-bottom space
          text = ''
        } else {
          let splitLines = availableLines;
          let remainLines = totalLinesNeeded - splitLines;
          
          if (splitLines < 2) {
            flushPage();
            continue;
          }
          if (remainLines < 2) {
            splitLines -= 1;
            if (splitLines < 2) {
              flushPage();
              continue;
            }
          }

          let maxChars = Math.floor(splitLines * charsPerLine)
          let splitIndex = maxChars
          
          const chunk = text.substring(0, splitIndex)
          currentPage.push({
            text: chunk,
            progressUnits: splitLines,
            sourceIdx, // 记录原始索引
            isBlank: false,
            isDivider: false,
            isSplitTop: text !== paragraphs[i],
            isSplitBottom: true,
          })
          
          consumedLines += splitLines
          text = text.substring(splitIndex)
          flushPage()
        }
      }
    }
    
    flushPage()
    return contentPages
  },

  buildOriginalTextPages(windowData, fromDirection = 'next') {
    const { currentChapterIndex, totalChapters } = this.data
    const lines = windowData && Array.isArray(windowData.lines) ? windowData.lines : []
    const offset = Number((windowData && windowData.offset) || 0)
    const limit = Number((windowData && windowData.limit) || this.data.chapterWindowLimit || 1000)
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

    const sourceLines = lines.length ? lines : ['本章暂无原文内容']
    pages.push(...this.paginateSourceLines(sourceLines))

    if (hasNext && nextOffset != null) {
      pages.push({
        type: 'next-window',
        text: '继续阅读下一页...',
        offset: nextOffset,
      })
    } else {
      const lastContentPage = pages.reduce((lastPage, page) => (
        page.type === 'content' ? page : lastPage
      ), null)
      if (lastContentPage) {
        lastContentPage.showChapterEnd = true
      }

      if (currentChapterIndex < totalChapters - 1) {
        pages.push({ type: 'next-bridge', text: '正在进入下一章...' })
      }
    }

    const firstContentIndex = pages.findIndex(page => page.type === 'content')
    const lastContentIndex = pages.reduce((lastIndex, page, index) => (
      page.type === 'content' ? index : lastIndex
    ), firstContentIndex)
    const startIdx = fromDirection === 'prev' || fromDirection === 'prev-window'
      ? Math.max(0, lastContentIndex)
      : Math.max(0, firstContentIndex)

    this.setData({
      chapterPages: pages,
      chapterWindowOffset: offset,
      chapterWindowLimit: limit,
      chapterWindowNextOffset: nextOffset,
      chapterWindowHasNext: hasNext,
      chapterWindowLineCount: lineCount,
      showFooterBar: true,
      showControls: true,
      loading: false,
      currentPageIndex: startIdx
    }, () => {
      this.updateReadingProgress()
      setTimeout(() => {
        this.setData({ swiperDuration: 300 })
      }, 50)
    })
  },

  getMockText(index) {
    const texts = [
      `第一章：初识 AI 伴读\n\n这是一个风和日丽的下午，我坐在窗前，打开了这款 AI 伴读助手。在这个数字阅读的时代，我们拥有的不仅是文字，更是一个懂你的灵魂伴侣。\n\nAI 伴读助手不仅能为你提供海量的书籍资源，还能根据你的阅读习惯，为你推荐最适合的内容。无论是深奥的哲学著作，还是轻松的言情小说，它都能游刃有余地为你解读。\n\n它的核心逻辑在于“理解”。它不仅仅是识别文字，更是通过深度学习，捕捉每一个章节的情绪起伏，每一个人物的命运脉络。当你读到动情处，它会为你点亮一盏温暖的灯；当你困惑时，它会为你拨开迷雾。\n\n这就是 AI 伴读的魅力。它让阅读不再是一个人的孤岛，而是一场跨越时空的对话。在这个快节奏的社会里，让我们静下心来，与 AI 一起，重新发现文字的力量。\n\n这就是我们的第一章，关于开始，关于希望，也关于科技与人文的完美融合。`,
      `第二章：深度阅读的艺术\n\n什么是深度阅读？在碎片化信息充斥的今天，专注力成为了最稀缺的资源。深度阅读不仅是获取信息，更是一场思维的马拉松。\n\n当你沉浸在一段文字中，你的大脑会构建出一个完整的世界。这个世界里有声音、有气味、有光影。AI 伴读助手在这里扮演的是“领航员”的角色。它不会干扰你的思考，但在你需要的时候，它会提供必要的背景资料，帮助你理解作者的深层意图。\n\n研究表明，每天坚持 30 分钟的深度阅读，可以显著提升一个人的共情能力和逻辑思维。通过 AI 的辅助，我们可以更高效地进入“心流”状态。这种状态下，时间仿佛静止，你与作者的灵魂在纸页间共舞。\n\n在这个章节中，我们将探讨如何利用 AI 提升阅读质量。从划线笔记到思维导图，从语音交互到情绪分析，AI 正在重塑我们的阅读方式。\n\n让我们继续前行，探索阅读的无限可能。`,
      `第三章：钢铁是怎样炼成的\n\n人最宝贵的是生命。生命属于人只有一次。人的一生应当这样度过：当他回首往事的时候，不会因为虚度年华而悔恨，也不会因为碌碌无为而羞愧；在临死的时候，他能够说：“我的整个生命和全部精力，都已经献给了世界上最壮丽的事业——为人类的解放而斗争。”\n\n保尔·柯察金的形象已经成为了整整一代人的精神图腾。在极其艰苦的环境下，他依然保持着对理想的执着追求。这种精神，无论在哪个时代，都具有震撼人心的力量。\n\n在这一章中，我们将通过 AI 的视角，重新解读这部经典名著。看看在现代科技的背景下，我们如何理解英雄主义，如何面对生活中的挫折与磨难。\n\n阅读经典，是为了汲取力量。而 AI，则是那把帮我们开启力量之门的钥匙。`,
    ]
    return texts[index % texts.length]
  },

  mockChapterContent(fromDirection = 'next') {
    const { currentChapterIndex, totalChapters } = this.data
    const fullContent = this.getMockText(currentChapterIndex)

    // --- 模拟行数分页算法 ---
    const pages = []

    // 1. 返回上一章桥接页
    if (currentChapterIndex > 0) {
      pages.push({ type: 'prev-bridge', text: '正在返回上一章...' })
    }

    // 2. 正文分页逻辑
    pages.push(...this.paginateSourceLines(fullContent.split('\n')))

    // 3. 进入下一章桥接页
    if (currentChapterIndex < totalChapters - 1) {
      pages.push({ type: 'next-bridge', text: '正在进入下一章...' })
    }

    let startIdx = 0
    if (fromDirection === 'prev') {
      // 如果是从后往前跳转，目标应该是【最后一页正文】
      startIdx = (currentChapterIndex < totalChapters - 1) ? pages.length - 2 : pages.length - 1
    } else {
      // 如果是从前往后跳转，目标应该是【第一页正文】
      startIdx = (currentChapterIndex > 0) ? 1 : 0
    }

    this.setData({
      chapterPages: pages,
      loading: false,
      currentPageIndex: startIdx
    }, () => {
      this.updateReadingProgress()
      // 数据渲染完成后，恢复滑动动画时长
      setTimeout(() => {
        this.setData({ swiperDuration: 300 })
      }, 50)
    })
  },

  updateReadingProgress() {
    const {
      currentPageIndex,
      chapterPages,
      chapterWindowOffset,
      chapterWindowLineCount,
    } = this.data

    if (!chapterPages || chapterPages.length === 0) return

    const currentPageObj = chapterPages[currentPageIndex]
    if (!currentPageObj) return

    let progress = 0

    // 统一使用段落索引（sourceIdx）来计算进度，解决跨窗口跳变问题
    if (currentPageObj.type === 'content') {
      // 找到当前页中最后一个元素的原始段落索引
      const pageItems = Array.isArray(currentPageObj.content) ? currentPageObj.content : []
      const lastItem = pageItems[pageItems.length - 1]
      const currentParaOffset = lastItem ? (Number(lastItem.sourceIdx) || 0) : 0
      
      const readLines = Number(chapterWindowOffset || 0) + currentParaOffset + 1 // +1 表示已读完该行
      
      progress = chapterWindowLineCount > 0
        ? Math.round(Math.min(1, readLines / chapterWindowLineCount) * 100)
        : 0
    } else if (currentPageObj.type === 'next-window' || currentPageObj.type === 'next-bridge') {
      progress = 100
    } else if (currentPageObj.type === 'prev-window' || currentPageObj.type === 'prev-bridge') {
      progress = 0
    }

    this.setData({
      readingProgress: progress
    }, () => {
      this.saveReadingProgress(progress)
    })
  },

  saveReadingProgress(chapterProgress) {
    const { bookId, currentChapterIndex, totalChapters } = this.data
    if (!bookId || totalChapters <= 0) return

    // 计算全书进度：(已读完章节 + 当前章节内进度) / 总章节
    const bookProgress = Math.min(100, Math.round(((currentChapterIndex + chapterProgress / 100) / totalChapters) * 100))

    const progressData = {
      bookId,
      chapterIndex: currentChapterIndex,
      chapterProgress,
      bookProgress,
      updateTime: Date.now()
    }

    // 保存到本地缓存
    const allProgress = wx.getStorageSync('reading_progress') || {}
    allProgress[bookId] = progressData
    wx.setStorageSync('reading_progress', allProgress)

    // 同时更新全局变量，方便首页即时响应
    const app = getApp()
    if (app.globalData) {
      if (!app.globalData.readingProgress) app.globalData.readingProgress = {}
      app.globalData.readingProgress[bookId] = progressData
    }
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
    const { x } = e.detail
    const screenWidth = wx.getSystemInfoSync().windowWidth
    const third = screenWidth / 3

    if (x >= third && x <= third * 2) {
      // 点击中间 1/3：切换工具栏显示（同时控制上下）
      const nextShow = !this.data.showControls
      this.setData({
        showControls: nextShow,
        showFooterBar: nextShow,
      }, () => {
        if (nextShow) {
          this.scheduleFooterAutoHide()
        } else {
          this.clearFooterAutoHideTimer()
        }
      })
      return
    }

    // 点击两侧：执行翻页
    if (x < third) {
      // 上一页
      if (this.data.currentPageIndex > 0) {
        this.goToPage(this.data.currentPageIndex - 1)
      } else {
        this.handlePrevChapter()
      }
    } else {
      // 下一页
      if (this.data.currentPageIndex < this.data.chapterPages.length - 1) {
        this.goToPage(this.data.currentPageIndex + 1)
      } else {
        this.handleNextChapter()
      }
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
    const currentChapter = this.data.allChapters[this.data.currentChapterIndex]
    const chapterId = currentChapter ? currentChapter.id : ''
    const chapterTitle = currentChapter ? currentChapter.title : ''
    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${this.data.bookId}&chapterId=${chapterId}&chapterTitle=${encodeURIComponent(chapterTitle)}&initialText=${encodeURIComponent(text)}`,
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
    const currentChapter = this.data.allChapters[this.data.currentChapterIndex]
    const chapterId = currentChapter ? currentChapter.id : ''
    
    // 获取当前页的文本内容作为二创上下文
    let pageText = ''
    if (this.data.chapterPages && this.data.chapterPages[this.data.currentPageIndex]) {
      pageText = this.data.chapterPages[this.data.currentPageIndex]
    }

    // 将当前页内容存入全局或通过 URL 编码传递
    // 考虑到文本可能较长，使用全局存储或在跳转时仅传递简短信息，对话页再通过 bookId/chapterId 补偿
    const app = getApp()
    app.globalData.lastReadContext = pageText

    wx.navigateTo({
      url: `/pages/chat/chat?bookId=${this.data.bookId}&chapterId=${chapterId}&chapterTitle=${encodeURIComponent(currentChapter ? currentChapter.title : '')}`,
    })
  }
})
