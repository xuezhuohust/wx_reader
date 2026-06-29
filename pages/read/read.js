const api = require('../../utils/api')

Page({
  data: {
    bookId: '',
    book: null,
    currentChapterIndex: 0,
    currentPageIndex: 0,
    currentChapterName: '',
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

  loadBookData(id) {
    api.getBookById(id).then(book => {
      const chapters = Array.isArray(book.chapters) ? book.chapters : (Array.isArray(book.catalog) ? book.catalog : (Array.isArray(book.sections) ? book.sections : []))
      
      // 确保章节名称是字符串
      const processedChapters = chapters.map((c, i) => {
        if (typeof c === 'string') return c
        if (c && c.title) return c.title
        return `第 ${i + 1} 章`
      })

      this.setData({
        book,
        totalChapters: processedChapters.length,
        allChapterNames: processedChapters,
      })
      this.loadChapterContent()
    }).catch(err => {
      console.error('加载书籍失败:', err)
      wx.showToast({ title: '加载书籍失败', icon: 'none' })
    })
  },

  loadChapterContent(fromDirection = 'next') {
    const { currentChapterIndex, allChapterNames } = this.data
    const chapterName = allChapterNames[currentChapterIndex] || `第 ${currentChapterIndex + 1} 章`
    
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
    }, 100)
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
    const CHARS_PER_LINE = 18 
    const LINES_PER_PAGE = 27 
    const paragraphs = fullContent.split('\n')
    
    let currentPage = []
    let currentLines = 0
    
    paragraphs.forEach(p => {
      if (!p.trim()) return
      const pLines = Math.ceil(p.length / CHARS_PER_LINE) + 1
      
      if (currentLines + pLines > LINES_PER_PAGE && currentPage.length > 0) {
        pages.push({ type: 'content', content: currentPage })
        currentPage = []
        currentLines = 0
      }
      
      currentPage.push(p)
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
      // 如果是从后往前跳转，目标应该是【最后一页正文】
      // 如果有 next-bridge，最后一页正文索引是 pages.length - 2
      // 如果没有 next-bridge（即最后一章），最后一页正文索引是 pages.length - 1
      startIdx = (currentChapterIndex < totalChapters - 1) ? pages.length - 2 : pages.length - 1
    } else {
      // 如果是从前往后跳转，目标应该是【第一页正文】
      // 如果有 prev-bridge，第一页正文索引是 1
      // 如果没有 prev-bridge（即第一章），第一页正文索引是 0
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

  getMockText(index) {
    const mockData = {
      0: `青春是一场谎言、一种罪恶。
歌颂青春者往往欺骗自己与周遭的人。正面看待自身所处环境之一切。
就算犯下什么滔天大错，他们也视之为青春的象征，刻划为记忆中的一页。
举例来说，若是他们犯下偷窃，参加暴走族等罪行，便说那是「年少轻狂」；如果考试不及格，就辩称学校不是死读书的地方。
只要举着青春的大旗，不管再稀松平常的道理还是社会观念，他们都有办法曲解。对他们而言，谎言、秘密、罪过，甚至是失败，都不过是青春的调味料罢了。
再者，他们能从那些罪恶、那些失败中找出特殊之处。
因此，他们一切的失败都算是青春的一部分。
可是，别人的失败不能算是青春，而是单纯的失败。
如果说失败是青春的象征，交不到朋友的人，不就处于青春的最高峰吗？
然而，他们不会这么认为吧。
说穿了，他们只挑对自己有利的解释。
那样已经算是欺骗吧？
不论是说谎、欺骗、隐瞒还是诈欺，都必须受到谴责。
他们是罪恶的。
反过来说，不歌颂青春的人才是真正的正义。
结论就是：现实充通通给我爆炸吧！`,
      1: `国文老师平冢静额头冒着青筋，大声念出我的作文。
自己听过一遍，才发现文笔还有待琢磨。我觉得自己像是被看穿投机想法的无名作家，以为用些难一点的词汇，便会显得比较聪明。
所以，是这篇不成熟的文章害我被叫过来吗？
不，当然不是，我对此心知肚明。
平冢老师念完作文后，按住额头深深叹一口气。
「比企谷啊，你还记得我上课出的作文题目是什么吗？」
「……记得,是『高中生活回顾』。」
「没错。那你交一张犯罪宣言做什么？你是恐怖分子还是笨蛋？」
平冢老师又叹一小口气，像是伤透脑筋似地撩起头发。
这样说来，「女教师」三个字念成「Onnna-KYOUSHI」，比念成「JYO-KYOUSHI」还来得性感。
一想到这里，我忍不住露出贼笑，下一秒一整叠纸马上敲下来。
「给我认真听。」
「是。」
「你的眼睛很像腐坏的鱼呢。」
「DHA很丰富吗？听起来满聪明的。」`,
      2: `千叶市立总武高中的校舍形状有点特殊。
若从高空往下看，校舍的形状像汉字的「口」。下方再多个多媒体大楼，就成为这所学校的鸟瞰图。
通路两侧分别是教室大楼 and 特别大楼，两栋大楼的二楼有走廊互相连通，形成一个四角形。
被四角形校舍围在中间的空地，便是广大现实充的圣地——中庭。
午休时间一到，他们会男女一同来到中庭享用午餐，再打打羽毛球帮助消化；放学后的黄昏时光，他们则以校舍为背景在此谈情说爱、吹海风看星星。
简直是欺人太甚！
就旁观者看来，这些人像在努力演一出青春偶像剧，真是让人心寒，而我扮演的则是「树」那样的角色。
平冢老师在打过蜡的地板留下「喀、喀」的脚步声，她要去的地方似乎是特别大楼。
——我有种不好的预感。`
    }
    
    if (mockData[index]) {
      return mockData[index]
    }

    // 后续章节显示后端未开发的提示
    return `温馨提示：后端功能暂未完全开发
    
您目前正在阅读的是《${this.data.book.title}》的第 ${index + 1} 章。

由于后端 API 接口（/api/books/{id}/chapters/{index}）目前仅处于 Mock 调试阶段，系统仅为您准备了前三章的精彩内容作为前端交互演示。

从第四章开始的内容需要连接正式版后端服务方可展示。

如果您是开发人员，请在 \`utils/api.js\` 中检查接口连接状态。

感谢您的理解与支持。`
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
    const { index } = e.currentTarget.dataset
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
