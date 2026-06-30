// API 接口封装模块 - 提供所有后端 API 调用方法

const { ensureUserIdentity } = require('../services/user')
const { BASE_URL, request, requestWithoutAuth, uploadFile } = require('./request')

const ALL_BOOK_CATEGORY = '全部'
let cachedBookCategories = null

/** 将相对路径转为完整的 URL */
function toAbsoluteUrl(path) {
  const rawPath = String(path || '').trim()
  if (!rawPath) {
    return ''
  }
  if (/^https?:\/\//.test(rawPath)) {
    return rawPath
  }
  return `${BASE_URL}${rawPath.startsWith('/') ? rawPath : `/${rawPath}`}`
}

/** 轮询书籍建库状态，直到完成或失败 */
function pollBuildStatus(id, onProgress) {
  return request({
    url: `/api/publisher/books/${id}/build/status`,
  }).then((data) => {
    if (data.book && typeof onProgress === 'function') {
      onProgress(data.book)
    }

    if (data.status === 'completed' || data.status === 'done') {
      return data.book
    }

    if (data.status === 'failed') {
      throw new Error(
        data.error
          || (data.book && data.book.buildError)
          || '建库失败'
      )
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        pollBuildStatus(id, onProgress).then(resolve).catch(reject)
      }, 1000)
    })
  })
}

/** 获取推荐书籍列表 */
function getRecommendBooks() {
  return request({
    url: '/api/books/recommend',
  }).then((data) => data.books || [])
}

/** 获取全部书籍列表 */
function getAllBooks() {
  return request({
    url: '/api/books',
  }).then((data) => data.books || [])
}

function normalizeBookCategories(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data && data.categories)
      ? data.categories
      : Array.isArray(data && data.options)
        ? data.options.map((item) => item && (item.value || item.label || item))
        : []

  return source
    .map((item) => String(item || '').trim())
    .filter((item, index, list) => item && list.indexOf(item) === index)
}

/** 获取书籍类目枚举 */
function getBookCategories() {
  if (cachedBookCategories && cachedBookCategories.length) {
    return Promise.resolve(cachedBookCategories.slice())
  }

  return requestWithoutAuth({
    url: '/api/books/categories',
  })
    .then((data) => {
      const categories = normalizeBookCategories(data)
      cachedBookCategories = categories
      return cachedBookCategories.slice()
    })
    .catch((error) => {
      console.warn('[api] getBookCategories failed', error)
      return cachedBookCategories && cachedBookCategories.length
        ? cachedBookCategories.slice()
        : []
    })
}

function withAllBookCategory(categories) {
  return [ALL_BOOK_CATEGORY].concat(
    normalizeBookCategories(categories).filter((category) => category !== ALL_BOOK_CATEGORY)
  )
}

function resolveBookCategorySelection(categories, selectedCategory) {
  const normalized = normalizeBookCategories(categories)
  const categoryIndex = normalized.indexOf(selectedCategory)
  const nextIndex = categoryIndex >= 0 ? categoryIndex : 0

  return {
    categories: normalized,
    categoryIndex: nextIndex,
    category: normalized[nextIndex] || '',
  }
}

/** 获取用于读者侧筛选 tab 的书籍类目，额外包含“全部” */
function getBookCategoryTabs() {
  return getBookCategories().then(withAllBookCategory)
}

/** 获取用于出版方 picker 的书籍类目，并解析当前选中项 */
function getBookCategoryPicker(selectedCategory) {
  return getBookCategories().then((categories) => (
    resolveBookCategorySelection(categories, selectedCategory)
  ))
}

/** 获取已购买书籍列表 */
function getPurchasedBooks() {
  return request({
    url: '/api/books/purchased',
  }).then((data) => data.books || [])
}

/** 根据 ID 获取单本书籍信息 */
function getBookById(id) {
  return request({
    url: `/api/books/${encodeURIComponent(id)}`,
  }).then((data) => data.book || data)
}

/** 获取书籍指定章节的内容 */
function getChapterContent(bookId, chapterIndex) {
  return request({
    url: `/api/books/${encodeURIComponent(bookId)}/chapters/${chapterIndex}`,
  }).then((data) => data.content || '')
}

/** 获取书籍指定章节的原文行窗口 */
function getOriginalText(bookId, chapterId, offset, limit) {
  return request({
    url: `/api/books/${encodeURIComponent(bookId)}/original`,
    data: {
      chapterId,
      offset: Number(offset || 0),
      limit: Number(limit || 50),
    },
  })
}

