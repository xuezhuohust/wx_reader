
function translateCategory(raw) {
  if (!raw) return "General Corpus";
  const str = String(raw).trim();
  const categoryMap = {
    "哲学": "Philosophy",
    "文学": "Literature",
    "历史": "History",
    "科技": "Computer Science",
    "计算机": "Computer Science",
    "经济": "Economics",
    "艺术": "Arts & Design",
    "社会": "Social Sciences",
    "社会学": "Social Sciences",
    "心理": "Psychology",
    "心理学": "Psychology",
    "科普": "Popular Science",
    "小说": "Fiction",
    "传记": "Biography",
    "管理": "Management",
    "全部": "All"
  };
  return categoryMap[str] || str;
}

function normalizeBook(book) {
  if (!book || typeof book !== "object") return book;
  return Object.assign({}, book, {
    category: translateCategory(book.category)
  });
}
// API 接口封装模块 - 提供所有后端 API 调用方法

const { ensureUserIdentity } = require("../services/user");
const {
  BASE_URL,
  request,
  requestWithoutAuth,
  uploadFile,
} = require("./request");

const ALL_BOOK_CATEGORY = "All";
let cachedBookCategories = null;

/** 将相对路径转为完整的 URL */
function toAbsoluteUrl(path) {
  const rawPath = String(path || "").trim();
  if (!rawPath) {
    return "";
  }
  if (/^https?:\/\//.test(rawPath)) {
    return rawPath;
  }
  return `${BASE_URL}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
}

/** 轮询书籍建库状态，直到完成或失败 */
function pollBuildStatus(id, onProgress) {
  return request({
    url: `/api/publisher/books/${id}/build/status`,
  }).then((data) => {
    if (data.book && typeof onProgress === "function") {
      onProgress(data.book);
    }

    if (data.status === "completed" || data.status === "done") {
      return data.book;
    }

    if (data.status === "failed") {
      throw new Error(
        data.error || (data.book && data.book.buildError) || "建库失败",
      );
    }

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        pollBuildStatus(id, onProgress).then(resolve).catch(reject);
      }, 1000);
    });
  });
}

/** 获取推荐书籍列表 */
function getRecommendBooks() {
  return request({
    url: "/api/books/recommend",
  }).then((data) => (data.books || []).map(normalizeBook));
}

/** 获取全部书籍列表 */
function getAllBooks() {
  return request({
    url: "/api/books",
  }).then((data) => (data.books || []).map(normalizeBook));
}

function normalizeBookCategories(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data && data.categories)
      ? data.categories
      : Array.isArray(data && data.options)
        ? data.options.map((item) => item && (item.value || item.label || item))
        : [];

  const categoryMap = {
    "哲学": "Philosophy",
    "文学": "Literature",
    "历史": "History",
    "科技": "Computer Science",
    "计算机": "Computer Science",
    "经济": "Economics",
    "艺术": "Arts & Design",
    "社会": "Social Sciences",
    "心理": "Psychology",
    "科普": "Popular Science",
    "全部": "All"
  };
  return source
    .map((item) => {
      const raw = String(item || "").trim();
      return categoryMap[raw] || raw;
    })
    .filter((item, index, list) => item && list.indexOf(item) === index);
}

/** 获取书籍类目枚举 */
function getBookCategories() {
  if (cachedBookCategories && cachedBookCategories.length) {
    return Promise.resolve(cachedBookCategories.slice());
  }

  return requestWithoutAuth({
    url: "/api/books/categories",
  })
    .then((data) => {
      const categories = normalizeBookCategories(data);
      cachedBookCategories = categories;
      return cachedBookCategories.slice();
    })
    .catch((error) => {
      console.warn("[api] getBookCategories failed", error);
      return cachedBookCategories && cachedBookCategories.length
        ? cachedBookCategories.slice()
        : [];
    });
}

function withAllBookCategory(categories) {
  return [ALL_BOOK_CATEGORY].concat(
    normalizeBookCategories(categories).filter(
      (category) => category !== ALL_BOOK_CATEGORY,
    ),
  );
}

function resolveBookCategorySelection(categories, selectedCategory) {
  const normalized = normalizeBookCategories(categories);
  const categoryIndex = normalized.indexOf(selectedCategory);
  const nextIndex = categoryIndex >= 0 ? categoryIndex : 0;

  return {
    categories: normalized,
    categoryIndex: nextIndex,
    category: normalized[nextIndex] || "",
  };
}

/** 获取用于读者侧筛选 tab 的书籍类目，额外包含“全部” */
function getBookCategoryTabs() {
  return getBookCategories().then(withAllBookCategory);
}

/** 获取用于出版方 picker 的书籍类目，并解析当前选中项 */
function getBookCategoryPicker(selectedCategory) {
  return getBookCategories().then((categories) =>
    resolveBookCategorySelection(categories, selectedCategory),
  );
}

/** 获取已购买书籍列表 */
function getPurchasedBooks() {
  return request({
    url: "/api/books/purchased",
  }).then((data) => (data.books || []).map(normalizeBook));
}

/** 根据 ID 获取单本书籍信息 */
function getBookById(id) {
  return request({
    url: `/api/books/${encodeURIComponent(id)}`,
  }).then((data) => normalizeBook(data.book || data));
}

/** 获取书籍指定章节的内容 */
function getChapterContent(bookId, chapterIndex) {
  return request({
    url: `/api/books/${encodeURIComponent(bookId)}/chapters/${chapterIndex}`,
  }).then((data) => data.content || "");
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
  });
}

/** 购买指定书籍 */
function purchaseBook(id) {
  return request({
    url: `/api/books/${id}/purchase`,
    method: "POST",
  }).then((data) => data.book);
}

/** 请求 TTS 语音合成，返回可边下边播的流式音频地址 */
function requestSpeech(text, speaker) {
  const content = String(text || "").trim();
  if (!content) {
    return Promise.reject(new Error("未获取到音频文本"));
  }

  const query = [`text=${encodeURIComponent(content)}`];
  if (speaker) {
    query.push(`voice=${encodeURIComponent(speaker)}`);
  }
  return Promise.resolve({
    audioUrl: `${BASE_URL}/api/tts/stream?${query.join("&")}`,
    cached: false,
    size: 0,
    filename: "",
    streaming: true,
  });
}

/** 语音转文字（STT） */
function speechToText(filePath) {
  return uploadFile("/api/stt", filePath, {
    filename: "audio.mp3",
    language: "zh_cn",
  }).then((data) => {
    if (data && data.text) {
      return data.text;
    }
    throw new Error("语音识别失败");
  });
}

/** 图片理解：上传图片并返回 caption 结果 */
function captionImage(filePath, options) {
  const payload = options || {};
  return uploadFile("/api/image-understanding", filePath, {
    prompt: payload.prompt || payload.question || "",
    model: payload.model || "",
  });
}

/** 上报语音播放时长 */
function reportVoicePlay(duration) {
  return requestWithoutAuth({
    url: "/api/metrics/voice_play",
    method: "POST",
    data: {
      duration: Number(duration || 0),
      timestamp: Date.now(),
    },
  }).catch(() => null);
}

/**
 * 创建流式解码器，正确处理跨 chunk 的 UTF-8 多字节字符。
 * 当 TextDecoder 可用时直接使用；否则用 fallback 实现，
 * 将不完整的尾部字节保留到下一次调用，避免解码失败丢数据。
 */
function createStreamDecoder() {
  if (typeof TextDecoder !== "undefined") {
    const td = new TextDecoder("utf-8");
    return function decode(arrayBuffer) {
      return td.decode(arrayBuffer, { stream: true });
    };
  }

  // Fallback：手动处理 UTF-8，保留跨 chunk 的不完整尾部
  let pending = [];
  return function decode(arrayBuffer) {
    const incoming = new Uint8Array(arrayBuffer);
    const bytes = pending.length
      ? new Uint8Array(pending.length + incoming.length)
      : incoming;
    if (pending.length) {
      bytes.set(pending);
      bytes.set(incoming, pending.length);
      pending = [];
    }

    // 从尾部检测不完整的 UTF-8 序列并保留
    let end = bytes.length;
    for (let i = 1; i <= 3 && i <= end; i += 1) {
      const b = bytes[end - i];
      if ((b & 0xc0) === 0xc0) {
        // 找到多字节起始字节，计算期望长度
        let expected = 2;
        if ((b & 0xf0) === 0xe0) expected = 3;
        else if ((b & 0xf8) === 0xf0) expected = 4;
        if (end - (end - i) < expected) {
          pending = Array.from(bytes.slice(end - i));
          end = end - i;
        }
        break;
      }
      if ((b & 0xc0) !== 0x80) break;
    }

    let raw = "";
    for (let i = 0; i < end; i += 1) {
      raw += String.fromCharCode(bytes[i]);
    }
    try {
      return decodeURIComponent(escape(raw));
    } catch (e) {
      return raw;
    }
  };
}

/** 统一解析后端返回数据，兼容 ArrayBuffer 格式 */
function parseResponseData(data) {
  if (!data || typeof data !== "object") {
    return data || {};
  }

  if (typeof ArrayBuffer !== "undefined" && data instanceof ArrayBuffer) {
    const decode = createStreamDecoder();
    const text = decode(data);
    try {
      return JSON.parse(text || "{}");
    } catch (error) {
      return { message: text };
    }
  }

  return data;
}

/** 解析流式推送的事件数据 */
function getStreamEvent(payload, explicitEvent) {
  if (!payload || typeof payload !== "object") {
    return {
      event: explicitEvent || "",
      content: "",
      audioUrl: "",
      success: false,
      message: "",
    };
  }

  const data =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  return {
    event: explicitEvent || payload.type || payload.event || data.event || "",
    content:
      payload.content || payload.answer || data.content || data.answer || "",
    audioUrl:
      payload.audioUrl ||
      payload.audio_url ||
      payload.url ||
      data.audioUrl ||
      data.audio_url ||
      data.url ||
      "",
    success: typeof payload.success === "boolean" ? payload.success : true,
    message:
      payload.message || payload.error || data.message || data.error || "",
  };
}

// ====================================================================
// 对话管理 API (2026-05-19 新增)
// ====================================================================

function normalizeConversation(raw) {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const nested =
    raw.conversation && typeof raw.conversation === "object"
      ? raw.conversation
      : {};
  const messages = Array.isArray(raw.messages)
    ? raw.messages
    : Array.isArray(nested.messages)
      ? nested.messages
      : undefined;
  const messageCount =
    typeof raw.messageCount === "number"
      ? raw.messageCount
      : typeof raw.message_count === "number"
        ? raw.message_count
        : typeof nested.messageCount === "number"
          ? nested.messageCount
          : undefined;

  return Object.assign(
    {},
    nested,
    raw,
    {
      id: raw.id || nested.id,
      title: raw.title || nested.title || "新对话",
      bookId:
        raw.bookId ||
        raw.book_id ||
        raw.book ||
        raw.bookKey ||
        raw.book_key ||
        nested.bookId ||
        nested.book_id ||
        nested.book ||
        nested.bookKey ||
        nested.book_key,
    },
    typeof messageCount === "number" ? { messageCount } : {},
    messages ? { messages } : {},
  );
}

function normalizeConversations(data) {
  const source = Array.isArray(data)
    ? data
    : Array.isArray(data && data.conversations)
      ? data.conversations
      : Array.isArray(data && data.items)
        ? data.items
        : [];
  return source.map(normalizeConversation).filter(Boolean);
}

function normalizeConversationMessages(data) {
  if (Array.isArray(data)) {
    return data;
  }
  if (Array.isArray(data && data.messages)) {
    return data.messages;
  }
  if (Array.isArray(data && data.items)) {
    return data.items;
  }
  return [];
}

function listConversations(bookId, entry, scene) {
  /* 获取某本书的所有活跃对话列表 */
  const resolvedScene = scene || entry;
  return request({
    url: "/api/chat/conversations",
    data: Object.assign(
      { book: bookId },
      entry ? { entry } : {},
      resolvedScene ? { scene: resolvedScene } : {},
    ),
  }).then(normalizeConversations);
}

function createConversation(bookId, title, entry, scene) {
  /* 创建新的对话会话 */
  const resolvedScene = scene || entry;
  const defaultTitle =
    entry === "story" ? "讲故事" : entry === "creative" ? "二次创作" : "新对话";
  return request({
    url: "/api/chat/conversations",
    method: "POST",
    data: Object.assign(
      { book: bookId, title: title || defaultTitle },
      entry ? { entry } : {},
      resolvedScene ? { scene: resolvedScene } : {},
    ),
  }).then(normalizeConversation);
}

function deleteConversation(conversationId) {
  /* 删除某个对话（含所有消息） */
  return request({
    url: `/api/chat/conversations/${conversationId}`,
    method: "DELETE",
  }).then((data) => data.deleted);
}

function clearConversations(bookId, entry, scene) {
  /* 清空某本书的全部对话和对应 NovelIndex sessions */
  const resolvedScene = scene || entry;
  return request({
    url: "/api/chat/conversations",
    method: "DELETE",
    data: Object.assign(
      { book: bookId },
      entry ? { entry } : {},
      resolvedScene ? { scene: resolvedScene } : {},
    ),
  }).then((data) => data);
}

function getConversationMessages(conversationId) {
  /* 获取某个对话的全部消息 */
  return request({
    url: `/api/chat/conversations/${conversationId}/messages`,
  }).then(normalizeConversationMessages);
}

function appendConversationMessages(conversationId, messages) {
  /* 将外部 Agent 的问答结果回写到本地对话历史 */
  if (!conversationId || !Array.isArray(messages) || !messages.length) {
    return Promise.resolve([]);
  }
  return ensureUserIdentity()
    .then((identity) => {
      if (!identity || !identity.openid || !identity.token) {
        return [];
      }
      return new Promise((resolve, reject) => {
        wx.request({
          url: `${BASE_URL}/api/chat/conversations/${conversationId}/messages`,
          method: "POST",
          data: { messages },
          header: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${identity.token}`,
            "X-Openid": identity.openid,
          },
          success: (res) => {
            if (
              res.statusCode === 404 ||
              res.statusCode === 405 ||
              res.statusCode === 501
            ) {
              resolve([]);
              return;
            }
            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(normalizeError(res, "消息保存失败"));
              return;
            }
            try {
              const data = unwrapApiResponse(res.data || {}, "消息保存失败");
              resolve(normalizeConversationMessages(data));
            } catch (error) {
              reject(error);
            }
          },
          fail: reject,
        });
      });
    })
    .catch(() => []);
}

