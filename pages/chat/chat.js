const api = require('../../utils/api')
const { loadIdentity } = require('../../utils/storage')

Page({
  data: {
    book: null,
    identity: null,
    userAvatarText: '我',
    messages: [],
    loadingMessages: true, // 新增：控制骨架屏显示
    inputValue: '',
    inputLineCount: 1,
    isInputExpanded: false,
    composerPlaceholderRpx: 240,
    loadingReply: false,
    scrollTop: 0,
    scrollWithAnimation: true,
    entry: 'chat',
    scene: 'chat',
    sceneTitle: '智能伴读',
    quickQuestions: ['总结这本书', '这本书适合谁读', '提炼三个核心观点', '帮我解释第一章'],
    playingMessageId: '',
    audioLoadingMessageId: '',
    isRecording: false,
    voiceCancel: false,
    inputMode: 'keyboard', // 'keyboard' or 'voice'
    keyboardHeight: 0,
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    scrolled: false,
    showPrivacyModal: false,
    privacyModalTitle: '隐私授权说明',
    privacyModalText: '语音对话需要使用录音权限。请先同意隐私授权，再点击录音。',
    userHasScrolledUp: false,
    showScrollDownBtn: false,
    // 2026-05-19 新增：对话列表支持
    conversations: [],
    currentConversationId: '',
    currentConversationTitle: '新对话',
    showConversationList: false,
    // 2026-07-02 新增：背景图支持
    backgroundImage: '',
    chapterId: '',
  },

  onLoad(options) {
    const app = getApp()
    const entry = this.normalizeEntry((options && (options.entry || options.entrance || options.scene || options.mode)) || 'chat')
    const scene = this.normalizeScene((options && (options.scene || options.mode || entry)) || 'chat')
    this.setData({
      navBarHeight: app.globalData.navBarHeight,
      menuTop: app.globalData.menuTop,
      menuHeight: app.globalData.menuHeight,
      chapterId: options.chapterId || '',
      entry,
      scene,
      sceneTitle: scene === 'story' ? '讲故事模式' : '智能伴读',
      quickQuestions: scene === 'story'
        ? ['继续讲', '重讲这一段', '我讲到哪了', '跳到下一章']
        : ['总结这本书', '这本书适合谁读', '提炼三个核心观点', '帮我解释第一章'],
    })
    if (typeof wx.onNeedPrivacyAuthorization === 'function') {
      wx.onNeedPrivacyAuthorization((resolve) => {
        app.globalData._privacyResolve = resolve
        this.setData({
          privacyModalTitle: '隐私授权说明',
          privacyModalText: '该功能需要您同意隐私授权后才能使用。',
        })
        this.showPrivacyPopup()
      })
    }
    this.bookId = options.bookId
    this.chatEntry = entry
    this.chatScene = scene
    this.initialText = options.initialText ? decodeURIComponent(options.initialText) : ''
    this.messageSeed = 0
    this.audioContext = null
    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false
    this.ignoreNextStopEvent = false
    this.playbackEpoch = 0
    this._streamRequestTask = null
    this.audioQueue = []        // {messageId, text} 待生成
    this.readyMap = {}          // seq -> {messageId, audioUrl} 已生成
    this.nextPlaySeq = 0       // 下一个该播放的序号
    this.nextGenSeq = 0        // 下一个生成的序号
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    this.speechSegmentCount = 0
    this.pendingPrivacyAction = null
    this.voiceStartY = 0
    this.voiceStartAt = 0
    this.voiceRecordingCancelled = false
    this.voiceRecordingTooShort = false
    this.voiceRecordStarting = false
    this.pendingVoiceStop = null
    this.lastScrollToBottomTime = 0
    this._scrollTailTimer = null
    // 流式输出过快时，先把回复暂存在实例变量中，再定时批量刷新视图层。
    this._streamFlushTimer = null
    this._autoScrollTimer = null
    this._pendingStreamReply = ''
    this._lastFlushedStreamReply = ''
    this._streamingMessageIndex = -1
    this._streamingMessageId = ''
    this._usingServerTtsStream = false
    // 使用 scroll-top 累加触发到底部，避免高频 scroll-into-view 抢占用户手势。
    this._scrollTop = 0
    this._userTouchingChat = false
    this.initRecorder()
    // 2026-05-19: 改为加载书籍 + 对话列表 + 历史消息
    this.initialized = false
    this.loadBookAndConversations()

    // 2026-07-02: 触发背景图生成
    if (this.bookId && options.chapterId) {
      this.generateChatBackground(this.bookId, options.chapterId)
    }
  },

  normalizeScene(scene) {
    const value = String(scene || '').trim().toLowerCase()
    return ['story', 'storytelling', 'tell_story', '讲故事', '故事'].indexOf(value) >= 0
      ? 'story'
      : 'chat'
  },

  normalizeEntry(entry) {
    const value = String(entry || '').trim().toLowerCase()
    if (['story', 'storytelling', 'tell_story', '讲故事', '故事'].indexOf(value) >= 0) {
      return 'story'
    }
    if (['creative', 'creation', 'rewrite', 'secondary_creation', '二次创作'].indexOf(value) >= 0) {
      return 'creative'
    }
    return 'chat'
  },

  getWelcomeMessage(bookTitle) {
    if (this.chatScene === 'story') {
      return `我会按《${bookTitle}》的情节脉络给你讲故事。你可以说“继续讲”“重讲这一段”，也可以让我跳到指定章节。`
    }
    return `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`
  },

  /** 生成章节意境背景图 */
  generateChatBackground(bookId, chapterId) {
    console.log('[chat] generating background for:', bookId, chapterId)
    api.generateImage(bookId, chapterId)
      .then((res) => {
        // res 已经是解包后的 data.data
        if (res && res.imageUrl) {
          console.log('[chat] background generated:', res.imageUrl)
          this.setData({
            backgroundImage: res.imageUrl
          })
        } else {
          console.warn('[chat] background response missing imageUrl:', res)
        }
      })
      .catch((err) => {
        console.error('[chat] generate background failed:', err)
      })
  },

  /** 预览背景图 */
  handlePreviewBackground() {
    if (!this.data.backgroundImage) return
    wx.previewImage({
      urls: [this.data.backgroundImage],
      current: this.data.backgroundImage
    })
  },

  syncChatIdentity() {
    const identity = loadIdentity()
    const displayName = identity ? String(identity.displayName || '').trim() : ''
    const avatarText = displayName && displayName !== '微信用户'
      ? (Array.from(displayName)[0] || '我')
      : '我'
    this.setData({
      identity,
      userAvatarText: avatarText,
    })
  },

  onShow() {
    this.syncChatIdentity()
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
      this.voiceRecordStarting = false
      this.setData({ isRecording: true, voiceCancel: false })
      if (this.pendingVoiceStop) {
        const pending = this.pendingVoiceStop
        this.pendingVoiceStop = null
        this.voiceRecordingCancelled = pending.cancelled
        this.voiceRecordingTooShort = pending.tooShort
        this.recorderManager.stop()
      }
    })
    this.recorderManager.onStop((res) => {
      console.log('recorder stop', res)
      this.voiceRecordStarting = false
      this.pendingVoiceStop = null
      const cancelled = this.voiceRecordingCancelled || this.data.voiceCancel
      const tooShort = this.voiceRecordingTooShort
      this.voiceRecordingCancelled = false
      this.voiceRecordingTooShort = false
      this.voiceRecordStarting = false
      this.pendingVoiceStop = null
      this.setData({ isRecording: false, voiceCancel: false })
      if (cancelled) {
        wx.showToast({
          title: tooShort ? '说话时间太短' : '已取消发送',
          icon: 'none',
        })
        return
      }
      const { tempFilePath } = res
      this.handleVoiceUpload(tempFilePath)
    })
    this.recorderManager.onError((err) => {
      console.error('recorder error', err)
      this.voiceRecordingCancelled = false
      this.voiceRecordingTooShort = false
      this.voiceRecordStarting = false
      this.pendingVoiceStop = null
      this.setData({ isRecording: false, voiceCancel: false })
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

  handleVoiceStart(event) {
    if (this.data.loadingReply || this.data.isRecording) {
      return
    }

    if (!wx.getStorageSync('privacy_authorized_by_button')) {
      this.requestPrivacyAuthorization(() => {
        wx.showToast({ title: '请再次按住说话', icon: 'none' })
      })
      return
    }

    // Check recording permission before starting
    wx.getSetting({
      success: (res) => {
        const auth = res.authSetting['scope.record']
        if (auth === false) {
          // Explicitly denied, guide to settings
          wx.showModal({
            title: '需要录音权限',
            content: '您已禁用录音权限，请在设置中开启后使用语音功能',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm) {
                wx.openSetting()
              }
            }
          })
          return
        }
        
        // If undefined (not asked) or true (granted), proceed
        const touch = event.touches && event.touches[0]
        this.voiceStartY = touch ? touch.clientY : 0
        this.voiceStartAt = Date.now()
        this.voiceRecordingCancelled = false
        this.voiceRecordingTooShort = false
        wx.vibrateShort()
        this.setData({ voiceCancel: false })
        this.startRecording()
      }
    })
  },

  handleVoiceMove(event) {
    if (!this.data.isRecording && !this.voiceRecordStarting) {
      return
    }
    const touch = event.touches && event.touches[0]
    if (!touch) {
      return
    }
    const isCancel = this.voiceStartY - touch.clientY > 50
    if (isCancel !== this.data.voiceCancel) {
      if (isCancel) {
        wx.vibrateShort()
      }
      this.setData({ voiceCancel: isCancel })
    }
  },

  handleVoiceEnd() {
    if (!this.data.isRecording && !this.voiceRecordStarting) {
      return
    }
    const duration = Date.now() - this.voiceStartAt
    const tooShort = duration > 0 && duration < 500 && !this.data.voiceCancel
    const cancelled = this.data.voiceCancel || tooShort
    if (this.voiceRecordStarting) {
      this.pendingVoiceStop = { cancelled, tooShort }
      return
    }
    this.voiceRecordingTooShort = tooShort
    this.voiceRecordingCancelled = cancelled
    this.recorderManager.stop()
  },

  handleVoiceCancel() {
    if (!this.data.isRecording && !this.voiceRecordStarting) {
      return
    }
    if (this.voiceRecordStarting) {
      this.pendingVoiceStop = { cancelled: true, tooShort: false }
      return
    }
    this.voiceRecordingCancelled = true
    this.recorderManager.stop()
  },

  handleToggleInputMode() {
    this.setData({
      inputMode: this.data.inputMode === 'keyboard' ? 'voice' : 'keyboard',
      isRecording: false,
      voiceCancel: false
    })
    wx.vibrateShort()
  },

  handleVoiceMove(event) {
    if (!this.data.isRecording) return
    const touch = event.touches && event.touches[0]
    if (!touch) return
    
    // 简单的判断：如果上滑超过一定距离，标记为取消
    const deltaY = this.voiceStartY - touch.clientY
    const cancel = deltaY > 100 // 向上滑动超过 100 像素取消
    if (cancel !== this.data.voiceCancel) {
      this.setData({ voiceCancel: cancel })
      if (cancel) wx.vibrateShort()
    }
  },

  requestPrivacyAuthorization(next, options) {
    this.pendingPrivacyAction = next
    this.setData({
      privacyModalTitle: (options && options.title) || '隐私授权说明',
      privacyModalText: (options && options.text) || '语音对话需要使用录音权限。请先同意隐私授权，再点击录音。',
    })
    this.showPrivacyPopup()
  },

  startRecording() {
    this.voiceRecordStarting = true
    this.pendingVoiceStop = null
    this.setData({ isRecording: true, voiceCancel: false })
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
    wx.showLoading({ title: '正在识别……', mask: true })
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
    clearTimeout(this._ignoreStopTimer)
    if (this._streamRequestTask && typeof this._streamRequestTask.abort === 'function') {
      this._streamRequestTask.abort()
      this._streamRequestTask = null
    }
    this.destroyAudioContext()
  },

  createMessage(role, content, loading) {
    this.messageSeed += 1
    return this.decorateMessage({
      id: `msg-${this.messageSeed}`,
      role,
      content,
      renderBlocks: this.buildMessageBlocks(role, content),
      loading: !!loading,
    })
  },

  isAssistantRole(role) {
    return role === 'ai' || role === 'assistant'
  },

  decorateMessage(message) {
    const role = message && message.role
    return Object.assign({}, message, {
      isUser: role === 'user',
      isAssistant: this.isAssistantRole(role),
    })
  },

  getDisplayMessageContent(role, content) {
    const rawContent = String(content || '')
    if (role !== 'user') {
      return rawContent
    }
    return rawContent.replace(/\s*回复精简\s*$/, '').trim()
  },

  stripSimpleMarkdown(text) {
    return String(text || '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/^\s{0,3}#{1,4}\s+/gm, '')
      .trim()
  },

  buildInlineSegments(text) {
    const source = String(text || '')
    const segments = []
    const pattern = /\*\*([^*]+)\*\*/g
    let lastIndex = 0
    let match = pattern.exec(source)

    while (match) {
      if (match.index > lastIndex) {
        const plain = source.slice(lastIndex, match.index)
        if (plain) {
          segments.push({ text: plain, strong: false })
        }
      }
      if (match[1]) {
        segments.push({ text: match[1], strong: true })
      }
      lastIndex = pattern.lastIndex
      match = pattern.exec(source)
    }

    const tail = source.slice(lastIndex)
    if (tail) {
      segments.push({ text: tail, strong: false })
    }

    const nextSegments = segments.length ? segments : [{ text: source, strong: false }]
    return nextSegments.map((segment, index) => Object.assign({ key: `seg-${index}` }, segment))
  },

  parseStructuredList(text) {
    const source = String(text || '').replace(/\n+/g, ' ')
    const pattern = /(^|[\s。；;：:])(\d+)[.、．]\s*/g
    const matches = []
    let match = pattern.exec(source)

    while (match) {
      matches.push({
        order: match[2],
        start: match.index + match[1].length,
        contentStart: pattern.lastIndex,
      })
      match = pattern.exec(source)
    }

    if (!matches.length) {
      return null
    }

    const items = matches.map((item, index) => {
      const end = index + 1 < matches.length ? matches[index + 1].start : source.length
      const raw = source.slice(item.contentStart, end).trim()
      const titleMatch = raw.match(/^\*\*([^*]+)\*\*\s*(?:——|--|[-—–:：])?\s*(.*)$/)
      const splitMatch = titleMatch ? null : raw.match(/^(.{2,18}?)(?:——|--|：|:)\s*(.+)$/)
      const title = titleMatch
        ? titleMatch[1].trim()
        : (splitMatch ? this.stripSimpleMarkdown(splitMatch[1]) : '')
      const body = titleMatch
        ? this.stripSimpleMarkdown(titleMatch[2])
        : this.stripSimpleMarkdown(splitMatch ? splitMatch[2] : raw)

      return {
        key: `list-${item.order}-${index}`,
        order: item.order,
        title,
        body,
      }
    })

    return {
      prefix: source.slice(0, matches[0].start).trim(),
      items,
    }
  },

  pushParagraphBlock(blocks, text) {
    const content = String(text || '').trim()
    if (!content) {
      return
    }
    blocks.push({
      key: `p-${blocks.length}`,
      type: 'paragraph',
      segments: this.buildInlineSegments(content),
    })
  },

  buildMessageBlocks(role, content) {
    if (!this.isAssistantRole(role)) {
      return []
    }

    let source = String(content || '').trim()
    if (!source) {
      return []
    }

    source = source.replace(/\r\n/g, '\n').replace(/\t/g, ' ')
    const blocks = []

    // 1. 处理引用块 (Callout) - 以 > 开头
    const lines = source.split('\n')
    let currentCallout = []
    const processedLines = []

    lines.forEach(line => {
      if (line.startsWith('>')) {
        currentCallout.push(line.replace(/^>\s*/, ''))
      } else {
        if (currentCallout.length > 0) {
          blocks.push({
            key: `callout-${blocks.length}`,
            type: 'callout',
            text: currentCallout.join('\n')
          })
          currentCallout = []
        }
        processedLines.push(line)
      }
    })
    if (currentCallout.length > 0) {
      blocks.push({
        key: `callout-${blocks.length}`,
        type: 'callout',
        text: currentCallout.join('\n')
      })
    }

    source = processedLines.join('\n').trim()
    if (!source) return blocks

    // 2. 处理代码块 - 以 ``` 开头
    const codePattern = /```(?:\w+)?\n([\s\S]+?)```/g
    let codeMatch
    let lastIdx = 0
    const finalSourceParts = []

    while ((codeMatch = codePattern.exec(source)) !== null) {
      if (codeMatch.index > lastIdx) {
        finalSourceParts.push(source.slice(lastIdx, codeMatch.index))
      }
      blocks.push({
        key: `code-${blocks.length}`,
        type: 'code',
        text: codeMatch[1].trim()
      })
      lastIdx = codePattern.lastIndex
    }
    finalSourceParts.push(source.slice(lastIdx))
    source = finalSourceParts.join('\n').trim()

    // 原有的标题、列表、段落处理逻辑
    const headingMatch = source.match(/^\s*(?:#{1,4}\s*)?\*\*([^*]+)\*\*\s*/)
      || source.match(/^\s*#{1,4}\s+([^\n]+)\n?/)

    if (headingMatch) {
      blocks.push({
        key: 'heading-0',
        type: 'heading',
        text: this.stripSimpleMarkdown(headingMatch[1]),
      })
      source = source.slice(headingMatch[0].length).trim()
    }

    const sectionMatch = source.match(/^(主要内容|核心内容|章节要点|简要回答|回答)[:：]\s*/)
    if (sectionMatch) {
      blocks.push({
        key: `section-${blocks.length}`,
        type: 'section',
        text: sectionMatch[1],
      })
      source = source.slice(sectionMatch[0].length).trim()
    }

    const list = this.parseStructuredList(source)
    if (list && list.items.length) {
      this.pushParagraphBlock(blocks, list.prefix)
      blocks.push({
        key: `list-${blocks.length}`,
        type: 'list',
        items: list.items,
      })
      return blocks
    }

    source.split(/\n{2,}|\n(?=\S)/).forEach((paragraph) => {
      this.pushParagraphBlock(blocks, paragraph)
    })
    return blocks
  },

  // ====================================================================
  // 2026-05-19: 重写加载逻辑，支持多对话
  // ====================================================================

  loadBookAndConversations() {
    this.syncChatIdentity()
    /* 加载书籍信息 + 对话列表 + 最近对话的消息 */
    api.getBookById(this.bookId)
      .then((book) => {
        this.setData({ book })
        return this.loadConversations(book)
      })
      .then(() => {
        if (this.initialText) {
          const q = this.initialText
          this.initialText = ''
          setTimeout(() => {
            this.sendMessage(q)
          }, 500)
        }
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
    return api.listConversations(this.bookId, this.chatEntry, this.chatScene)
      .then((convs) => {
        if (convs && convs.length > 0) {
          // 有已有对话 → 选中最近更新的一个
          const latest = convs[0]
          this.setData({
            conversations: convs,
            currentConversationId: latest.id,
            currentConversationTitle: latest.title,
          })
          return this.loadMessages(latest.id, bookTitle, latest.messages)
        }
        // 没有对话 → 自动新建一个
        return this.createAndSelectConversation(bookTitle)
      })
      .catch((error) => {
        console.error('loadConversations failed:', error)
        // 降级：显示欢迎消息
        const welcomeMessage = this.createMessage(
          'ai',
          this.getWelcomeMessage(bookTitle)
        )
        this.setData({
          messages: [welcomeMessage],
        }, () => {
          this.scrollToBottom(true)
        })
      })
  },

  loadMessages(conversationId, bookTitle, presetMessages) {
    /* 加载指定对话的历史消息 */
    const messagesPromise = Array.isArray(presetMessages)
      ? Promise.resolve(presetMessages)
      : api.getConversationMessages(conversationId)
    return messagesPromise
      .then((messages) => {
        const formatted = messages.map((m) => {
          const content = this.getDisplayMessageContent(m.role, m.content)
          return this.decorateMessage({
            id: m.id,
            role: m.role,
            content,
            renderBlocks: this.buildMessageBlocks(m.role, content),
            loading: false,
          })
        })
        if (formatted.length === 0) {
          // 空对话 → 显示欢迎消息
          const welcomeMessage = this.createMessage(
            'ai',
            this.getWelcomeMessage(bookTitle)
          )
          formatted.push(welcomeMessage)
        }
        this.setData({
          messages: formatted,
          loadingMessages: false, // 关闭骨架屏
        }, () => {
          this.scrollToBottom(true)
        })
        this.initialized = true
      })
      .catch((error) => {
        console.error('loadMessages failed:', error)
        const welcomeMessage = this.createMessage(
          'ai',
          this.getWelcomeMessage(bookTitle)
        )
        this.setData({
          messages: [welcomeMessage],
          loadingMessages: false, // 关闭骨架屏
        }, () => {
          this.scrollToBottom(true)
        })
        this.initialized = true
      })
  },

  createAndSelectConversation(bookTitle) {
    /* 创建新对话并选中 */
    const title = this.chatEntry === 'story' ? '讲故事' : undefined
    return api.createConversation(this.bookId, title, this.chatEntry, this.chatScene)
      .then((conv) => {
        const presetMessages = Array.isArray(conv && conv.messages) ? conv.messages : []
        this.setData({
          conversations: [conv],
          currentConversationId: conv.id,
          currentConversationTitle: conv.title,
        })
        if (presetMessages.length) {
          return this.loadMessages(conv.id, bookTitle, presetMessages)
        }
        const welcomeMessage = this.createMessage(
          'ai',
          this.getWelcomeMessage(bookTitle)
        )
        this.setData({
          messages: [welcomeMessage],
          loadingMessages: false, // 新对话创建完也关闭骨架屏
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
    wx.showLoading({ title: '创建中……', mask: true })
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
      content: '将删除这本书当前入口的对话记录，并重置对应的智能会话。此操作不可恢复。',
      confirmText: '清空',
      confirmColor: '#d64545',
      success: (res) => {
        if (!res.confirm) {
          return
        }
        const book = this.data.book
        const bookTitle = book && book.title ? book.title : ''
        this.resetAudioPlayback()
        wx.showLoading({ title: '清空中……', mask: true })
        api.clearConversations(this.bookId, this.chatEntry, this.chatScene)
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
        const formatted = messages.map((m) => {
          const content = this.getDisplayMessageContent(m.role, m.content)
          return this.decorateMessage({
            id: m.id,
            role: m.role,
            content,
            renderBlocks: this.buildMessageBlocks(m.role, content),
            loading: false,
          })
        })
        if (formatted.length === 0) {
          const welcomeMessage = this.createMessage(
            'ai',
            this.getWelcomeMessage(bookTitle)
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
          this.getWelcomeMessage(bookTitle)
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

  handleFocus() {
    this.setData({
      isInputFocused: true
    })
  },

  handleBlur() {
    this.setData({
      isInputFocused: false,
      keyboardHeight: 0
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

    audio.onCanplay(() => {
      audio.play()
    })

    audio.onPlay(() => {
      this.isAudioPlaying = true
      this.isAudioLoading = false
      clearTimeout(this._audioLoadTimeout)
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
        return
      }
      this.finishCurrentAudio(false)
    })

    audio.onPause(() => {
      if (this.ignoreNextStopEvent) {
        return
      }
      this.finishCurrentAudio(false)
    })

    audio.onError((error) => {
      console.error('[chat] audio error', error)
      // 出错后销毁当前实例，下次播放时重建，避免复用损坏的 context
      this.audioContext.destroy()
      this.audioContext = null
      this.isAudioPlaying = false
      this.isAudioLoading = false
      this.currentAudioMessageId = ''
      this.currentAudioStartedAt = 0
      // 延迟重试下一段，给系统时间回收资源
      setTimeout(() => {
        this.playNextIfIdle()
      }, 300)
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
    this.isAudioLoading = false

    // 如果还有待播放的段或正在生成的段，保持 loading 状态不变
    const pendingCount = (this.pendingTTSQueue && this.pendingTTSQueue.length) || 0
    const hasMore = this.generatingCount > 0 || pendingCount > 0 || this.readyMap.hasOwnProperty(this.nextPlaySeq)
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
    this.isAudioLoading = false
    this.audioQueue = []
    this.readyMap = {}
    this.pendingTTSQueue = []
    this.nextPlaySeq = 0
    this.nextGenSeq = 0
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    this.speechSegmentCount = 0
    this._usingServerTtsStream = false
    this.setData({
      playingMessageId: '',
      audioLoadingMessageId: '',
    })
  },

  resetAudioPlayback() {
    // 中止正在进行的 SSE 流式响应，防止 onSegment 继续入队新的 TTS 请求
    if (this._streamRequestTask && typeof this._streamRequestTask.abort === 'function') {
      this._streamRequestTask.abort()
      this._streamRequestTask = null
    }
    // 递增播放纪元，让飞行中的 TTS Promise 回调识别为过期数据
    this.playbackEpoch += 1
    this.audioQueue = []
    this.readyMap = {}
    this.pendingTTSQueue = []
    this.nextPlaySeq = 0
    this.nextGenSeq = 0
    this.generatingCount = 0
    this.streamSpeechBuffer = ''
    this.speechSegmentCount = 0
    this._usingServerTtsStream = false
    if (this.audioContext && (this.isAudioPlaying || this.currentAudioMessageId)) {
      this.ignoreNextStopEvent = true
      this.audioContext.stop()
      // 延迟清除标记，确保 onStop 和 onPause（无论触发顺序）都被拦截
      clearTimeout(this._ignoreStopTimer)
      this._ignoreStopTimer = setTimeout(() => {
        this.ignoreNextStopEvent = false
      }, 200)
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

    // 首段尽早切出，优先降低“点发送到听见声音”的等待时间。
    if (this.speechSegmentCount === 0 && content.length >= 12) {
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
    const content = String(segment || '')
    if (!content) {
      return
    }

    this.streamSpeechBuffer = `${this.streamSpeechBuffer}${content}`
    if (!this.shouldFlushSpeechBuffer(this.streamSpeechBuffer.trim(), !!force)) {
      return
    }

    // 按句子边界切分 buffer，避免一次性把几百字当一个 chunk 发给 TTS
    const fullText = this.streamSpeechBuffer.trim()
    this.streamSpeechBuffer = ''
    if (!fullText) {
      return
    }

    const chunks = this._splitIntoSpeechChunks(fullText)
    for (let i = 0; i < chunks.length; i += 1) {
      this.speechSegmentCount += 1
      this.enqueueAudioChunk(messageId, chunks[i])
    }
  },

  /**
   * 将文本按句子边界切分为适合 TTS 的 chunk（每段不超过 80 字）。
   * 优先在句末标点处切分；超长无标点段按逗号或硬上限切。
   */
  _splitIntoSpeechChunks(text) {
    const maxLen = 80
    if (text.length <= maxLen) {
      return [text]
    }

    const chunks = []
    // 先按句末标点切分
    const sentences = text.split(/(?<=[。！？!?\n])/)
    let current = ''

    for (let i = 0; i < sentences.length; i += 1) {
      const s = sentences[i]
      if (!s) continue
      if ((current + s).length <= maxLen) {
        current += s
      } else {
        if (current) chunks.push(current)
        // 单句超长时按逗号或硬上限再切
        if (s.length > maxLen) {
          const sub = s.split(/(?<=[，,；;：:])/)
          let buf = ''
          for (let j = 0; j < sub.length; j += 1) {
            if ((buf + sub[j]).length <= maxLen) {
              buf += sub[j]
            } else {
              if (buf) chunks.push(buf)
              buf = sub[j].length > maxLen ? sub[j].slice(0, maxLen) : sub[j]
              // 如果单个子句仍超长，硬切
              if (sub[j].length > maxLen) {
                chunks.push(buf)
                let rest = sub[j].slice(maxLen)
                while (rest.length > maxLen) {
                  chunks.push(rest.slice(0, maxLen))
                  rest = rest.slice(maxLen)
                }
                buf = rest
              }
            }
          }
          current = buf
        } else {
          current = s
        }
      }
    }
    if (current) chunks.push(current)
    return chunks.filter(Boolean)
  },

  flushSpeechBuffer(messageId) {
    const remaining = String(this.streamSpeechBuffer || '').trim()
    this.streamSpeechBuffer = ''
    if (!remaining) {
      return
    }
    const chunks = this._splitIntoSpeechChunks(remaining)
    for (let i = 0; i < chunks.length; i += 1) {
      this.speechSegmentCount += 1
      this.enqueueAudioChunk(messageId, chunks[i])
    }
  },

  /**
   * 直接将已生成的音频 URL 入队播放（服务端 TTS 模式）。
   * 跳过前端 TTS 请求，直接放入 readyMap。
   */
  enqueueReadyAudio(messageId, audioUrl) {
    if (!audioUrl) return
    const seq = this.nextGenSeq
    this.nextGenSeq += 1
    this.readyMap[seq] = { messageId, audioUrl }
    this.setData({ audioLoadingMessageId: messageId })
    this.playNextIfIdle()
  },

  playStreamingAudio(messageId, audioUrl) {
    const src = api.toAbsoluteUrl(audioUrl)
    if (!src) {
      return
    }

    const audio = this.ensureAudioContext()
    this.currentAudioMessageId = messageId
    this.isAudioLoading = true
    this.setData({
      playingMessageId: messageId,
      audioLoadingMessageId: messageId,
    })

    audio.src = src
    clearTimeout(this._audioLoadTimeout)
    this._audioLoadTimeout = setTimeout(() => {
      if (this.isAudioLoading && this.currentAudioMessageId === messageId) {
        console.warn('[chat] streaming audio load timeout')
        this.isAudioLoading = false
        this.setData({ audioLoadingMessageId: '' })
      }
    }, 15000)
  },

  enqueueAudioChunk(messageId, text) {
    const content = String(text || '').trim()
    if (!content) {
      return
    }

    // 分配序号，放入待生成队列
    const seq = this.nextGenSeq
    this.nextGenSeq += 1
    if (!this.pendingTTSQueue) this.pendingTTSQueue = []
    this.pendingTTSQueue.push({ seq, messageId, text: content })
    this.drainTTSQueue()
  },

  /** 限制并发 TTS 请求数量，避免后端串行排队导致超时 */
  drainTTSQueue() {
    const maxConcurrent = 2
    if (!this.pendingTTSQueue || !this.pendingTTSQueue.length) {
      return
    }
    if (this.generatingCount >= maxConcurrent) {
      return
    }
    const item = this.pendingTTSQueue.shift()
    this.generateAudio(item.seq, item.messageId, item.text)
  },

  generateAudio(seq, messageId, text) {
    const epoch = this.playbackEpoch
    this.generatingCount += 1
    this.setData({ audioLoadingMessageId: messageId })

    const startedAt = Date.now()
    const requestPromise = api.requestSpeech(text)
    
    // 增加前端超时保护，防止单次 TTS 请求卡死队列
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('TTS_TIMEOUT')), 10000)
    )

    Promise.race([requestPromise, timeoutPromise])
      .then(({ audioUrl, cached, size }) => {
        // 播放已被重置，丢弃过期结果
        if (this.playbackEpoch !== epoch) {
          return
        }
        this.generatingCount -= 1
        console.info('[chat] tts ready', {
          seq,
          chars: String(text || '').length,
          cached,
          size,
          duration: Date.now() - startedAt,
        })
        // 按序号存入 readyMap
        this.readyMap[seq] = { messageId, audioUrl }
        this.drainTTSQueue()
        this.playNextIfIdle()
      })
      .catch((error) => {
        // 播放已被重置，丢弃过期错误
        if (this.playbackEpoch !== epoch) {
          return
        }
        console.error('[chat] requestSpeech failed', error)
        this.generatingCount -= 1
        
        // 遇到 503 或超时，静默跳过此段，保证对话流不卡死
        this.readyMap[seq] = null
        this.drainTTSQueue()
        this.playNextIfIdle()
        
        // 如果是严重错误，给用户一个轻提示
        if (error.message === 'TTS_TIMEOUT' || error.code === 'SERVICE_UNAVAILABLE') {
          console.warn('TTS 服务繁忙，已跳过当前段落朗读')
        }
      })
  },

  playNextIfIdle() {
    if (this.isAudioPlaying || this.isAudioLoading) {
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
      const pendingCount = (this.pendingTTSQueue && this.pendingTTSQueue.length) || 0
      if (this.generatingCount === 0 && pendingCount === 0) {
        this.setData({ audioLoadingMessageId: '' })
      }
      return
    }

    delete this.readyMap[this.nextPlaySeq]
    this.nextPlaySeq += 1

    this.isAudioLoading = true
    const audio = this.ensureAudioContext()
    this.currentAudioMessageId = next.messageId
    this.setData({
      playingMessageId: next.messageId,
      audioLoadingMessageId: this.generatingCount > 0 ? next.messageId : '',
    })
    // 设置 src，等 onCanplay 再 play
    audio.src = next.audioUrl
    // 超时保护：流式 TTS 冷启动可能需要等待首个音频包。
    clearTimeout(this._audioLoadTimeout)
    this._audioLoadTimeout = setTimeout(() => {
      if (this.isAudioLoading) {
        console.warn('[chat] audio load timeout, skipping')
        this.isAudioLoading = false
        this.playNextIfIdle()
      }
    }, 15000)
  },

  processAudioQueue() {
    this.playNextIfIdle()
  },

  handleSpeakMessage(event) {
    const dataset = event.currentTarget.dataset || {}
    const { id } = dataset
    const message = this.data.messages.find((item) => item.id === id)
    const loading = (message && message.loading) || dataset.loading
    const content = String((message && message.content) || dataset.content || '').trim()
    if (!id || loading) {
      return
    }
    if (!content) {
      wx.showToast({
        title: '暂无可朗读内容',
        icon: 'none',
      })
      return
    }

    if (this.data.playingMessageId === id || this.data.audioLoadingMessageId === id) {
      this.resetAudioPlayback()
      return
    }

    this.resetAudioPlayback()
    this.enqueueAudioChunk(id, content)
  },

  handleCopyMessage(event) {
    const dataset = event.currentTarget.dataset || {}
    const messageId = dataset.id
    const message = this.data.messages.find((item) => item.id === messageId)
    const content = String((message && message.content) || dataset.content || '').trim()
    if (!content) {
      wx.showToast({
        title: '暂无可复制内容',
        icon: 'none',
      })
      return
    }
    this.copyMessageContent(content)
  },

  copyMessageContent(content) {
    const doCopy = () => {
      wx.setClipboardData({
        data: content,
        success: () => {
          wx.showToast({
            title: '已复制',
            icon: 'success',
          })
        },
        fail: (error) => {
          console.error('[chat] copy message failed', error)
          wx.showToast({
            title: error && error.errno === 112
              ? '请先在隐私指引声明剪贴板用途'
              : '复制失败',
            icon: 'none',
          })
        },
      })
    }

    if (typeof wx.requirePrivacyAuthorize !== 'function') {
      doCopy()
      return
    }

    wx.requirePrivacyAuthorize({
      success: doCopy,
      fail: (error) => {
        console.error('[chat] clipboard privacy authorize failed', error)
        if (error && error.errno === 112) {
          wx.showToast({
            title: '请先在隐私指引声明剪贴板用途',
            icon: 'none',
          })
          return
        }
        this.requestPrivacyAuthorization(doCopy, {
          title: '复制授权说明',
          text: '复制消息需要写入系统剪贴板。请先同意隐私授权，再点击复制。',
        })
      },
    })
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
    this.ensureAudioContext()

    // 文本输入和语音识别最终都走此入口；讲故事模式不附加精简提示，避免压缩叙事。
    const serverQuestion = this.chatScene === 'story' ? message : `${message}\n回复精简`
    const userMessage = this.createMessage('user', message)
    // 创建带有思考状态的 AI 消息
    const loadingMessage = this.decorateMessage({
      id: `msg-${Date.now()}-${this.messageSeed++}`,
      role: 'assistant',
      content: '',
      renderBlocks: [],
      loading: true,
      streaming: true,
      thinking: true, // 初始开启思考动画
    })
    const messages = this.data.messages.concat([userMessage, loadingMessage])
    // 记录本轮流式回复所在的消息，后续只更新这一条，避免每个 token 重建整个 messages 数组。
    this._streamingMessageIndex = messages.length - 1
    this._streamingMessageId = loadingMessage.id
    this._pendingStreamReply = ''
    this._lastFlushedStreamReply = ''
    this._usingServerTtsStream = false
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
    const streamPromise = api.sendBookChatMessageStream(chatBookId, serverQuestion, {
      conversationId: convId,
      entry: this.chatEntry,
      scene: this.chatScene,
      tts: true,
      onTtsStream: (stream) => {
        this._usingServerTtsStream = true
        this.streamSpeechBuffer = ''
        this.pendingTTSQueue = []
        this.readyMap = {}
        this.generatingCount = 0
        this.playStreamingAudio(loadingMessage.id, stream.audioUrl)
      },
      onTtsEnd: () => {
        this._streamRequestTask = null
      },
      onSegment: (segment, fullReply) => {
        this._pendingStreamReply = fullReply
        this.scheduleStreamFlush()
      },
    })
    // 保存引用，以便 resetAudioPlayback 可以中止流
    this._streamRequestTask = streamPromise
    streamPromise
      .then((result) => {
        if (!this._usingServerTtsStream) {
          this._streamRequestTask = null
        }
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
      })
      .catch((error) => {
        console.error('[chat] stream failed:', error)
        this._streamRequestTask = null
        this.streamSpeechBuffer = ''
        this._usingServerTtsStream = false
        const errorMessage = error && error.message ? String(error.message) : ''
        const failedContent = this._pendingStreamReply
          || (errorMessage ? `暂时无法获取回答：${errorMessage}` : '暂时无法获取回答，请稍后重试。')
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
    }, 60) // 微调刷新率，实现更细腻的打字机感
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
    // 只更新最后一条助手消息的字段，降低小程序 JS 层到视图层的数据传输量。
    this.setData({
      [`messages[${messageIndex}].content`]: content,
      [`messages[${messageIndex}].renderBlocks`]: this.buildMessageBlocks('ai', content),
      [`messages[${messageIndex}].thinking`]: false, // 收到内容，关闭思考动画
      [`messages[${messageIndex}].loading`]: !force,
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