/** 购买指定书籍 */
function purchaseBook(id) {
  return request({
    url: `/api/books/${id}/purchase`,
    method: 'POST',
  }).then((data) => data.book)
}

/** 请求 TTS 语音合成，返回音频地址 */
function requestSpeech(text, speaker) {
  return requestWithoutAuth({
    url: '/api/tts',
    method: 'POST',
    data: {
      text,
      speaker: speaker || 'x4_yezi',
    },
  }).then((data) => {
    const audioUrl = toAbsoluteUrl(data.audio_url || data.url)
    if (!audioUrl) {
      throw new Error(data.error || '未获取到音频地址')
    }
    return {
      audioUrl,
      cached: !!data.cached,
      size: Number(data.size || 0),
      filename: data.filename || '',
    }
  })
}

/** 语音转文字（STT） */
function speechToText(filePath) {
  return uploadFile('/api/stt', filePath, {
    filename: 'audio.mp3',
    language: 'zh_cn',
  }).then((data) => {
    if (data && data.text) {
      return data.text
    }
    throw new Error('语音识别失败')
  })
}

/** 上报语音播放时长 */
function reportVoicePlay(duration) {
  return requestWithoutAuth({
    url: '/api/metrics/voice_play',
    method: 'POST',
    data: {
      duration: Number(duration || 0),
      timestamp: Date.now(),
    },
  }).catch(() => null)
}

/**
 * 创建流式解码器，正确处理跨 chunk 的 UTF-8 多字节字符。
 * 当 TextDecoder 可用时直接使用；否则用 fallback 实现，
 * 将不完整的尾部字节保留到下一次调用，避免解码失败丢数据。
 */
function createStreamDecoder() {
  if (typeof TextDecoder !== 'undefined') {
    const td = new TextDecoder('utf-8')
    return function decode(arrayBuffer) {
      return td.decode(arrayBuffer, { stream: true })
    }
  }

  // Fallback：手动处理 UTF-8，保留跨 chunk 的不完整尾部
  let pending = []
  return function decode(arrayBuffer) {
    const incoming = new Uint8Array(arrayBuffer)
    const bytes = pending.length
      ? new Uint8Array(pending.length + incoming.length)
      : incoming
    if (pending.length) {
      bytes.set(pending)
      bytes.set(incoming, pending.length)
      pending = []
    }

    // 从尾部检测不完整的 UTF-8 序列并保留
    let end = bytes.length
    for (let i = 1; i <= 3 && i <= end; i += 1) {
      const b = bytes[end - i]
      if ((b & 0xc0) === 0xc0) {
        // 找到多字节起始字节，计算期望长度
        let expected = 2
        if ((b & 0xf0) === 0xe0) expected = 3
        else if ((b & 0xf8) === 0xf0) expected = 4
        if (end - (end - i) < expected) {
          pending = Array.from(bytes.slice(end - i))
          end = end - i
        }
        break
      }
      if ((b & 0xc0) !== 0x80) break
    }

    let raw = ''
    for (let i = 0; i < end; i += 1) {
      raw += String.fromCharCode(bytes[i])
    }
    try {
      return decodeURIComponent(escape(raw))
    } catch (e) {
      return raw
    }
  }
}

/** 统一解析后端返回数据，兼容 ArrayBuffer 格式 */
function parseResponseData(data) {
  if (!data || typeof data !== 'object') {
    return data || {}
  }

  if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
    const decode = createStreamDecoder()
    const text = decode(data)
    try {
      return JSON.parse(text || '{}')
    } catch (error) {
      return { message: text }
    }
  }

  return data
}

/** 解析流式推送的事件数据 */
function getStreamEvent(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      event: '',
      content: '',
      audioUrl: '',
      success: false,
      message: '',
    }
  }

  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  return {
    event: payload.type || payload.event || data.event || '',
    content: payload.content || payload.answer || data.content || data.answer || '',
    audioUrl: data.audio_url || payload.audio_url || '',
    success: typeof payload.success === 'boolean' ? payload.success : true,
    message: payload.message || payload.error || '',
  }
}

// ====================================================================
// 对话管理 API (2026-05-19 新增)
// ====================================================================