// ====================================================================
// 流式问答
// ====================================================================

function createStreamAbortError() {
  const error = new Error("请求已取消");
  error.code = "REQUEST_ABORTED";
  error.aborted = true;
  return error;
}

/** 流式书籍问答 - 使用 chunked 传输逐段返回回答 */
function sendBookChatMessageStream(bookId, message, handlers) {
  const callbacks = handlers || {};
  let streamRequestTask = null;
  let aborted = false;
  let rejectOnAbort = null;

  const promise = ensureUserIdentity().then((identity) => {
    if (aborted) {
      throw createStreamAbortError();
    }
    if (!identity || !identity.openid || !identity.token) {
      throw new Error("登录失败，请稍后重试");
    }

    return new Promise((resolve, reject) => {
      const decode = createStreamDecoder();
      let buffer = "";
      let reply = "";
      let finalState = null;
      let tokenReceived = false;
      let settled = false;

      const finishResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        rejectOnAbort = null;
        resolve({ reply, state: finalState });
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectOnAbort = null;
        reject(error);
      };

      rejectOnAbort = () => finishReject(createStreamAbortError());

      const processBuffer = () => {
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        parts.forEach((part) => {
          const eventLine = part
            .split("\n")
            .find((line) => line.indexOf("event:") === 0);
          const explicitEvent = eventLine
            ? eventLine.replace(/^event:\s*/, "").trim()
            : "";
          const lines = part
            .split("\n")
            .filter((line) => line.indexOf("data:") === 0);
          if (!lines.length) {
            return;
          }

          const payloadText = lines
            .map((line) => line.replace(/^data:\s*/, ""))
            .join("\n");
          if (!payloadText) {
            return;
          }

          let payload = null;
          try {
            payload = JSON.parse(payloadText);
          } catch (error) {
            console.error("[stream] invalid payload", payloadText, error);
            return;
          }

          const streamEvent = getStreamEvent(payload, explicitEvent);

          if (!streamEvent.success || streamEvent.event === "error") {
            finishReject(
              new Error(
                streamEvent.content || streamEvent.message || "对话失败",
              ),
            );
            return;
          }

          if (
            streamEvent.event === "token" ||
            streamEvent.event === "segment"
          ) {
            const segment = String(streamEvent.content || "");
            if (!segment) {
              return;
            }
            tokenReceived = true;
            reply += segment;
            if (typeof callbacks.onSegment === "function") {
              callbacks.onSegment(segment, reply);
            }
            return;
          }

          if (streamEvent.event === "tts_stream") {
            const audioUrl = toAbsoluteUrl(streamEvent.audioUrl);
            if (audioUrl && typeof callbacks.onTtsStream === "function") {
              callbacks.onTtsStream(
                Object.assign({}, payload, {
                  audioUrl,
                }),
              );
            }
            return;
          }

          if (streamEvent.event === "tts_error") {
            console.warn("[stream] tts error", streamEvent.message || payload);
            return;
          }

          if (streamEvent.event === "tts_end") {
            if (typeof callbacks.onTtsEnd === "function") {
              callbacks.onTtsEnd(payload);
            }
            return;
          }

          if (streamEvent.event === "state") {
            finalState = payload;
            if (typeof callbacks.onState === "function") {
              callbacks.onState(payload);
            }
            return;
          }

          if (streamEvent.event === "result") {
            const finalAnswer = String(streamEvent.content || "");
            if (finalAnswer && !tokenReceived) {
              reply = finalAnswer;
              if (typeof callbacks.onSegment === "function") {
                callbacks.onSegment(finalAnswer, reply);
              }
            }
            finishResolve();
            return;
          }

          if (streamEvent.event === "end") {
            finishResolve();
          }
        });
      };

      const wantsTts =
        callbacks.tts === true || typeof callbacks.onTtsStream === "function";
      const scene = callbacks.scene || callbacks.mode || "";
      const entry = callbacks.entry || callbacks.entrance || scene || "";
      const chapterId = callbacks.chapterId || callbacks.chapter_id || "";
      const chapterTitle =
        callbacks.chapterTitle || callbacks.chapter_title || "";
      if (aborted) {
        finishReject(createStreamAbortError());
        return;
      }

      streamRequestTask = wx.request({
        url: `${BASE_URL}/api/chat/stream${wantsTts ? "?tts=1" : ""}`,
        method: "POST",
        enableChunked: true,
        responseType: "arraybuffer",
        data: {
          book: bookId,
          book_id: bookId,
          bookKey: bookId,
          doc_id: bookId,
          message,
          session_id: callbacks.conversationId || "",
          user_id: identity.userId || identity.openid || "default",
          chapterId,
          chapter_id: chapterId,
          chapterTitle,
          chapter_title: chapterTitle,
          tts: wantsTts,
          enableTts: wantsTts,
          withTts: wantsTts,
          voiceReply: wantsTts,
          entry,
          scene,
        },
        header: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${identity.token}`,
          "X-Openid": identity.openid,
        },
        success: (res) => {
          if (aborted) {
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const responseData = parseResponseData(res.data);
            const error = new Error(
              (responseData && (responseData.error || responseData.message)) ||
                "请求失败",
            );
            error.statusCode = res.statusCode;
            if (responseData && typeof responseData === "object") {
              error.code = responseData.code;
              error.requestId = responseData.requestId;
              error.details = responseData.details;
            }
            finishReject(error);
            return;
          }
          processBuffer();
          finishResolve();
        },
        fail: (error) => {
          finishReject(aborted ? createStreamAbortError() : error);
        },
      });

      if (
        streamRequestTask &&
        typeof streamRequestTask.onChunkReceived === "function"
      ) {
        streamRequestTask.onChunkReceived((chunk) => {
          if (aborted) {
            return;
          }
          buffer += decode(chunk.data);
          processBuffer();
        });
      }
    });
  });

  // 暴露 abort 方法，允许调用方中止流式请求
  promise.abort = () => {
    aborted = true;
    if (streamRequestTask && typeof streamRequestTask.abort === "function") {
      streamRequestTask.abort();
    }
    if (rejectOnAbort) {
      rejectOnAbort();
    }
  };

  return promise;
}

/** 流式二次创作 - 使用 SSE/chunked 传输逐段返回生成正文 */
function generateCreativeWorkStream(options, handlers) {
  const payload = options || {};
  const callbacks = handlers || {};
  let streamRequestTask = null;
  let aborted = false;
  let rejectOnAbort = null;

  const promise = ensureUserIdentity().then((identity) => {
    if (aborted) {
      throw createStreamAbortError();
    }
    if (!identity || !identity.openid || !identity.token) {
      throw new Error("登录失败，请稍后重试");
    }

    return new Promise((resolve, reject) => {
      const decode = createStreamDecoder();
      let buffer = "";
      let reply = "";
      let finalWork = null;
      let finalContext = null;
      let tokenReceived = false;
      let settled = false;

      const finishResolve = () => {
        if (settled) {
          return;
        }
        settled = true;
        rejectOnAbort = null;
        resolve({
          reply,
          answer: reply,
          work: finalWork,
          context: finalContext,
        });
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        rejectOnAbort = null;
        reject(error);
      };

      rejectOnAbort = () => finishReject(createStreamAbortError());

      const processBuffer = () => {
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        parts.forEach((part) => {
          const eventLine = part
            .split("\n")
            .find((line) => line.indexOf("event:") === 0);
          const explicitEvent = eventLine
            ? eventLine.replace(/^event:\s*/, "").trim()
            : "";
          const lines = part
            .split("\n")
            .filter((line) => line.indexOf("data:") === 0);
          if (!lines.length) {
            return;
          }

          const payloadText = lines
            .map((line) => line.replace(/^data:\s*/, ""))
            .join("\n");
          if (!payloadText) {
            return;
          }

          let eventPayload = null;
          try {
            eventPayload = JSON.parse(payloadText);
          } catch (error) {
            console.error(
              "[creative stream] invalid payload",
              payloadText,
              error,
            );
            return;
          }

          const streamEvent = getStreamEvent(eventPayload, explicitEvent);
          if (typeof callbacks.onEvent === "function") {
            callbacks.onEvent(streamEvent, eventPayload);
          }

          if (!streamEvent.success || streamEvent.event === "error") {
            finishReject(
              new Error(
                streamEvent.content || streamEvent.message || "二创生成失败",
              ),
            );
            return;
          }

          if (streamEvent.event === "phase") {
            if (typeof callbacks.onPhase === "function") {
              callbacks.onPhase(eventPayload);
            }
            return;
          }

          if (streamEvent.event === "context") {
            finalContext = eventPayload;
            if (typeof callbacks.onContext === "function") {
              callbacks.onContext(eventPayload);
            }
            return;
          }

          if (
            streamEvent.event === "token" ||
            streamEvent.event === "segment"
          ) {
            const segment = String(streamEvent.content || "");
            if (!segment) {
              return;
            }
            tokenReceived = true;
            reply += segment;
            if (typeof callbacks.onSegment === "function") {
              callbacks.onSegment(segment, reply);
            }
            return;
          }

          if (streamEvent.event === "result") {
            const data =
              eventPayload.data && typeof eventPayload.data === "object"
                ? eventPayload.data
                : {};
            finalWork = eventPayload.work || data.work || finalWork;
            const finalAnswer = String(
              streamEvent.content || (finalWork && finalWork.content) || "",
            );
            if (finalAnswer && !tokenReceived) {
              reply = finalAnswer;
              if (typeof callbacks.onSegment === "function") {
                callbacks.onSegment(finalAnswer, reply);
              }
            }
            if (typeof callbacks.onResult === "function") {
              callbacks.onResult(eventPayload);
            }
            finishResolve();
            return;
          }

          if (streamEvent.event === "done" || streamEvent.event === "end") {
            finishResolve();
          }
        });
      };

      if (aborted) {
        finishReject(createStreamAbortError());
        return;
      }

      streamRequestTask = wx.request({
        url: `${BASE_URL}/api/creative/generate/stream`,
        method: "POST",
        enableChunked: true,
        responseType: "arraybuffer",
        timeout: callbacks.timeout || 180000,
        data: {
          bookId: payload.bookId || payload.book_id || payload.book || "",
          userPrompt:
            payload.userPrompt || payload.prompt || payload.message || "",
          chapterId: payload.chapterId || payload.chapter_id || "",
          originalText: payload.originalText || payload.original_text || "",
          type: payload.type || "",
          stream: true,
        },
        header: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${identity.token}`,
          "X-Openid": identity.openid,
        },
        success: (res) => {
          if (aborted) {
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const responseData = parseResponseData(res.data);
            const error = new Error(
              (responseData && (responseData.error || responseData.message)) ||
                "二创生成失败",
            );
            error.statusCode = res.statusCode;
            if (responseData && typeof responseData === "object") {
              error.code = responseData.code;
              error.requestId = responseData.requestId;
              error.details = responseData.details;
            }
            finishReject(error);
            return;
          }
          processBuffer();
          finishResolve();
        },
        fail: (error) => {
          finishReject(aborted ? createStreamAbortError() : error);
        },
      });

      if (
        streamRequestTask &&
        typeof streamRequestTask.onChunkReceived === "function"
      ) {
        streamRequestTask.onChunkReceived((chunk) => {
          if (aborted) {
            return;
          }
          buffer += decode(chunk.data);
          processBuffer();
        });
      }
    });
  });

  promise.abort = () => {
    aborted = true;
    if (streamRequestTask && typeof streamRequestTask.abort === "function") {
      streamRequestTask.abort();
    }
    if (rejectOnAbort) {
      rejectOnAbort();
    }
  };

  return promise;
}

