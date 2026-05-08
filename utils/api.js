const { ensureUserIdentity } = require('../services/user')
const { BASE_URL, request, requestWithoutAuth, uploadFile } = require('./request')

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

function getRecommendBooks() {
  return request({
    url: '/api/books/recommend',
  }).then((data) => data.books || [])
}

function getAllBooks() {
  return request({
    url: '/api/books',
  }).then((data) => data.books || [])
}

function getPurchasedBooks() {
  return request({
    url: '/api/books/purchased',
  }).then((data) => data.books || [])
}

function getBookById(id) {
  return request({
    url: `/api/books/${id}`,
  }).then((data) => data.book)
}

function purchaseBook(id) {
  return request({
    url: `/api/books/${id}/purchase`,
    method: 'POST',
  }).then((data) => data.book)
}

function sendBookChatMessage(bookId, message) {
  return request({
    url: '/api/ask',
    method: 'POST',
    data: {
      book: bookId,
      question: message,
    },
  }).then((data) => {
    return {
      reply: data.reply,
      book: data.book,
    }
  })
}

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

function decodeChunk(decoder, arrayBuffer) {
  if (decoder && typeof decoder.decode === 'function') {
    return decoder.decode(arrayBuffer, { stream: true })
  }

  const bytes = new Uint8Array(arrayBuffer)
  let result = ''
  for (let i = 0; i < bytes.length; i += 1) {
    result += String.fromCharCode(bytes[i])
  }
  try {
    return decodeURIComponent(escape(result))
  } catch (error) {
    return result
  }
}

function sendBookChatMessageStream(bookId, message, handlers) {
  const callbacks = handlers || {}

  return ensureUserIdentity().then((identity) => {
    if (!identity || !identity.openid || !identity.token) {
      throw new Error('登录失败，请稍后重试')
    }

    return new Promise((resolve, reject) => {
      const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8') : null
      let buffer = ''
      let reply = ''
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

          if (payload.type === 'segment') {
            const segment = String(payload.content || '')
            if (!segment) {
              return
            }
            reply += segment
            if (typeof callbacks.onSegment === 'function') {
              callbacks.onSegment(segment, reply)
            }
            return
          }

          if (payload.type === 'error') {
            finishReject(new Error(payload.content || '对话失败'))
            return
          }

          if (payload.type === 'end') {
            finishResolve()
          }
        })
      }

      const requestTask = wx.request({
        url: `${BASE_URL}/api/ask/segments`,
        method: 'POST',
        enableChunked: true,
        responseType: 'arraybuffer',
        data: {
          book: bookId,
          question: message,
        },
        header: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${identity.token}`,
          'X-Openid': identity.openid,
        },
        success: (res) => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const error = new Error(
              (res.data && (res.data.error || res.data.message))
                || '请求失败'
            )
            error.statusCode = res.statusCode
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

      if (requestTask && typeof requestTask.onChunkReceived === 'function') {
        requestTask.onChunkReceived((chunk) => {
          buffer += decodeChunk(decoder, chunk.data)
          processBuffer()
        })
      }
    })
  })
}

function getPublisherStats() {
  return request({
    url: '/api/publisher/stats',
  })
}

function getPublisherBooks() {
  return request({
    url: '/api/publisher/books',
  }).then((data) => data.books || [])
}

function uploadBook(formData) {
  return uploadFile('/api/publisher/books/upload', formData.filePath, {
    title: formData.title,
    author: formData.author,
    publisher: formData.publisher,
    category: formData.category,
    description: formData.description,
    price: String(formData.price),
    copyright: formData.copyright,
  }).then((data) => data.book)
}

function updateBookOnlineStatus(id, status) {
  return request({
    url: `/api/publisher/books/${id}/online_status`,
    method: 'PATCH',
    data: { status },
  }).then((data) => data.book)
}

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

module.exports = {
  ensureLogin: ensureUserIdentity,
  getRecommendBooks,
  getAllBooks,
  getPurchasedBooks,
  getBookById,
  purchaseBook,
  sendBookChatMessage,
  sendBookChatMessageStream,
  requestSpeech,
  reportVoicePlay,
  getPublisherStats,
  getPublisherBooks,
  uploadBook,
  updateBookOnlineStatus,
  startBuildBook,
}