function listConversations(bookId) {
  /* 获取某本书的所有活跃对话列表 */
  return request({
    url: '/api/chat/conversations',
    data: { book: bookId },
  }).then((data) => data.conversations || [])
}

function createConversation(bookId, title) {
  /* 创建新的对话会话 */
  return request({
    url: '/api/chat/conversations',
    method: 'POST',
    data: { book: bookId, title: title || '新对话' },
  }).then((data) => data.conversation)
}

function deleteConversation(conversationId) {
  /* 删除某个对话（含所有消息） */
  return request({
    url: `/api/chat/conversations/${conversationId}`,
    method: 'DELETE',
  }).then((data) => data.deleted)
}

function clearConversations(bookId) {
  /* 清空某本书的全部对话和对应 NovelIndex sessions */
  return request({
    url: '/api/chat/conversations',
    method: 'DELETE',
    data: { book: bookId },
  }).then((data) => data)
}

function getConversationMessages(conversationId) {
  /* 获取某个对话的全部消息 */
  return request({
    url: `/api/chat/conversations/${conversationId}/messages`,
  }).then((data) => data.messages || [])
}

function appendConversationMessages(conversationId, messages) {
  /* 将外部 Agent 的问答结果回写到本地对话历史 */
  if (!conversationId || !Array.isArray(messages) || !messages.length) {
    return Promise.resolve([])
  }
  return ensureUserIdentity().then((identity) => {
    if (!identity || !identity.openid || !identity.token) {
      return []
    }
    return new Promise((resolve, reject) => {
      wx.request({
        url: `${BASE_URL}/api/chat/conversations/${conversationId}/messages`,
        method: 'POST',
        data: { messages },
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
          'X-Openid': identity.openid,
        },
        success: (res) => {
          if (res.statusCode === 404 || res.statusCode === 405 || res.statusCode === 501) {
            resolve([])
            return
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(normalizeError(res, '消息保存失败'))
            return
          }
          try {
            const data = unwrapApiResponse(res.data || {}, '消息保存失败')
            resolve(data.messages || [])
          } catch (error) {
            reject(error)
          }
        },
        fail: reject,
      })
    })
  }).catch(() => [])
}

// ====================================================================
// 流式问答
// ====================================================================

/** 流式书籍问答 - 使用 chunked 传输逐段返回回答 */
function sendBookChatMessageStream(bookId, message, handlers) {
  const callbacks = handlers || {}
  let streamRequestTask = null

  const promise = ensureUserIdentity().then((identity) => {
    if (!identity || !identity.openid || !identity.token) {
      throw new Error('登录失败，请稍后重试')
    }

    return new Promise((resolve, reject) => {
      const decode = createStreamDecoder()
      let buffer = ''
      let reply = ''
      let tokenReceived = false
      let settled = false

      const finishResolve = () => {
        if (settled) {
          return
        }
        settled = true
        resolve({ reply })
      }

      const finishReject = (error) => {
        if (settled) {
          return
        }
        settled = true
        reject(error)
      }

      const processBuffer = () => {
        const parts = buffer.split('\n\n')
        buffer = parts.pop() || ''

        parts.forEach((part) => {
          const lines = part.split('\n').filter((line) => line.indexOf('data:') === 0)
          if (!lines.length) {
            return
          }

          const payloadText = lines.map((line) => line.replace(/^data:\s*/, '')).join('\n')
          if (!payloadText) {
            return
          }

          let payload = null
          try {
            payload = JSON.parse(payloadText)
          } catch (error) {
            console.error('[stream] invalid payload', payloadText, error)
            return
          }

          const streamEvent = getStreamEvent(payload)

          if (!streamEvent.success || streamEvent.event === 'error') {
            finishReject(new Error(streamEvent.content || streamEvent.message || '对话失败'))
            return
          }

          if (streamEvent.event === 'token' || streamEvent.event === 'segment') {
            const segment = String(streamEvent.content || '')
            if (!segment) {
              return
            }
            tokenReceived = true
            reply += segment
            if (typeof callbacks.onSegment === 'function') {
              callbacks.onSegment(segment, reply)
            }
            return
          }

          if (streamEvent.event === 'result') {
            const finalAnswer = String(streamEvent.content || '')
            if (finalAnswer && !tokenReceived) {
              reply = finalAnswer
              if (typeof callbacks.onSegment === 'function') {
                callbacks.onSegment(finalAnswer, reply)
              }
            }
            finishResolve()
            return
          }

          if (streamEvent.event === 'end') {
            finishResolve()
          }
        })
      }

      streamRequestTask = wx.request({
         url: `${BASE_URL}/api/chat/stream`,
        method: 'POST',
        enableChunked: true,
        responseType: 'arraybuffer',
        data: {
          doc_id: bookId,
          message,
          session_id: callbacks.conversationId || '',
          user_id: identity.userId || identity.openid || 'default',
        },
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
          'X-Openid': identity.openid,
        },
        success: (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const responseData = parseResponseData(res.data)
            const error = new Error(
              (responseData && (responseData.error || responseData.message))
                || '请求失败'
            )
            error.statusCode = res.statusCode
            if (responseData && typeof responseData === 'object') {
              error.code = responseData.code
              error.requestId = responseData.requestId
              error.details = responseData.details
            }
            finishReject(error)
            return
          }
          processBuffer()
          finishResolve()
        },
        fail: (error) => {
          finishReject(error)
        },
      })

      if (streamRequestTask && typeof streamRequestTask.onChunkReceived === 'function') {
        streamRequestTask.onChunkReceived((chunk) => {
          buffer += decode(chunk.data)
          processBuffer()
        })
      }
    })
  })

  // 暴露 abort 方法，允许调用方中止流式请求
  promise.abort = () => {
    if (streamRequestTask && typeof streamRequestTask.abort === 'function') {
      streamRequestTask.abort()
    }
  }

  return promise
}