/** 获取出版方统计数据 */
function getPublisherStats() {
  return request({
    url: "/api/publisher/stats",
  });
}

/** 获取出版方管理的书籍列表 */
function getPublisherBooks() {
  return request({
    url: "/api/publisher/books",
  }).then((data) => data.books || []);
}

/** 上传封面图片，返回图片 URL */
function uploadCover(filePath) {
  return uploadFile("/api/publisher/cover/upload", filePath, {}).then(
    (data) => {
      if (data && data.cover_url) {
        return data.cover_url;
      }
      throw new Error("封面上传失败");
    },
  );
}

/** 上传新书籍（出版方功能） */
function uploadBook(formData) {
  return uploadFile("/api/publisher/books/upload", formData.filePath, {
    title: formData.title,
    author: formData.author,
    publisher: formData.publisher,
    category: formData.category,
    description: formData.description,
    price: String(formData.price),
    copyright: formData.copyright,
    cover_url: formData.coverUrl || "",
  }).then((data) => data.book);
}

/** 更新书籍上下架状态 */
function updateBookOnlineStatus(id, status) {
  return request({
    url: `/api/publisher/books/${id}/online_status`,
    method: "PATCH",
    data: { status },
  }).then((data) => data.book);
}

/** 更新书籍信息 */
function updateBookMetadata(id, metadata) {
  return request({
    url: `/api/publisher/books/${id}`,
    method: "PATCH",
    data: metadata,
  }).then((data) => data.book);
}

