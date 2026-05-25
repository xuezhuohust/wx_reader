const api = require('../../utils/api')

Page({
  data: {
    book: null,
    messages: [],
    inputValue: '',
    inputLineCount: 1,
    isInputExpanded: false,
    composerPlaceholderRpx: 240,
    loadingReply: false,
    scrollTop: 0,
    scrollWithAnimation: true,
    quickQuestions: ['总结这本书', '这本书适合谁读', '提炼三个核心观点', '帮我解释第一章'],
    playingMessageId: '',
    audioLoadingMessageId: '',
    isRecording: false,
    inputMode: 'keyboard', // 'keyboard' or 'voice'
    keyboardHeight: 0,
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    scrolled: false,
    showPrivacyModal: false,
    userHasScrolledUp: false,
    showScrollDownBtn: false,
    // 2026-05-19 新增：对话列表支持
    conversations: [],
    currentConversationId: '',
    currentConversationTitle: '新对话',
    showConversationList: false,
  },

  onLoad(options) {
    const app = getApp()
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
    })
    this.bookId = options.bookId
    this.messageSeed = 0
    this.audioContext = null
    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false
    this.ignoreNextStopEvent = false
    this.audioQueue = []        // {messageId, text} 待生成
    this.readyMap = {}          // seq -> {messageId, audioUrl} 已生成
    this.nextPlaySeq = 0       // 下一个该播放的序号
    this.nextGenSeq = 0        // 下一个生成的序号
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    this.pendingPrivacyAction = null
    this.lastScrollToBottomTime = 0
    this._scrollTailTimer = null
    // 流式输出过快时，先把回复暂存在实例变量中，再定时批量刷新视图层。
    this._streamFlushTimer = null
    this._autoScrollTimer = null
    this._pendingStreamReply = ''
    this._lastFlushedStreamReply = ''
    this._streamingMessageIndex = -1
    this._streamingMessageId = ''
    // 使用 scroll-top 累加触发到底部，避免高频 scroll-into-view 抢占用户手势。
    this._scrollTop = 0
    this._userTouchingChat = false
    this.initRecorder()
    // 2026-05-19: 改为加载书籍 + 对话列表 + 历史消息
    this.initialized = false
    this.loadBookAndConversations()
  },

  showPrivacyPopup() {
    this.setData({ showPrivacyModal: true })
  },

  handleAgreePrivacy(event) {
    wx.setStorageSync('privacy_agreed', true)
    wx.setStorageSync('privacy_authorized_by_button', true)
    this.setData({ showPrivacyModal: false })
    getApp().resolvePrivacy(true, event)
    const action = this.pendingPrivacyAction
    this.pendingPrivacyAction = null
    if (typeof action === 'function') {
      action()
    }
  },

  handleDisagreePrivacy(event) {
    this.pendingPrivacyAction = null
    this.setData({ showPrivacyModal: false })
    getApp().resolvePrivacy(false, event)
  },

  initRecorder() {
    this.recorderManager = wx.getRecorderManager()
    this.recorderManager.onStart(() => {
      console.log('recorder start')
      this.setData({ isRecording: true })
    })
    this.recorderManager.onStop((res) => {
      console.log('recorder stop', res)
      this.setData({ isRecording: false })
      const { tempFilePath } = res
      this.handleVoiceUpload(tempFilePath)
    })
    this.recorderManager.onError((err) => {
      console.error('recorder error', err)
      this.setData({ isRecording: false })
      wx.showToast({ title: '录音失败', icon: 'none' })
    })
  },

  handleToggleInputMode() {
    this.setData({
      inputMode: this.data.inputMode === 'keyboard' ? 'voice' : 'keyboard',
    })
  },

  handleVoiceTap() {
    if (this.data.isRecording) {
      this.recorderManager.stop()
      return
    }

    wx.vibrateShort()
    if (!wx.getStorageSync('privacy_authorized_by_button')) {
      this.requestPrivacyAuthorization(() => {
        this.startRecording()
      })
      return
    }
    this.startRecording()
  },

  requestPrivacyAuthorization(next) {
    this.pendingPrivacyAction = next
    this.showPrivacyPopup()
  },

  startRecording() {
    this.setData({ isRecording: true })
    this.recorderManager.start({
      duration: 60000,
      sampleRate: 16000,
      numberOfChannels: 1,
      encodeBitRate: 48000,
      format: 'mp3',
    })
  },

  handleStopPropagation() {},

  handleVoiceUpload(filePath) {
    wx.showLoading({ title: '正在识别...', mask: true })
    api.speechToText(filePath)
      .then((text) => {
        wx.hideLoading()
        if (text) {
          this.sendMessage(text)
        }
      })
      .catch((err) => {
        wx.hideLoading()
        wx.showToast({
          title: err.message || '识别失败',
          icon: 'none',
        })
      })
  },

  onUnload() {
    clearTimeout(this._scrollTailTimer)
    clearTimeout(this._streamFlushTimer)
    clearTimeout(this._autoScrollTimer)
    this.destroyAudioContext()
  },

  createMessage(role, content, loading) {
    this.messageSeed += 1
    return {
      id: `msg-${this.messageSeed}`,
      role,
      content,
      loading: !!loading,
    }
  },

  // ====================================================================
  // 2026-05-19: 重写加载逻辑，支持多对话
  // ====================================================================

  loadBookAndConversations() {
    /* 加载书籍信息 + 对话列表 + 最近对话的消息 */
    api.getBookById(this.bookId)
      .then((book) => {
        this.setData({ book })
        return this.loadConversations(book)
      })
      .catch((error) => {
        console.error('loadChatBook failed:', error)
        wx.showToast({
          title: '加载书籍失败',
          icon: 'none',
        })
      })
  },

  loadConversations(book) {
    /* 加载对话列表，自动选中最近活跃的对话或新建一个 */
    const bookTitle = book && book.title ? book.title : ''
    return api.listConversations(this.bookId)
      .then((convs) => {
        if (convs && convs.length > 0) {
          // 有已有对话 → 选中最近更新的一个
          const latest = convs[0]
          this.setData({
            conversations: convs,
            currentConversationId: latest.id,
            currentConversationTitle: latest.title,
          })
          return this.loadMessages(latest.id, bookTitle)
        }
        // 没有对话 → 自动新建一个
        return this.createAndSelectConversation(bookTitle)
      })
      .catch((error) => {
        console.error('loadConversations failed:', error)
        // 降级：显示欢迎消息
        const welcomeMessage = this.createMessage(
          'ai',
          `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
        )
        this.setData({
          messages: [welcomeMessage],
        }, () => {
          this.scrollToBottom(true)
        })
      })
  },

  loadMessages(conversationId, bookTitle) {
    /* 加载指定对话的历史消息 */
    return api.getConversationMessages(conversationId)
      .then((messages) => {
        const formatted = messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          loading: false,
        }))
        if (formatted.length === 0) {
          // 空对话 → 显示欢迎消息
          const welcomeMessage = this.createMessage(
            'ai',
            `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
          )
          formatted.push(welcomeMessage)
        }
        this.setData({
          messages: formatted,
        }, () => {
          this.scrollToBottom(true)
        })
        this.initialized = true
      })
      .catch((error) => {
        console.error('loadMessages failed:', error)
        const welcomeMessage = this.createMessage(
          'ai',
          `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
        )
        this.setData({
          messages: [welcomeMessage],
        }, () => {
          this.scrollToBottom(true)
        })
        this.initialized = true
      })
  },

  createAndSelectConversation(bookTitle) {
    /* 创建新对话并选中 */
    return api.createConversation(this.bookId)
      .then((conv) => {
        this.setData({
          conversations: [conv],
          currentConversationId: conv.id,
          currentConversationTitle: conv.title,
        })
        const welcomeMessage = this.createMessage(
          'ai',
          `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
        )
        this.setData({
          messages: [welcomeMessage],
        }, () => {
          this.scrollToBottom(true)
        })
        this.initialized = true
      })
  },

  handleBack() {
    wx.navigateBack({
      fail: () => {
        wx.switchTab({
          url: '/pages/index/index',
        })
      }
    })
  },

  // ====================================================================
  // 对话切换 (2026-05-19 新增)
  // ====================================================================

  handleToggleConversationList() {
    /* 展开/收起对话切换面板 */
    this.setData({
      showConversationList: !this.data.showConversationList,
    })
  },

  handleNewConversation() {
    /* 新建对话并切换到新对话 */
    if (this.data.loadingReply) {
      return
    }
    this.resetAudioPlayback()
    const book = this.data.book
    const bookTitle = book && book.title ? book.title : ''
    wx.showLoading({ title: '创建中...', mask: true })
    this.createAndSelectConversation(bookTitle)
      .then(() => {
        wx.hideLoading()
        this.setData({ showConversationList: false })
      })
      .catch((err) => {
        wx.hideLoading()
        console.error('handleNewConversation failed:', err)
        wx.showToast({ title: err.message || '创建对话失败', icon: 'none' })
      })
  },

  handleClearConversations() {
    if (this.data.loadingReply) {
      return
    }
    wx.showModal({
      title: '清空对话',
      content: '将删除这本书的全部对话记录，并重置对应的 AI 会话。此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#d64545',
      success: (res) => {
        if (!res.confirm) {
          return
        }
        const book = this.data.book
        const bookTitle = book && book.title ? book.title : ''
        this.resetAudioPlayback()
        wx.showLoading({ title: '清空中...', mask: true })
        api.clearConversations(this.bookId)
          .then(() => this.createAndSelectConversation(bookTitle))
          .then(() => {
            wx.hideLoading()
            this.setData({ showConversationList: false })
            wx.showToast({ title: '已清空', icon: 'success' })
          })
          .catch((err) => {
            wx.hideLoading()
            console.error('handleClearConversations failed:', err)
            wx.showToast({ title: err.message || '清空失败', icon: 'none' })
          })
      },
    })
  },

  handleSwitchConversation(event) {
    /* 切换到指定的对话 */
    if (this.data.loadingReply) {
      return
    }
    const convId = event.currentTarget.dataset.id
    const convTitle = event.currentTarget.dataset.title || '新对话'
    if (convId === this.data.currentConversationId) {
      // 已在当前对话，收起面板
      this.setData({ showConversationList: false })
      return
    }
    // 切换对话时重置音频状态
    this.resetAudioPlayback()
    const book = this.data.book
    const bookTitle = book && book.title ? book.title : ''
    this.setData({
      currentConversationId: convId,
      currentConversationTitle: convTitle,
      showConversationList: false,
      messages: [],
    })

    api.getConversationMessages(convId)
      .then((messages) => {
        const formatted = messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          loading: false,
        }))
        if (formatted.length === 0) {
          const welcomeMessage = this.createMessage(
            'ai',
            `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
          )
          formatted.push(welcomeMessage)
        }
        this.setData({
          messages: formatted,
        }, () => {
          this.scrollToBottom(true)
        })
      })
      .catch((error) => {
        console.error('switch conversation failed:', error)
        const welcomeMessage = this.createMessage(
          'ai',
          `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
        )
        this.setData({
          messages: [welcomeMessage],
        }, () => {
          this.scrollToBottom(true)
        })
      })
  },

  handleScroll(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.detail
    const isScrolled = scrollTop > 20

    // 判断 user 是否主动上滑离开了底部（阈值 80rpx）
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const userScrolledUp = distanceFromBottom > 80
    // 流式输出造成的程序滚动也会触发 bindscroll，这里只在用户触摸或非流式状态下更新用户滚动状态。
    const shouldTrackUserScroll = this._userTouchingChat || !this.data.loadingReply
    if (shouldTrackUserScroll && userScrolledUp !== this.data.userHasScrolledUp) {
      this.setData({
        userHasScrolledUp: userScrolledUp,
        showScrollDownBtn: userScrolledUp && this.data.loadingReply,
      })
    }
    if (isScrolled !== this.data.scrolled) {
      this.setData({ scrolled: isScrolled })
    }
  },

  handleChatTouchStart() {
    // 用户开始拖动消息区时暂停自动跟随，避免新 token 把页面强行拉回底部。
    this._userTouchingChat = true
  },

  handleChatTouchEnd() {
    // 等滚动惯性基本结束后再恢复自动跟随判断，减少触摸结束瞬间的误判。
    setTimeout(() => {
      this._userTouchingChat = false
      if (this.data.loadingReply && !this.data.userHasScrolledUp) {
        this.scheduleAutoScroll()
      }
    }, 160)
  },

  handleInput(event) {
    this.setData(this.buildComposerState({
      inputValue: event.detail.value,
    }))
  },

  handleQuickQuestion(event) {
    const question = event.currentTarget.dataset.question
    this.sendMessage(question)
  },

  handleSend() {
    this.sendMessage(this.data.inputValue)
  },

  normalizeInputLineCount(lineCount) {
    const nextCount = Number(lineCount || 1)
    if (!Number.isFinite(nextCount) || nextCount < 1) {
      return 1
    }
    return Math.min(nextCount, 5)
  },

  buildComposerState(overrides) {
    const nextInputValue = Object.prototype.hasOwnProperty.call(overrides || {}, 'inputValue')
      ? overrides.inputValue
      : this.data.inputValue
    const nextKeyboardHeight = Object.prototype.hasOwnProperty.call(overrides || {}, 'keyboardHeight')
      ? overrides.keyboardHeight
      : this.data.keyboardHeight
    const nextInputLineCount = this.normalizeInputLineCount(
      Object.prototype.hasOwnProperty.call(overrides || {}, 'inputLineCount')
        ? overrides.inputLineCount
        : this.data.inputLineCount
    )
    const shouldShowQuickQueries = !String(nextInputValue || '').trim() && nextKeyboardHeight === 0
    const composerPlaceholderRpx = (shouldShowQuickQueries ? 240 : 156) + Math.max(0, nextInputLineCount - 1) * 44

    return Object.assign({}, overrides || {}, {
      inputLineCount: nextInputLineCount,
      isInputExpanded: nextInputLineCount > 1,
      composerPlaceholderRpx,
    })
  },

  handleKeyboardHeightChange(event) {
    const keyboardHeight = Math.max(0, Number(event.detail.height || 0))
    this.setData(this.buildComposerState({
      keyboardHeight,
    }), () => {
      if (keyboardHeight > 0) {
        this.scrollToBottom()
      }
    })
  },

  handleInputLineChange(event) {
    const lineCount = event && event.detail ? event.detail.lineCount : 1
    this.setData(this.buildComposerState({
      inputLineCount: lineCount,
    }), () => {
      if (this.data.isInputExpanded) {
        this.scrollToBottom()
      }
    })
  },

  handleInputBlur() {
    if (!this.data.keyboardHeight) {
      return
    }

    this.setData(this.buildComposerState({
      keyboardHeight: 0,
    }))
  },

  ensureAudioContext() {
    if (this.audioContext) {
      return this.audioContext
    }

    const audio = wx.createInnerAudioContext()
    audio.autoplay = false
    audio.obeyMuteSwitch = false

    audio.onPlay(() => {
      this.isAudioPlaying = true
      this.currentAudioStartedAt = Date.now()
      this.setData({
        playingMessageId: this.currentAudioMessageId,
        audioLoadingMessageId: '',
      })
    })

    audio.onEnded(() => {
      this.finishCurrentAudio(true)
    })

    audio.onStop(() => {
      if (this.ignoreNextStopEvent) {
        this.ignoreNextStopEvent = false
        return
      }
      this.finishCurrentAudio(false)
    })

    audio.onPause(() => {
      this.finishCurrentAudio(false)
    })

    audio.onError((error) => {
      console.error('[chat] audio error', error)
      this.finishCurrentAudio(false)
      wx.showToast({
        title: '语音播放失败',
        icon: 'none',
      })
    })

    this.audioContext = audio
    return audio
  },

  finishCurrentAudio(reportMetrics) {
    const duration = this.currentAudioStartedAt ? Date.now() - this.currentAudioStartedAt : 0
    const finishedMessageId = this.currentAudioMessageId

    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false

    // 如果还有待播放的段或正在生成的段，保持 loading 状态不变
    const hasMore = this.generatingCount > 0 || this.readyMap.hasOwnProperty(this.nextPlaySeq)
    if (!hasMore) {
      this.setData({ playingMessageId: '', audioLoadingMessageId: '' })
    }

    if (reportMetrics && duration > 0) {
      api.reportVoicePlay(duration)
    }

    if (finishedMessageId) {
      console.info('[chat] audio finished', finishedMessageId)
    }

    this.playNextIfIdle()
  },

  destroyAudioContext() {
    if (!this.audioContext) {
      return
    }
    this.ignoreNextStopEvent = true
    this.audioContext.stop()
    this.audioContext.destroy()
    this.audioContext = null
    this.resetAudioState()
  },

  resetAudioState() {
    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false
    this.audioQueue = []
    this.readyMap = {}
    this.nextPlaySeq = 0
    this.nextGenSeq = 0
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    this.setData({
      playingMessageId: '',
      audioLoadingMessageId: '',
    })
  },

  resetAudioPlayback() {
    this.audioQueue = []
    this.readyMap = {}
    this.nextPlaySeq = 0
    this.nextGenSeq = 0
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    if (this.audioContext && (this.isAudioPlaying || this.currentAudioMessageId)) {
      this.ignoreNextStopEvent = true
      this.audioContext.stop()
    }
    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false
    this.setData({
      playingMessageId: '',
      audioLoadingMessageId: '',
    })
  },

  shouldFlushSpeechBuffer(text, force) {
    const content = String(text || '').trim()
    if (!content) {
      return false
    }
    if (force) {
      return true
    }

    const punctuationCount = (content.match(/[。！？!?]/g) || []).length
    // 遇到句末标点就切（一句一段，更流畅）
    if (punctuationCount >= 1 && content.length >= 10) {
      return true
    }
    // 硬上限 80 字
    if (content.length >= 80) {
      return true
    }
    return false
  },

  appendSpeechSegment(messageId, segment, force) {
    const content = String(segment || '').trim()
    if (!content) {
      return
    }

    this.streamSpeechBuffer = `${this.streamSpeechBuffer}${content}`
    if (!this.shouldFlushSpeechBuffer(this.streamSpeechBuffer, !!force)) {
      return
    }

    const nextChunk = this.streamSpeechBuffer.trim()
    this.streamSpeechBuffer = ''
    if (nextChunk) {
      this.enqueueAudioChunk(messageId, nextChunk)
    }
  },

  flushSpeechBuffer(messageId) {
    const nextChunk = String(this.streamSpeechBuffer || '').trim()
    this.streamSpeechBuffer = ''
    if (nextChunk) {
      this.enqueueAudioChunk(messageId, nextChunk)
    }
  },

  enqueueAudioChunk(messageId, text) {
    const content = String(text || '').trim()
    if (!content) {
      return
    }

    // 分配序号，立即开始生成
    const seq = this.nextGenSeq
    this.nextGenSeq += 1
    this.generateAudio(seq, messageId, content)
  },

  generateAudio(seq, messageId, text) {
    this.generatingCount += 1
    this.setData({ audioLoadingMessageId: messageId })

    api.requestSpeech(text)
      .then(({ audioUrl }) => {
        this.generatingCount -= 1
        // 按序号存入 readyMap
        this.readyMap[seq] = { messageId, audioUrl }
        this.playNextIfIdle()
      })
      .catch((error) => {
        console.error('[chat] requestSpeech failed', error)
        this.generatingCount -= 1
        // 跳过失败的段，推进序号
        this.readyMap[seq] = null
        this.playNextIfIdle()
      })
  },

  playNextIfIdle() {
    if (this.isAudioPlaying) {
      return
    }

    // 跳过失败的段（null）
    while (this.readyMap.hasOwnProperty(this.nextPlaySeq) && this.readyMap[this.nextPlaySeq] === null) {
      delete this.readyMap[this.nextPlaySeq]
      this.nextPlaySeq += 1
    }

    const next = this.readyMap[this.nextPlaySeq]
    if (!next) {
      // 下一段还没生成好，等它回来再播
      if (this.generatingCount === 0) {
        this.setData({ audioLoadingMessageId: '' })
      }
      return
    }

    delete this.readyMap[this.nextPlaySeq]
    this.nextPlaySeq += 1

    const audio = this.ensureAudioContext()
    this.currentAudioMessageId = next.messageId
    this.setData({
      playingMessageId: next.messageId,
      audioLoadingMessageId: this.generatingCount > 0 ? next.messageId : '',
    })
    audio.src = next.audioUrl
    audio.play()
  },

  processAudioQueue() {
    this.playNextIfIdle()
  },

  handleSpeakMessage(event) {
    const { id, content, loading } = event.currentTarget.dataset
    if (!id || !content || loading) {
      return
    }

    if (this.data.playingMessageId === id || this.data.audioLoadingMessageId === id) {
      this.resetAudioPlayback()
      return
    }

    this.resetAudioPlayback()
    this.enqueueAudioChunk(id, content)
  },

  sendMessage(rawText) {
    const message = String(rawText || '').trim()
    if (!message) {
      wx.showToast({
        title: '请输入问题',
        icon: 'none',
      })
      return
    }
    if (this.data.loadingReply) {
      return
    }

    this.resetAudioPlayback()

    // 文本输入和语音识别最终都走此入口；仅给 AI 请求附加精简要求，不改变用户看到和保存的问题原文。
    const aiMessage = `${message}\n回复精简`
    const userMessage = this.createMessage('user', message)
    const loadingMessage = this.createMessage('ai', 'AI 正在思考...', true)
    const messages = this.data.messages.concat([userMessage, loadingMessage])
    // 记录本轮流式回复所在的消息，后续只更新这一条，避免每个 token 重建整个 messages 数组。
    this._streamingMessageIndex = messages.length - 1
    this._streamingMessageId = loadingMessage.id
    this._pendingStreamReply = ''
    this._lastFlushedStreamReply = ''
    clearTimeout(this._streamFlushTimer)
    clearTimeout(this._autoScrollTimer)

    this.setData(Object.assign({
      messages,
      loadingReply: true,
      // 流式期间关闭滚动动画，防止动画被高频重启导致页面卡住或抢滚动。
      scrollWithAnimation: false,
      userHasScrolledUp: false,
      showScrollDownBtn: false,
    }, this.buildComposerState({
      inputValue: '',
      inputLineCount: 1,
    })), () => {
      this.scrollToBottom(true)
    })

    const convId = this.data.currentConversationId
    const chatBookId = (this.data.book && (this.data.book.bookKey || this.data.book.id)) || this.bookId
    api.sendBookChatMessageStream(chatBookId, aiMessage, {
      conversationId: convId,
      onSegment: (segment, fullReply) => {
        // onChunkReceived 可能一次解析出很多 token，这里只保留最新完整回复，交给定时器合并刷新。
        this._pendingStreamReply = fullReply
        this.scheduleStreamFlush()

        // 自动 TTS 暂时关闭：保留文字流式输出，避免回复过程中并发请求 /api/tts。
        // this.appendSpeechSegment(loadingMessage.id, segment, false)
      },
    })
      .then((result) => {
        // 自动 TTS 暂时关闭：不在回答结束时补发剩余语音片段。
        // this.flushSpeechBuffer(loadingMessage.id)
        const finalReply = result.reply || ''
        this._pendingStreamReply = finalReply
        this.flushStreamReply(true)
        this.setData({
          loadingReply: false,
          scrollWithAnimation: true,
        }, () => {
          this.clearStreamState()
          if (!this.data.userHasScrolledUp) {
            this.scrollToBottom()
          }
        })

        if (convId && finalReply) {
          api.appendConversationMessages(convId, [
            { role: 'user', content: message },
            { role: 'ai', content: finalReply },
          ]).catch((error) => {
            console.warn('appendConversationMessages failed:', error)
          })
        }
      })
      .catch(() => {
        this.streamSpeechBuffer = ''
        const failedContent = this._pendingStreamReply || '暂时无法获取回答，请稍后重试。'
        this._pendingStreamReply = failedContent
        this.flushStreamReply(true)
        this.setData({
          loadingReply: false,
          scrollWithAnimation: true,
          audioLoadingMessageId: '',
        }, () => {
          this.clearStreamState()
          if (!this.data.userHasScrolledUp) {
            this.scrollToBottom()
          }
        })
      })
  },

  scheduleStreamFlush() {
    // 同一时间只允许一个刷新定时器，把多个 token 合并成一次 setData。
    if (this._streamFlushTimer) {
      return
    }
    this._streamFlushTimer = setTimeout(() => {
      this.flushStreamReply()
    }, 80)
  },

  flushStreamReply(force = false) {
    clearTimeout(this._streamFlushTimer)
    this._streamFlushTimer = null

    const content = String(this._pendingStreamReply || '')
    if (!force && content === this._lastFlushedStreamReply) {
      return
    }

    let messageIndex = this._streamingMessageIndex
    const target = this.data.messages[messageIndex]
    if (!target || target.id !== this._streamingMessageId) {
      messageIndex = this.data.messages.findIndex((item) => item.id === this._streamingMessageId)
      this._streamingMessageIndex = messageIndex
    }
    if (messageIndex < 0) {
      return
    }

    this._lastFlushedStreamReply = content
    // 只更新最后一条 AI 消息的字段，降低小程序 JS 层到视图层的数据传输量。
    this.setData({
      [`messages[${messageIndex}].content`]: content,
      [`messages[${messageIndex}].loading`]: false,
    }, () => {
      this.scheduleAutoScroll()
    })
  },

  clearStreamState() {
    // 本轮回答结束后清掉所有流式定时器和临时状态，避免影响下一轮提问。
    clearTimeout(this._streamFlushTimer)
    clearTimeout(this._autoScrollTimer)
    clearTimeout(this._scrollTailTimer)
    this._streamFlushTimer = null
    this._autoScrollTimer = null
    this._scrollTailTimer = null
    this._pendingStreamReply = ''
    this._lastFlushedStreamReply = ''
    this._streamingMessageIndex = -1
    this._streamingMessageId = ''
  },

  scheduleAutoScroll() {
    // 用户正在查看上方内容时不自动跟随，只显示“新内容”按钮。
    if (this.data.userHasScrolledUp || this._userTouchingChat) {
      return
    }
    if (this._autoScrollTimer) {
      return
    }
    this._autoScrollTimer = setTimeout(() => {
      this._autoScrollTimer = null
      this.scrollToBottom()
    }, 160)
  },

  scrollToBottom(force = false) {
    // force: 强制滚动（用户点击按钮、流式结束）
    // 非强制时，用户正在上滑查看则不打断
    if (!force && (this.data.userHasScrolledUp || this._userTouchingChat)) {
      return
    }

    // 流式期间节流：最多 120ms 滚一次
    const now = Date.now()
    if (!force && this.data.loadingReply && now - this.lastScrollToBottomTime < 120) {
      return
    }
    this.lastScrollToBottomTime = now

    if (!this.data.messages.length) {
      return
    }
    // scroll-top 绑定相同值时不会触发滚动，递增一个足够大的值来稳定滚到底部。
    this._scrollTop += 100000
    this.setData({
      scrollTop: this._scrollTop,
    })
  },

  handleScrollDownTap() {
    this.setData({
      userHasScrolledUp: false,
      showScrollDownBtn: false,
    })
    this.scrollToBottom(true)
  },

  _resetScrollState() {
    clearTimeout(this._scrollTailTimer)
    clearTimeout(this._autoScrollTimer)
    this._scrollTailTimer = null
    this._autoScrollTimer = null
    this.lastScrollToBottomTime = 0
    this.setData({
      userHasScrolledUp: false,
      showScrollDownBtn: false,
    })
  },
})