/** 获取出版方统计数据 */
function getPublisherStats() {
  return request({
    url: '/api/publisher/stats',
  })
}

/** 获取出版方管理的书籍列表 */
function getPublisherBooks() {
  return request({
    url: '/api/publisher/books',
  }).then((data) => data.books || [])
}

/** 上传封面图片，返回图片 URL */
function uploadCover(filePath) {
  return uploadFile('/api/publisher/cover/upload', filePath, {}).then((data) => {
    if (data && data.cover_url) {
      return data.cover_url
    }
    throw new Error('封面上传失败')
  })
}

/** 上传新书籍（出版方功能） */
function uploadBook(formData) {
  return uploadFile('/api/publisher/books/upload', formData.filePath, {
    title: formData.title,
    author: formData.author,
    publisher: formData.publisher,
    category: formData.category,
    description: formData.description,
    price: String(formData.price),
    copyright: formData.copyright,
    cover_url: formData.coverUrl || '',
  }).then((data) => data.book)
}

/** 更新书籍上下架状态 */
function updateBookOnlineStatus(id, status) {
  return request({
    url: `/api/publisher/books/${id}/online_status`,
    method: 'PATCH',
    data: { status },
  }).then((data) => data.book)
}

/** 更新书籍信息 */
function updateBookMetadata(id, metadata) {
  return request({
    url: `/api/publisher/books/${id}`,
    method: 'PATCH',
    data: metadata,
  }).then((data) => data.book)
}

/** 触发书籍建库并轮询等待完成 */
function startBuildBook(id, onProgress) {
  return request({
    url: `/api/publisher/books/${id}/build`,
    method: 'POST',
  }).then((data) => {
    if (data.book && typeof onProgress === 'function') {
      onProgress(data.book)
    }
    return pollBuildStatus(id, onProgress)
  })
}

/** 切换用户活跃角色（reader / publisher） */
function switchUserRole(role) {
  return request({
    url: '/api/auth/switch-role',
    method: 'POST',
    data: { role },
  }).then((data) => data.identity || data)
}

module.exports = {
  ensureLogin: ensureUserIdentity,
  getRecommendBooks,
  getAllBooks,
  getBookCategories,
  getBookCategoryTabs,
  getBookCategoryPicker,
  getPurchasedBooks,
  getBookById,
  getChapterContent,
  getOriginalText,
  purchaseBook,
  sendBookChatMessageStream,
  listConversations,
  createConversation,
  deleteConversation,
  clearConversations,
  getConversationMessages,
  appendConversationMessages,
  requestSpeech,
  speechToText,
  reportVoicePlay,
  uploadCover,
  getPublisherStats,
  getPublisherBooks,
  uploadBook,
  updateBookOnlineStatus,
  updateBookMetadata,
  startBuildBook,
  switchUserRole,
  toAbsoluteUrl,
}