/** 触发书籍建库并轮询等待完成 */
function startBuildBook(id, onProgress) {
  return request({
    url: `/api/publisher/books/${id}/build`,
    method: "POST",
  }).then((data) => {
    if (data.book && typeof onProgress === "function") {
      onProgress(data.book);
    }
    return pollBuildStatus(id, onProgress);
  });
}

/** 切换用户活跃角色（reader / publisher） */
function switchUserRole(role) {
  return request({
    url: "/api/auth/switch-role",
    method: "POST",
    data: { role },
  }).then((data) => data.identity || data);
}

/** 智能伴读：生成章节意境背景图 */
function normalizeBackendBookId(bookId) {
  const value = String(bookId || "").trim();
  if (value.indexOf("local_book_") === 0) {
    return `book_${value.slice("local_book_".length)}`;
  }
  return value;
}

function generateImage(bookId, chapterId) {
  const resolvedBookId = normalizeBackendBookId(bookId);
  return request({
    url: "/api/image-generation",
    method: "POST",
    data: { bookId: resolvedBookId, chapterId },
    timeout: 60000, // 图片生成耗时较长，手动设置 60s 超时
  });
}

/** 讲故事：获取当前用户在本书的讲述进度 */
function getStoryState(bookId) {
  return request({
    url: `/api/story/${encodeURIComponent(bookId)}/state`,
  });
}

