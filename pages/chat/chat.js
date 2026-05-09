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
    scrollIntoView: '',
    quickQuestions: ['总结这本书', '这本书适合谁读', '提炼三个核心观点', '帮我解释第一章'],
    playingMessageId: '',
    audioLoadingMessageId: '',
    keyboardHeight: 0,
    isRecording: false,
    isTranscribing: false,
  },

  onLoad(options) {
    this.bookId = options.bookId
    this.messageSeed = 0
    this.audioContext = null
    this.currentAudioMessageId = ''
    this.currentAudioStartedAt = 0
    this.isAudioPlaying = false
    this.isAudioGenerating = false
    this.ignoreNextStopEvent = false
    this.audioQueue = []
    this.streamSpeechBuffer = ''
    this.sttPendingStop = false
    this.recorderManager = null
    this.bindRecorderManager()
    this.loadBook()
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

  loadBook() {
    api.getBookById(this.bookId)
      .then((book) => {
        const welcomeMessage = this.createMessage(
          'ai',
          `你好，我已经了解《${book.title}》的内容，你可以问我关于这本书的问题。`
        )
        this.setData({
          book,
          messages: [welcomeMessage],
          scrollIntoView: welcomeMessage.id,
        })
      })
      .catch((error) => {
        console.error('loadChatBook failed:', error)
        wx.showToast({
          title: '加载书籍失败',
          icon: 'none',
        })
      })
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

  bindRecorderManager() {
    if (this.recorderManager || typeof wx.getRecorderManager !== 'function') {
      return
    }

    const recorderManager = wx.getRecorderManager()
    recorderManager.onStart(() => {
      this.setData({
        isRecording: true,
      })
    })

    recorderManager.onStop((result) => {
      const tempFilePath = result && result.tempFilePath
      this.setData({
        isRecording: false,
      })

      if (!this.sttPendingStop) {
        return
      }

      this.sttPendingStop = false

      if (!tempFilePath) {
        wx.showToast({
          title: '录音文件为空',
          icon: 'none',
        })
        return
      }

      this.transcribeAudio(tempFilePath)
    })

    recorderManager.onError((error) => {
      console.error('[chat] recorder error', error)
      this.sttPendingStop = false
      this.setData({
        isRecording: false,
        isTranscribing: false,
      })
      wx.showToast({
        title: '录音失败',
        icon: 'none',
      })
    })

    this.recorderManager = recorderManager
  },

  ensureRecordPermission() {
    return new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve(true),
        fail: (error) => {
          reject(error)
        },
      })
    })
  },

  startRecording() {
    this.bindRecorderManager()
    if (!this.recorderManager) {
      wx.showToast({
        title: '当前环境不支持录音',
        icon: 'none',
      })
      return
    }
    if (this.data.isRecording || this.data.isTranscribing) {
      return
    }

    this.ensureRecordPermission()
      .then(() => {
        this.sttPendingStop = true
        this.recorderManager.start({
          duration: 60000,
          sampleRate: 16000,
          numberOfChannels: 1,
          format: 'PCM',
        })
      })
      .catch((error) => {
        console.error('[chat] record authorize failed', error)
        wx.showToast({
          title: '请先允许麦克风权限',
          icon: 'none',
        })
      })
  },

  stopRecording() {
    if (!this.recorderManager || !this.data.isRecording) {
      return
    }
    this.recorderManager.stop()
  },

  transcribeAudio(filePath) {
    this.setData({
      isTranscribing: true,
    })

    api.requestSpeechToText(filePath, 'zh_cn', 'recording.pcm')
      .then(({ text }) => {
        if (!text) {
          throw new Error('未识别到语音内容')
        }

        this.setData(this.buildComposerState({
          inputValue: text,
        }))
      })
      .catch((error) => {
        console.error('[chat] stt failed', error)
        wx.showToast({
          title: error && error.message ? error.message : '语音转写失败',
          icon: 'none',
        })
      })
      .finally(() => {
        this.setData({
          isTranscribing: false,
        })
      })
  },

  handleVoiceInput() {
    if (this.data.isTranscribing) {
      return
    }
    if (this.data.isRecording) {
      this.stopRecording()
      return
    }
    this.startRecording()
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

    this.setData({
      playingMessageId: '',
      audioLoadingMessageId: '',
    })

    if (reportMetrics && duration > 0) {
      api.reportVoicePlay(duration)
    }

    if (finishedMessageId) {
      console.info('[chat] audio finished', finishedMessageId)
    }

    this.processAudioQueue()
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
    this.isAudioGenerating = false
    this.audioQueue = []
    this.streamSpeechBuffer = ''
    this.setData({
      playingMessageId: '',
      audioLoadingMessageId: '',
    })
  },

  resetAudioPlayback() {
    this.audioQueue = []
    this.streamSpeechBuffer = ''
    this.isAudioGenerating = false
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
    if (content.length >= 120) {
      return true
    }
    if (content.length >= 48 && punctuationCount >= 2) {
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

    this.audioQueue.push({
      messageId,
      text: content,
    })
    this.processAudioQueue()
  },

  processAudioQueue() {
    if (this.isAudioPlaying || this.isAudioGenerating) {
      return
    }

    const nextItem = this.audioQueue.shift()
    if (!nextItem) {
      this.setData({
        audioLoadingMessageId: '',
      })
      return
    }

    this.isAudioGenerating = true
    this.setData({
      audioLoadingMessageId: nextItem.messageId,
    })

    api.requestSpeech(nextItem.text)
      .then(({ audioUrl }) => {
        const audio = this.ensureAudioContext()
        this.isAudioGenerating = false
        this.currentAudioMessageId = nextItem.messageId
        audio.src = audioUrl
        audio.play()
      })
      .catch((error) => {
        console.error('[chat] queue requestSpeech failed', error)
        this.isAudioGenerating = false
        this.setData({
          audioLoadingMessageId: '',
        })
        this.processAudioQueue()
      })
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

    const userMessage = this.createMessage('user', message)
    const loadingMessage = this.createMessage('ai', 'AI 正在思考...', true)
    const messages = this.data.messages.concat([userMessage, loadingMessage])

    this.setData(Object.assign({
      messages,
      loadingReply: true,
    }, this.buildComposerState({
      inputValue: '',
      inputLineCount: 1,
    })), () => {
      this.scrollToBottom()
    })

    api.sendBookChatMessageStream(this.bookId, message, {
      onSegment: (segment, fullReply) => {
        const nextMessages = this.data.messages.map((item) => {
          if (item.id === loadingMessage.id) {
            return {
              id: item.id,
              role: 'ai',
              content: fullReply,
              loading: false,
            }
          }
          return item
        })

        this.setData({
          messages: nextMessages,
        }, () => {
          this.scrollToBottom()
        })

        this.appendSpeechSegment(loadingMessage.id, segment, false)
      },
    })
      .then((result) => {
        this.flushSpeechBuffer(loadingMessage.id)
        const nextMessages = this.data.messages.map((item) => {
          if (item.id === loadingMessage.id) {
            return {
              id: item.id,
              role: 'ai',
              content: result.reply,
              loading: false,
            }
          }
          return item
        })

        this.setData({
          messages: nextMessages,
          loadingReply: false,
        }, () => {
          this.scrollToBottom()
        })
      })
      .catch(() => {
        this.streamSpeechBuffer = ''
        const nextMessages = this.data.messages.map((item) => {
          if (item.id === loadingMessage.id) {
            return {
              id: item.id,
              role: 'ai',
              content: item.content || '暂时无法获取回答，请稍后重试。',
              loading: false,
            }
          }
          return item
        })

        this.setData({
          messages: nextMessages,
          loadingReply: false,
          audioLoadingMessageId: '',
        }, () => {
          this.scrollToBottom()
        })
      })
  },

  scrollToBottom() {
    const last = this.data.messages[this.data.messages.length - 1]
    if (!last) {
      return
    }
    this.setData({
      scrollIntoView: last.id,
    })
  },

  onUnload() {
    if (this.data.isRecording && this.recorderManager) {
      this.sttPendingStop = false
      this.recorderManager.stop()
    }
    this.destroyAudioContext()
  },
})