/**
 * AI 二创相关接口
 */

// 1. 提交二创生成请求
function generateCreative(data) {
  return request({
    url: "/api/creative/generate",
    method: "POST",
    data: {
      bookId: data.bookId,
      chapterId: data.chapterId,
      originalText: data.originalText,
      userPrompt: data.userPrompt,
      type: data.type,
    },
    timeout: 360000, // 大模型生成耗时较长
  });
}

/** 二次创作：由后端 LLM 自行判断创作形态 */
function generateCreativeWork(options) {
  const payload = options || {};
  return request({
    url: "/api/creative/generate",
    method: "POST",
    data: {
      bookId: payload.bookId || payload.book_id || payload.book || "",
      userPrompt: payload.userPrompt || payload.prompt || payload.message || "",
      chapterId: payload.chapterId || payload.chapter_id || "",
      originalText: payload.originalText || payload.original_text || "",
      type: payload.type || "",
    },
    timeout: 360000,
  });
}

// 2. 获取我的作品列表
function getMyCreativeWorks() {
  return request({
    url: "/api/creative/my-works",
  });
}

// 3. 删除二创作品
function deleteCreativeWork(id) {
  return request({
    url: `/api/creative/works/${id}`,
    method: "DELETE",
  });
}

// ====================================================================
// 剧创视频 API — 全部为短请求；视频生成本体通过任务状态轮询完成。
// Seedance 2.5 的单条 Generation Clip 可达 30 秒。30 秒是产品默认，
// 避免旧版客户端把未选择的时长悄悄固定成 10 秒。
// ====================================================================

const DEFAULT_DRAMA_DURATION_SECONDS = 30;

function createDramaSession(options) {
  const payload = options || {};
  return request({
    url: "/api/drama/sessions",
    method: "POST",
    data: {
      bookId: payload.bookId || payload.book_id || "",
      conversationId: payload.conversationId || payload.conversation_id || "",
      chapterId: payload.chapterId || payload.chapter_id || "",
      chapterTitle: payload.chapterTitle || payload.chapter_title || "",
    },
    timeout: 30000,
  });
}

function answerDramaSession(sessionId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/sessions/${encodeURIComponent(sessionId)}/answers`,
    method: "POST",
    data: {
      answer: payload.answer || payload.text || "",
      position: payload.position || {},
      eventId: payload.eventId || payload.event_id || "",
      subEventId: payload.subEventId || payload.sub_event_id || "",
      chapterId: payload.chapterId || payload.chapter_id || "",
      aspectRatio: "16:9",
      durationSeconds: Number(payload.durationSeconds || payload.duration_seconds || DEFAULT_DRAMA_DURATION_SECONDS),
      audioEnabled: payload.audioEnabled !== false,
    },
    timeout: 30000,
  });
}

/** 读取某个事件或章节下已经建库完成的 VideoScene，供用户最终选择。 */
function listDramaScenes(sessionId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/sessions/${encodeURIComponent(sessionId)}/scenes`,
    data: {
      eventId: payload.eventId || payload.event_id || "",
      subEventId: payload.subEventId || payload.sub_event_id || "",
      chapterId: payload.chapterId || payload.chapter_id || "",
    },
    timeout: 30000,
  });
}

/** 以用户明确选择的 sceneId 创建异步分镜 / Clip 计划。 */
function createDramaScenePlan(sessionId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/sessions/${encodeURIComponent(sessionId)}/scene-plans`,
    method: "POST",
    data: {
      position: payload.position || {},
      creativeIntent: payload.creativeIntent || payload.creative_intent || "",
      constraints: payload.constraints || payload.constraints_text || "",
      aspectRatio: "16:9",
      durationSeconds: Number(payload.durationSeconds || payload.duration_seconds || DEFAULT_DRAMA_DURATION_SECONDS),
      audioEnabled: payload.audioEnabled !== false,
    },
    timeout: 30000,
  });
}

function getDramaScenePlan(planId) {
  return request({
    url: `/api/drama/scene-plans/${encodeURIComponent(planId)}`,
    timeout: 20000,
  });
}

/** Generate selected long takes; backend concatenates them in storyboard order. */
function generateDramaScenePlan(planId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/scene-plans/${encodeURIComponent(planId)}/generate`,
    method: "POST",
    data: {
      audioEnabled: payload.audioEnabled !== false,
      generationClipIds: Array.isArray(payload.generationClipIds) ? payload.generationClipIds : [],
    },
    timeout: 30000,
  });
}

/** @deprecated 兼容旧版调用；小程序不再向用户暴露 Generation Clip。 */
function generateDramaScenePlanClip(planId, clipId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/scene-plans/${encodeURIComponent(planId)}/generation-clips/${encodeURIComponent(clipId)}/generate`,
    method: "POST",
    data: {
      audioEnabled: payload.audioEnabled !== false,
    },
    timeout: 30000,
  });
}

function getDramaJob(videoId) {
  return request({
    url: `/api/drama/jobs/${encodeURIComponent(videoId)}`,
    timeout: 20000,
  });
}

function listDramaVideos(options) {
  const payload = options || {};
  return request({
    url: "/api/drama/videos",
    data: {
      conversationId: payload.conversationId || payload.conversation_id || "",
      bookId: payload.bookId || payload.book_id || "",
    },
    timeout: 20000,
  }).then((data) => (Array.isArray(data && data.videos) ? data.videos : []));
}

function reuseDramaVideo(videoId, options) {
  const payload = options || {};
  return request({
    url: `/api/drama/videos/${encodeURIComponent(videoId)}/reuse`,
    method: "POST",
    data: {
      sessionId: payload.sessionId || payload.session_id || "",
      conversationId: payload.conversationId || payload.conversation_id || "",
    },
    timeout: 30000,
  });
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
  captionImage,
  reportVoicePlay,
  uploadCover,
  getPublisherStats,
  getPublisherBooks,
  uploadBook,
  updateBookOnlineStatus,
  updateBookMetadata,
  startBuildBook,
  switchUserRole,
  generateImage,
  getStoryState,
  generateCreative,
  generateCreativeWork,
  generateCreativeWorkStream,
  getMyCreativeWorks,
  deleteCreativeWork,
  createDramaSession,
  answerDramaSession,
  listDramaScenes,
  createDramaScenePlan,
  getDramaScenePlan,
  generateDramaScenePlan,
  generateDramaScenePlanClip,
  getDramaJob,
  listDramaVideos,
  reuseDramaVideo,
  toAbsoluteUrl,
};
