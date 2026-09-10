const api = require("../../utils/api");
const { loadIdentity } = require("../../utils/storage");

const AGENT_AVATAR_URL = api.toAbsoluteUrl("/uploads/cover_5f40aae0502c.jpg");
const DEFAULT_DRAMA_DURATION_SECONDS = 30;

Component({
  properties: {
    bookId: {
      type: String,
      value: "",
    },
    bookTitle: {
      type: String,
      value: "",
    },
    entry: {
      type: String,
      value: "chat",
    },
    scene: {
      type: String,
      value: "chat",
    },
    // 外部传入的章节。内部 data 也需要保存当前章节，必须使用不同字段名，
    // 否则 observer 中 setData 会重新触发自己，最终耗尽页面内存。
    sourceChapterId: {
      type: String,
      value: "",
    },
    sourceChapterTitle: {
      type: String,
      value: "",
    },
    initialText: {
      type: String,
      value: "",
    },
    embedded: {
      type: Boolean,
      value: false,
    },
    largeScreen: {
      type: Boolean,
      value: false,
    },
    viewportHeight: {
      type: Number,
      value: 0,
    },
    // 由宿主页在组件创建前计算，避免组件首帧直接读取到 App 全局的 0 值。
    navigationLayout: {
      type: Object,
      value: null,
    },
  },

  data: {
    book: null,
    identity: null,
    agentAvatarUrl: AGENT_AVATAR_URL,
    userAvatarUrl: "",
    userAvatarText: "我",
    messages: [],
    loadingMessages: true, // 新增：控制骨架屏显示
    inputValue: "",
    inputLineCount: 1,
    isInputExpanded: false,
    composerPlaceholderRpx: 240,
    loadingReply: false,
    scrollTop: 0,
    scrollWithAnimation: true,
    entry: "chat",
    scene: "chat",
    sceneTitle: "智能伴读",
    inputPlaceholder: "问问伴读助手...",
    emptyWelcomeText: "",
    thinkingText: "伴读助手正在思考",
    quickQuestions: [
      "总结这本书",
      "这本书适合谁读",
      "提炼三个核心观点",
      "帮我解释第一章",
    ],
    playingMessageId: "",
    audioLoadingMessageId: "",
    isRecording: false,
    voiceCancel: false,
    inputMode: "keyboard", // 'keyboard' or 'voice'
    imageUploading: false,
    keyboardHeight: 0,
    navBarHeight: 0,
    menuTop: 0,
    menuHeight: 0,
    scrolled: false,
    showPrivacyModal: false,
    privacyModalTitle: "隐私授权说明",
    privacyModalText:
      "语音对话需要使用录音权限。请先同意隐私授权，再点击录音。",
    userHasScrolledUp: false,
    showScrollDownBtn: false,
    // 2026-05-19 新增：对话列表支持
    conversations: [],
    currentConversationId: "",
    currentConversationTitle: "新对话",
    showConversationList: false,
    showModeMenu: false,
    // 2026-07-02 新增：背景图支持
    backgroundImage: "",
    backgroundChapterId: "",
    chapterId: "",
    chapterTitle: "",
    storyProgress: null,
    // 2026-07-03 新增：二创模式支持
    chatMode: "chat", // 'chat', 'story', 'creative' or 'drama'
    currentModeLabel: "伴读对话模式",
    currentModeShortLabel: "伴读",
    currentModeClass: "",
    currentModeIconClass: "icon-chat",
    modeOptions: [],
    creativeType: "story_continue", // 'parallel_world', 'character_extension', 'story_continue'
    creativeTypes: [
      {
        id: "story_continue",
        name: "剧情续写",
        prompt: "请根据当前章节进度，续写一段剧情。",
      },
      {
        id: "parallel_world",
        name: "平行时空",
        prompt: "如果在这个时刻发生了不一样的转折，会怎样？",
      },
      {
        id: "character_extension",
        name: "角色补完",
        prompt: "深入描写此时角色的内心世界或隐藏细节。",
      },
    ],
    creativeGenerating: false,
    creativeBaseText: "", // 二创参考的原文
    // 剧创模式：后台任务状态单独保存，避免几分钟的视频生成占住对话请求。
    dramaSessionId: "",
    dramaPositionOptions: [],
    dramaScenePlanId: "",
    dramaVideos: [],
    dramaStarting: false,
    dramaSubmitting: false,
    showDramaPlaylist: false,
    dramaVideoUrl: "",
  },

  observers: {
    "sourceChapterId, sourceChapterTitle": function (chapterId, chapterTitle) {
      if (!this._chatInitialized) return;
      this.setData({
        chapterId: chapterId || "",
        chapterTitle: chapterTitle || "",
      });
      // 横屏阅读时，章节切换不重建伴读组件；在这里同步更新意境图。
      if (chapterId && chapterId !== this.data.backgroundChapterId) {
        this.generateChatBackground(this.bookId, chapterId);
      }
    },
    navigationLayout: function (layout) {
      if (!this._chatInitialized) return;
      this.setData(this.resolveNavigationLayout(layout));
    },
  },

  lifetimes: {
    attached() {
      this.initializeChat(this.properties);
    },

    detached() {
      this.disposeChat();
    },
  },

  pageLifetimes: {
    show() {
      this.syncChatIdentity();
    },
  },

  methods: {
    initializeChat(options) {
      options = options || this.properties;
      const app = getApp();
      const navigationLayout = this.resolveNavigationLayout(
        options.navigationLayout,
      );
      const entry = this.normalizeEntry(
        (options &&
          (options.entry ||
            options.entrance ||
            options.scene ||
            options.mode)) ||
          "chat",
      );
      const scene = this.normalizeScene(
        (options && (options.scene || options.mode || entry)) || "chat",
      );
      const chatMode = this.resolveChatMode(entry, scene);
      const modeState = this.buildModeState(chatMode);
      this.setData(
        Object.assign(
          {
            navBarHeight: navigationLayout.navBarHeight,
            menuTop: navigationLayout.menuTop,
            menuHeight: navigationLayout.menuHeight,
            chapterId: options.sourceChapterId || options.chapterId || "",
            chapterTitle:
              options.sourceChapterTitle || options.chapterTitle
                ? decodeURIComponent(
                    options.sourceChapterTitle || options.chapterTitle,
                  )
                : "",
            creativeBaseText:
              typeof app.globalData.lastReadContext === "string"
                ? app.globalData.lastReadContext
                : "", // 从全局获取阅读进度
          },
          modeState,
        ),
      );
      if (typeof wx.onNeedPrivacyAuthorization === "function") {
        wx.onNeedPrivacyAuthorization((resolve) => {
          app.globalData._privacyResolve = resolve;
          this.setData({
            privacyModalTitle: "隐私授权说明",
            privacyModalText: "该功能需要您同意隐私授权后才能使用。",
          });
          this.showPrivacyPopup();
        });
      }
      this.bookId = options.bookId;
      this.chatEntry = modeState.entry;
      this.chatScene = modeState.scene;
      this.initialText = options.initialText
        ? decodeURIComponent(options.initialText)
        : "";
      this.messageSeed = 0;
      this.audioContext = null;
      this.currentAudioMessageId = "";
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = false;
      this.ignoreNextStopEvent = false;
      this.audioPlayToken = 0;
      this.playbackEpoch = 0;
      this._audioResetReason = "";
      this._currentAudioSource = "";
      this._audioCanplayToken = 0;
      this._audioStartRetryCount = 0;
      this._lastAudioAttempt = null;
      this._seenServerTtsStreams = new Set();
      this._replyRunId = 0;
      this._streamRequestTask = null;
      this._dramaPollTimer = null;
      this._dramaPollingVideoId = "";
      this.audioQueue = []; // {messageId, text} 待生成
      this.readyMap = {}; // seq -> {messageId, audioUrl} 已生成
      this.nextPlaySeq = 0; // 下一个该播放的序号
      this.nextGenSeq = 0; // 下一个生成的序号
      this.generatingCount = 0;
      this.streamSpeechBuffer = "";
      this.speechSegmentCount = 0;
      this.pendingPrivacyAction = null;
      this.voiceStartY = 0;
      this.voiceStartAt = 0;
      this.voiceRecordingCancelled = false;
      this.voiceRecordingTooShort = false;
      this.voiceRecordStarting = false;
      this.pendingVoiceStop = null;
      this.voiceTouchActive = false;
      this.voicePermissionRequestId = 0;
      this.lastScrollToBottomTime = 0;
      this._scrollTailTimer = null;
      // 流式输出过快时，先把回复暂存在实例变量中，再定时批量刷新视图层。
      this._streamFlushTimer = null;
      this._autoScrollTimer = null;
      this._pendingStreamReply = "";
      this._lastFlushedStreamReply = "";
      this._streamingMessageIndex = -1;
      this._streamingMessageId = "";
      this._usingServerTtsStream = false;
      // 使用 scroll-top 累加触发到底部，避免高频 scroll-into-view 抢占用户手势。
      this._scrollTop = 0;
      this._userTouchingChat = false;
      this.initRecorder();
      this._chatInitialized = true;
      // 2026-05-19: 改为加载书籍 + 对话列表 + 历史消息
      this.initialized = false;
      this.loadBookAndConversations();

      // 2026-07-02: 触发背景图生成
      const sourceChapterId =
        options.sourceChapterId || options.chapterId || "";
      if (this.bookId && sourceChapterId) {
        this.generateChatBackground(this.bookId, sourceChapterId);
      }
    },

    resolveNavigationLayout(layout) {
      const app = getApp();
      const supplied = layout && typeof layout === "object" ? layout : {};
      const globalLayout = app.globalData || {};
      const windowInfo =
        typeof wx.getWindowInfo === "function"
          ? wx.getWindowInfo()
          : wx.getSystemInfoSync();
      const statusBarHeight = Number(windowInfo.statusBarHeight) || 20;
      const menuHeight =
        Number(supplied.menuHeight) || Number(globalLayout.menuHeight) || 32;
      const menuTop =
        Number(supplied.menuTop) ||
        Number(globalLayout.menuTop) ||
        statusBarHeight + 6;
      const navBarHeight =
        Number(supplied.navBarHeight) ||
        Number(globalLayout.navBarHeight) ||
        Math.max(64, menuTop + menuHeight + 6);

      return { navBarHeight, menuTop, menuHeight };
    },

    normalizeScene(scene) {
      const value = String(scene || "")
        .trim()
        .toLowerCase();
      if (
        ["story", "storytelling", "tell_story", "讲故事", "故事"].indexOf(
          value,
        ) >= 0
      ) {
        return "story";
      }
      if (
        [
          "creative",
          "creation",
          "rewrite",
          "secondary_creation",
          "二次创作",
        ].indexOf(value) >= 0
      ) {
        return "creative";
      }
      if (["drama", "video", "剧创", "短剧", "视频"].indexOf(value) >= 0) {
        return "drama";
      }
      return "chat";
    },

    normalizeEntry(entry) {
      const value = String(entry || "")
        .trim()
        .toLowerCase();
      if (
        ["story", "storytelling", "tell_story", "讲故事", "故事"].indexOf(
          value,
        ) >= 0
      ) {
        return "story";
      }
      if (
        [
          "creative",
          "creation",
          "rewrite",
          "secondary_creation",
          "二次创作",
        ].indexOf(value) >= 0
      ) {
        return "creative";
      }
      if (["drama", "video", "剧创", "短剧", "视频"].indexOf(value) >= 0) {
        return "drama";
      }
      return "chat";
    },

    resolveChatMode(entry, scene) {
      if (entry === "creative" || scene === "creative") {
        return "creative";
      }
      if (entry === "story" || scene === "story") {
        return "story";
      }
      if (entry === "drama" || scene === "drama") {
        return "drama";
      }
      return "chat";
    },

    getModeMeta(mode) {
      if (mode === "story") {
        return {
          label: "讲故事模式",
          shortLabel: "讲故事",
          description: "情节讲述和进度回顾",
          triggerClass: "mode-trigger--story",
          iconClass: "icon-story",
        };
      }
      if (mode === "creative") {
        return {
          label: "AI 二创模式",
          shortLabel: "二创",
          description: "续写、改写和角色对话",
          badge: "新",
          triggerClass: "mode-trigger--creative",
          iconClass: "icon-creative",
        };
      }
      if (mode === "drama") {
        return {
          label: "剧创模式",
          shortLabel: "剧创",
          description: "生成带配乐的横屏短剧视频",
          badge: "视频",
          triggerClass: "mode-trigger--drama",
          iconClass: "icon-drama",
        };
      }
      return {
        label: "伴读对话模式",
        shortLabel: "伴读",
        description: "总结、解释和深度问答",
        triggerClass: "",
        iconClass: "icon-chat",
      };
    },

    buildModeState(mode) {
      const chatMode = this.normalizeEntry(mode);
      const sceneConfig = this.getSceneConfig(chatMode, chatMode);
      const meta = this.getModeMeta(chatMode);
      return {
        entry: chatMode,
        scene: chatMode,
        chatMode,
        sceneTitle: sceneConfig.title,
        inputPlaceholder: sceneConfig.placeholder,
        emptyWelcomeText: sceneConfig.emptyWelcome,
        thinkingText: sceneConfig.thinkingText,
        quickQuestions: sceneConfig.quickQuestions,
        currentModeLabel: meta.label,
        currentModeShortLabel: meta.shortLabel,
        currentModeClass: meta.triggerClass,
        currentModeIconClass: meta.iconClass,
        modeOptions: this.getModeOptions(chatMode),
      };
    },

    getModeOptions(currentMode) {
      return ["chat", "story", "creative", "drama"].map((mode) => {
        const meta = this.getModeMeta(mode);
        return {
          mode,
          label: meta.label,
          shortLabel: meta.shortLabel,
          description: meta.description,
          badge: meta.badge || "",
          triggerClass: meta.triggerClass,
          iconClass: meta.iconClass,
          active: mode === currentMode,
        };
      });
    },

    getSceneConfig(entry, scene) {
      const mode = entry === "creative" ? "creative" : scene;
      if (mode === "story") {
        return {
          title: "讲故事模式",
          placeholder: "想听哪一段故事？",
          emptyWelcome:
            "你好！我可以按情节脉络给你讲故事，也可以重讲、跳转或回顾进度。",
          thinkingText: "故事助手正在组织情节",
          quickQuestions: ["继续讲", "重讲这一段", "我讲到哪了", "跳到下一章"],
        };
      }
      if (mode === "creative") {
        return {
          title: "二次创作",
          placeholder: "说说想怎么二创...",
          emptyWelcome:
            "你好！我会参考原著和当前章节，帮你续写、改写、写番外或补一段人物对话。",
          thinkingText: "创作助手正在构思",
          quickQuestions: [
            "续写这一章",
            "改成角色对话",
            "写一个番外",
            "换个视角重写",
          ],
        };
      }
      if (mode === "drama") {
        return {
          title: "剧创模式",
          placeholder: "描述想生成的情节位置...",
          emptyWelcome:
            "你好！我会先确认要生成的原文位置，再生成带配乐的横屏短剧视频。",
          thinkingText: "剧创助手正在准备视频",
          quickQuestions: ["生成当前章节", "选择一个情节", "查看播放列表"],
        };
      }
      return {
        title: "智能伴读",
        placeholder: "问问伴读助手...",
        emptyWelcome:
          "你好！我是你的学术伴读助手。我已经为您研读了这本书。您可以就其核心论点、逻辑推演或特定概念提出问题。",
        thinkingText: "伴读助手正在思考",
        quickQuestions: [
          "总结这本书",
          "这本书适合谁读",
          "提炼三个核心观点",
          "帮我解释第一章",
        ],
      };
    },

    isCreativeMode() {
      return (
        this.data.chatMode === "creative" ||
        this.chatEntry === "creative" ||
        this.chatScene === "creative"
      );
    },

    isStoryMode() {
      return (
        this.data.chatMode === "story" ||
        this.chatEntry === "story" ||
        this.chatScene === "story"
      );
    },

    isDramaMode() {
      return (
        this.data.chatMode === "drama" ||
        this.chatEntry === "drama" ||
        this.chatScene === "drama"
      );
    },

    getCreativeOriginalText() {
      const readerContext = getApp().globalData.readerOriginalContext;
      const chapterId = String(
        this.data.chapterId || this.properties.sourceChapterId || "",
      );
      if (
        this.properties.embedded &&
        readerContext &&
        String(readerContext.bookId || "") === String(this.bookId || "") &&
        String(readerContext.chapterId || "") === chapterId
      ) {
        return String(readerContext.text || "");
      }
      return String(this.data.creativeBaseText || "");
    },

    getWelcomeMessage(bookTitle) {
      const mode =
        this.data.chatMode ||
        this.resolveChatMode(this.chatEntry, this.chatScene);
      if (mode === "story") {
        return `我会按《${bookTitle}》的情节脉络给你讲故事。你可以说“继续讲”“重讲这一段”，也可以让我跳到指定章节。`;
      }
      if (mode === "creative") {
        return `我会参考《${bookTitle}》和当前章节，帮你续写、改写、写番外或补一段人物对话。直接告诉我想怎么创作。`;
      }
      if (mode === "drama") {
        return `我会为《${bookTitle}》生成带音乐和配音的横屏短剧。先告诉我想制作哪一段情节。`;
      }
      return `你好，我已经了解《${bookTitle}》的内容，你可以问我关于这本书的问题。`;
    },

    /** 生成章节意境背景图 */
    generateChatBackground(bookId, chapterId) {
      // 手机嵌入态没有独立的伴读画布；Pad 横屏右栏则可以完整展示章节意境。
      if (this.properties.embedded && !this.properties.largeScreen) {
        return;
      }
      const targetChapterId = String(chapterId || "").trim();
      if (!bookId || !targetChapterId) {
        return;
      }

      const requestKey = `${bookId}:${targetChapterId}`;
      // sourceChapterId 与 sourceChapterTitle 可能分两次下发，避免为同一章
      // 重复调用耗时的图片生成接口。
      if (this._backgroundRequestKey === requestKey) {
        return;
      }
      this._backgroundRequestKey = requestKey;
      if (this.data.backgroundChapterId !== targetChapterId) {
        this.setData({
          backgroundImage: "",
          backgroundChapterId: targetChapterId,
        });
      }
      console.log("[chat] generating background for:", bookId, targetChapterId);
      api
        .generateImage(bookId, targetChapterId)
        .then((res) => {
          if (this._backgroundRequestKey !== requestKey) {
            return;
          }
          // res 已经是解包后的 data.data
          if (res && res.imageUrl) {
            console.log("[chat] background generated:", res.imageUrl);
            this.setData({
              backgroundImage: res.imageUrl,
              backgroundChapterId: targetChapterId,
            });
          } else {
            console.warn("[chat] background response missing imageUrl:", res);
          }
        })
        .catch((err) => {
          console.error("[chat] generate background failed:", err);
        })
        .finally(() => {
          if (this._backgroundRequestKey === requestKey) {
            this._backgroundRequestKey = "";
          }
        });
    },

    firstStoryValue() {
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (value !== undefined && value !== null && value !== "") {
          return value;
        }
      }
      return "";
    },

    normalizeStoryProgressState(state) {
      const story = state && state.story ? state.story : {};
      const cursor = story && story.cursor ? story.cursor : {};
      const currentEventWrapper =
        state && state.currentEvent ? state.currentEvent : {};
      const currentEvent =
        currentEventWrapper.event ||
        currentEventWrapper.currentEvent ||
        currentEventWrapper;
      const progress = state && state.progress ? state.progress : null;
      const chapterId = String(
        this.firstStoryValue(
          state && state.chapterId,
          state && state.chapter_id,
          cursor.chapterId,
          cursor.chapter_id,
          currentEvent.chapterId,
          currentEvent.chapter_id,
        ) || "",
      ).trim();
      let chapterTitle = String(
        this.firstStoryValue(
          state && state.chapterTitle,
          state && state.chapter_title,
          cursor.chapterTitle,
          cursor.chapter_title,
          currentEvent.chapterTitle,
          currentEvent.chapter_title,
        ) || "",
      ).trim();

      if (
        !chapterTitle &&
        chapterId &&
        state &&
        state.outline &&
        Array.isArray(state.outline.chapters)
      ) {
        const matchedChapter = state.outline.chapters.find(
          (chapter) => String(chapter.id || "") === chapterId,
        );
        chapterTitle = matchedChapter
          ? String(matchedChapter.title || "").trim()
          : "";
      }

      return {
        chapterId,
        chapterTitle,
        progress,
      };
    },

    applyStoryProgressState(state) {
      const normalized = this.normalizeStoryProgressState(state);
      const displayedChapterId =
        this.data.backgroundChapterId ||
        (this.data.backgroundImage ? this.data.chapterId : "");
      const nextData = {
        storyProgress: normalized.progress,
      };

      const chapterChanged =
        normalized.chapterId && normalized.chapterId !== this.data.chapterId;
      if (chapterChanged) {
        nextData.chapterId = normalized.chapterId;
      }
      if (
        chapterChanged ||
        (normalized.chapterTitle &&
          normalized.chapterTitle !== this.data.chapterTitle)
      ) {
        nextData.chapterTitle = normalized.chapterTitle;
      }

      this.setData(nextData);

      if (normalized.chapterId && normalized.chapterId !== displayedChapterId) {
        const bookId =
          (this.data.book &&
            (this.data.book.bookId ||
              this.data.book.id ||
              this.data.book.bookKey)) ||
          this.bookId;
        this.generateChatBackground(bookId, normalized.chapterId);
      }

      return normalized;
    },

    syncStoryProgressAfterReply() {
      if (!this.isStoryMode()) {
        return Promise.resolve(null);
      }

      const bookId =
        (this.data.book &&
          (this.data.book.bookKey ||
            this.data.book.id ||
            this.data.book.bookId)) ||
        this.bookId;
      if (!bookId) {
        return Promise.resolve(null);
      }

      const syncId = (this._storyProgressSyncId || 0) + 1;
      this._storyProgressSyncId = syncId;
      return api
        .getStoryState(bookId)
        .then((state) => {
          if (this._storyProgressSyncId !== syncId) {
            return null;
          }
          return this.applyStoryProgressState(state);
        })
        .catch((error) => {
          console.warn("[chat] sync story progress failed:", error);
          return null;
        });
    },

    scheduleStoryProgressSyncAfterReply(delay) {
      if (!this.isStoryMode() || this._storyStateAppliedForStream) {
        return;
      }
      const syncId = this._storyProgressSyncId || 0;
      clearTimeout(this._storyProgressSyncTimer);
      this._storyProgressSyncTimer = setTimeout(() => {
        if (
          this._storyProgressSyncId !== syncId ||
          this._storyStateAppliedForStream
        ) {
          return;
        }
        this.syncStoryProgressAfterReply();
      }, delay || 1200);
    },

    /** 预览背景图 */
    handlePreviewBackground() {
      if (!this.data.backgroundImage) return;
      wx.previewImage({
        urls: [this.data.backgroundImage],
        current: this.data.backgroundImage,
      });
    },

    /** 选择伴读模式，并切换到该模式隔离后的会话历史 */
    toggleChatMode() {
      if (this.data.loadingReply) {
        return;
      }

      this.setData({
        showModeMenu: !this.data.showModeMenu,
      });
    },

    handleSelectChatMode(e) {
      if (this.data.loadingReply) {
        return;
      }
      const mode = e.currentTarget.dataset.mode;
      this.switchChatMode(mode);
    },

    switchChatMode(mode) {
      const nextMode = this.normalizeEntry(mode);
      if (nextMode === this.data.chatMode) {
        this.setData({ showModeMenu: false });
        return;
      }

      const modeState = this.buildModeState(nextMode);
      const book = this.data.book;
      this.chatEntry = modeState.entry;
      this.chatScene = modeState.scene;
      this.resetAudioPlayback();

      this.setData(
        Object.assign(
          {},
          modeState,
          {
            conversations: [],
            currentConversationId: "",
            currentConversationTitle: "新对话",
            showConversationList: false,
            showModeMenu: false,
            messages: [],
            loadingMessages: true,
            creativeGenerating: false,
            dramaSessionId: "",
            dramaPositionOptions: [],
            dramaScenePlanId: "",
            dramaVideos: [],
            dramaStarting: false,
            dramaSubmitting: false,
            showDramaPlaylist: false,
            loadingReply: false,
            scrollWithAnimation: true,
            userHasScrolledUp: false,
            showScrollDownBtn: false,
          },
          this.buildComposerState({
            inputValue: "",
            inputLineCount: 1,
          }),
        ),
        () => {
          this.loadConversations(book || {}).then(() => {
            if (nextMode === "drama") {
              this.startDramaSession();
            }
          });
        },
      );

      // 横竖屏切换会重建嵌入式组件，通知阅读器保存当前伴读模式。
      this.triggerEvent("modechange", {
        entry: modeState.entry,
        scene: modeState.scene,
        mode: modeState.chatMode,
      });

      wx.vibrateShort({ type: "light" });
    },

    /** 切换二创类型 */
    handleSelectCreativeType(e) {
      const type = e.currentTarget.dataset.type;
      this.setData({
        creativeType: type,
      });
    },

    /** 提交二创请求 */
    submitCreativeRequest(prompt) {
      if (this.data.creativeGenerating || this.data.loadingReply) return;

      const replyRunId = (this._replyRunId || 0) + 1;
      this._replyRunId = replyRunId;
      this.resetAudioPlayback();
      this.ensureAudioContext();

      this.setData({
        creativeGenerating: true,
        loadingReply: true,
      });

      // 构造一条本地“创作中”的消息
      const creativeTypeObj = this.data.creativeTypes.find(
        (t) => t.id === this.data.creativeType,
      );
      const creativeMessage = this.decorateMessage({
        id: `creative_${Date.now()}`,
        role: "assistant",
        type: "creative", // 标记为二创类型
        status: "generating",
        creativeType: this.data.creativeType,
        creativeTypeName: creativeTypeObj ? creativeTypeObj.name : "AI 二创",
        userPrompt: prompt,
        content: "正在为你构思二创内容...",
      });

      const userMsgContent = `[AI 二创 - ${creativeTypeObj ? creativeTypeObj.name : ""}] ${prompt}`;
      const userMessage = this.createMessage("user", userMsgContent);
      const nextMessages = [
        ...this.data.messages,
        userMessage,
        creativeMessage,
      ];
      this._streamingMessageIndex = nextMessages.length - 1;
      this._streamingMessageId = creativeMessage.id;
      this._pendingStreamReply = "";
      this._lastFlushedStreamReply = "";
      clearTimeout(this._streamFlushTimer);
      clearTimeout(this._autoScrollTimer);

      this.setData(
        {
          messages: nextMessages,
          scrollWithAnimation: false,
          userHasScrolledUp: false,
          showScrollDownBtn: false,
        },
        () => {
          this.scrollToBottom();
        },
      );

      const creativePromise = api.generateCreativeWorkStream(
        {
          bookId: this.bookId,
          chapterId: this.data.chapterId,
          originalText: this.getCreativeOriginalText(),
          userPrompt: prompt,
          type: this.data.creativeType,
        },
        {
          onPhase: (phase) => {
            if (this._replyRunId !== replyRunId) {
              return;
            }
            const message = String(
              (phase && phase.message) || "正在检索原著素材...",
            );
            if (!this._pendingStreamReply) {
              this._pendingStreamReply = message;
              this.flushStreamReply(true);
              this._pendingStreamReply = "";
              this._lastFlushedStreamReply = "";
            }
          },
          onSegment: (segment, fullReply) => {
            if (this._replyRunId !== replyRunId) {
              return;
            }
            this._pendingStreamReply = fullReply;
            this.scheduleStreamFlush();
          },
        },
      );
      this._streamRequestTask = creativePromise;

      creativePromise
        .then((res) => {
          if (this._replyRunId !== replyRunId) {
            return null;
          }
          // 成功后更新消息状态
          const fallbackContent = "暂时没有生成内容，请换个角度再试试。";
          const work = res && res.work;
          const finalContent = String(
            (res && (res.reply || res.answer)) || (work && work.content) || "",
          ).trim();
          const messages = this.data.messages;
          const index = messages.findIndex((m) => m.id === creativeMessage.id);
          let finalMessageId = creativeMessage.id;
          const spokenContent = finalContent || fallbackContent;
          this._pendingStreamReply = spokenContent;
          this.flushStreamReply(true);
          if (index !== -1) {
            finalMessageId =
              (work && work.id) || (res && res.id) || messages[index].id;
            messages[index] = {
              ...messages[index],
              status: "success",
              content: spokenContent,
              id: finalMessageId,
            };
            this.setData({ messages }, () => {
              if (this._replyRunId !== replyRunId) {
                return;
              }
              this.scrollToBottom();
              this.enqueueAssistantSpeech(finalMessageId, spokenContent);
            });
          }
          return api
            .appendConversationMessages(this.data.currentConversationId, [
              { role: "user", content: userMsgContent },
              { role: "assistant", content: spokenContent },
            ])
            .catch((error) => {
              console.warn("[chat] creative history save failed:", error);
              return null;
            });
        })
        .catch((err) => {
          if (this._replyRunId !== replyRunId) {
            return;
          }
          console.error("二创生成失败:", err);
          const messages = this.data.messages;
          const index = messages.findIndex((m) => m.id === creativeMessage.id);
          if (index !== -1) {
            messages[index].status = "error";
            messages[index].content =
              err && err.message
                ? `生成失败：${err.message}`
                : "生成失败，请稍后重试。";
            this.setData({ messages });
          }
        })
        .finally(() => {
          if (this._replyRunId !== replyRunId) {
            return;
          }
          this._streamRequestTask = null;
          this.setData(
            {
              creativeGenerating: false,
              loadingReply: false,
              scrollWithAnimation: true,
            },
            () => {
              if (this._replyRunId !== replyRunId) {
                return;
              }
              this.clearStreamState();
            },
          );
        });
    },

    // ====================================================================
    // 剧创模式：选择事件 → 明确 VideoScene → 规划全部分镜 → 生成整个场景。
    // ====================================================================

    startDramaSession() {
      if (!this.isDramaMode() || this.data.dramaStarting || this.data.dramaSubmitting) {
        return Promise.resolve(null);
      }
      if (this.data.dramaSessionId) {
        return Promise.resolve({ session: { id: this.data.dramaSessionId } });
      }
      const conversationId = this.data.currentConversationId;
      if (!conversationId) {
        return new Promise((resolve) => {
          setTimeout(() => resolve(this.startDramaSession()), 200);
        });
      }
      this.setData({ dramaStarting: true });
      console.info("[drama] session.create input", {
        bookId: this.bookId,
        conversationId,
        chapterId: this.data.chapterId,
      });
      return api
        .createDramaSession({
          bookId: this.bookId,
          conversationId,
          chapterId: this.data.chapterId,
          chapterTitle: this.data.chapterTitle,
        })
        .then((result) => {
          const session = (result && result.session) || {};
          const assistant = (result && result.assistant) || {};
          const content = String(
            assistant.content || "请选择需要生成的视频位置。",
          );
          const message = this.decorateMessage({
            id: `drama_question_${Date.now()}`,
            role: "assistant",
            type: "drama-question",
            selectionStage: "event",
            content,
            positionOptions: Array.isArray(assistant.positionOptions)
              ? assistant.positionOptions
              : [],
          });
          const messages = [...this.data.messages, message];
          this.setData(
            {
              dramaSessionId: session.id || "",
              dramaPositionOptions: message.positionOptions,
              messages,
            },
            () => this.scrollToBottom(),
          );
          console.info("[drama] session.create output", result);
          return api
            .appendConversationMessages(conversationId, [
              { role: "assistant", content },
            ])
            .catch((error) => {
              console.warn("[drama] question history save failed", error);
              return null;
            })
            .then(() => result);
        })
        .catch((error) => {
          console.error("[drama] session.create failed", error);
          wx.showToast({ title: error.message || "剧创初始化失败", icon: "none" });
          return null;
        })
        .finally(() => this.setData({ dramaStarting: false }));
    },

    handleSelectDramaPosition(event) {
      const dataset = event.currentTarget.dataset || {};
      const position = {
        eventId: dataset.eventId || "",
        subEventId: dataset.subEventId || "",
        sceneId: dataset.sceneId || "",
        chapterId: dataset.chapterId || "",
        text: dataset.title || "",
      };
      if (dataset.stage === "scene" || position.sceneId) {
        this.submitDramaScenePlan(position);
        return;
      }
      this.selectDramaEvent(position);
    },

    submitDramaAnswer(rawText, explicitPosition) {
      const answer = String(rawText || "").trim();
      if (!answer) {
        wx.showToast({ title: "请选择或描述一个情节位置", icon: "none" });
        return;
      }
      if (!this.data.dramaSessionId) {
        this.startDramaSession().then((result) => {
          if (result && this.data.dramaSessionId) {
            this.submitDramaAnswer(answer, explicitPosition);
          }
        });
        return;
      }
      if (this.data.dramaSubmitting) return;

      const matchingOption = (this.data.dramaPositionOptions || []).find(
        (item) => String(item.title || "") === answer,
      );
      const position = Object.assign(
        {
          eventId: matchingOption && matchingOption.eventId,
          subEventId: matchingOption && matchingOption.subEventId,
          sceneId: matchingOption && matchingOption.sceneId,
          chapterId:
            (matchingOption && matchingOption.chapterId) || this.data.chapterId,
          text: answer,
        },
        explicitPosition || {},
      );
      if (position.sceneId) {
        this.submitDramaScenePlan(position);
        return;
      }
      this.selectDramaEvent(position);
    },

    // 第一步只选择事件。后端返回 VideoScene 列表后，用户必须再选一个 sceneId；
    // 这样不会把“叙事场景”错误地当成“最终生成的视频片段”。
    selectDramaEvent(position) {
      if (!this.data.dramaSessionId) {
        this.startDramaSession();
        return;
      }
      if (this.data.dramaSubmitting) return;
      const selected = position || {};
      if (!selected.eventId && !selected.subEventId && !selected.chapterId) {
        wx.showToast({ title: "请先选择一个情节或当前章节", icon: "none" });
        return;
      }
      const eventTitle = String(selected.text || "当前章节情节").trim();
      this.setData({ dramaSubmitting: true, loadingReply: true });
      api
        .listDramaScenes(this.data.dramaSessionId, selected)
        .then((result) => {
          const sceneOptions = Array.isArray(result && result.scenes)
            ? result.scenes
            : [];
          if (!sceneOptions.length) {
            throw new Error("该情节尚未拆分出可生成场景，请先完成建库或换一个情节");
          }
          const userMessage = this.createMessage("user", eventTitle);
          const assistantMessage = this.decorateMessage({
            id: `drama_scene_question_${Date.now()}`,
            role: "assistant",
            type: "drama-question",
            selectionStage: "scene",
            content: `已选“${eventTitle}”。请选择一个连续场景生成视频。`,
            positionOptions: sceneOptions,
          });
          this.setData(
            {
              messages: [...this.data.messages, userMessage, assistantMessage],
              dramaPositionOptions: sceneOptions,
            },
            () => this.scrollToBottom(),
          );
          console.info("[drama] scenes.list output", result);
        })
        .catch((error) => {
          console.error("[drama] scenes.list failed", error);
          wx.showToast({
            title: error.message || "读取可生成场景失败",
            icon: "none",
          });
        })
        .finally(() => {
          this.setData({ dramaSubmitting: false, loadingReply: false });
        });
    },

    // 第二步提交已明确选中的 VideoScene，异步生成该场景的完整分镜。
    submitDramaScenePlan(position) {
      if (!this.data.dramaSessionId) {
        this.startDramaSession();
        return;
      }
      if (!position || !position.sceneId) {
        wx.showToast({ title: "请先选择一个具体生成场景", icon: "none" });
        return;
      }
      if (this.data.dramaSubmitting) return;
      const title = String(position.text || "所选场景").trim();
      const userMessage = this.createMessage("user", title);
      const planMessage = this.decorateMessage({
        id: `drama_plan_${Date.now()}`,
        role: "assistant",
        type: "drama-plan",
        status: "queued",
        content: "已选场景，正在准备原文、资产、分镜与声音计划…",
        progressMessage: "正在创建镜头规划",
        scenePlanId: "",
      });
      const messages = [...this.data.messages, userMessage, planMessage];
      this.setData(
        {
          dramaSubmitting: true,
          loadingReply: true,
          messages,
          dramaPositionOptions: [],
        },
        () => this.scrollToBottom(),
      );
      console.info("[drama] scene-plan.create input", {
        sessionId: this.data.dramaSessionId,
        position,
        aspectRatio: "16:9",
        durationSeconds: DEFAULT_DRAMA_DURATION_SECONDS,
        audioEnabled: true,
      });
      api
        .createDramaScenePlan(this.data.dramaSessionId, {
          position,
          durationSeconds: DEFAULT_DRAMA_DURATION_SECONDS,
          audioEnabled: true,
        })
        .then((result) => {
          const scenePlan = (result && result.scenePlan) || {};
          const assistant = (result && result.assistant) || {};
          if (!scenePlan.id) {
            throw new Error("剧创场景计划创建失败");
          }
          console.info("[drama] scene-plan.create output", result);
          this.updateDramaPlanMessage(planMessage.id, scenePlan, assistant.content);
          this.setData({
            dramaScenePlanId: scenePlan.id,
            dramaSessionId: "",
          });
          return api
            .appendConversationMessages(this.data.currentConversationId, [
              { role: "user", content: title },
              {
                role: "assistant",
                content:
                  assistant.content || "正在生成该场景的完整镜头规划。",
              },
            ])
            .catch((error) => {
              console.warn("[drama] scene plan history save failed", error);
              return null;
            })
            .then(() => scenePlan);
        })
        .then((scenePlan) => {
          if (scenePlan && scenePlan.id) {
            this.pollDramaScenePlan(scenePlan.id, planMessage.id);
          }
        })
        .catch((error) => {
          console.error("[drama] scene-plan.create failed", error);
          this.updateDramaPlanMessage(planMessage.id, {
            status: "failed",
            errorMessage: error.message || "剧创任务提交失败",
          });
          wx.showToast({ title: error.message || "剧创任务提交失败", icon: "none" });
        })
        .finally(() => {
          this.setData({ dramaSubmitting: false, loadingReply: false });
        });
    },

    pollDramaScenePlan(planId, messageId) {
      clearTimeout(this._dramaPlanPollTimer);
      if (!planId || !this.isDramaMode()) return;
      api
        .getDramaScenePlan(planId)
        .then((result) => {
          const scenePlan = (result && result.scenePlan) || {};
          console.info("[drama] scene-plan.poll output", scenePlan);
          this.updateDramaPlanMessage(messageId, scenePlan);
          if (scenePlan.status === "ready") {
            return;
          }
          if (scenePlan.status === "failed") return;
          this._dramaPlanPollTimer = setTimeout(() => {
            this.pollDramaScenePlan(planId, messageId);
          }, 2500);
        })
        .catch((error) => {
          console.warn("[drama] scene-plan.poll failed", { planId, error });
          this._dramaPlanPollTimer = setTimeout(() => {
            this.pollDramaScenePlan(planId, messageId);
          }, 8000);
        });
    },

    updateDramaPlanMessage(messageId, scenePlan, assistantContent) {
      const current = scenePlan || {};
      const messages = this.data.messages.map((item) => {
        if (item.id !== messageId) return item;
        const message = current.errorMessage || assistantContent || item.progressMessage || item.content;
        return this.decorateMessage({
          ...item,
          type: "drama-plan",
          status: current.status || item.status,
          scenePlanId: current.id || item.scenePlanId,
          generationClips: current.sceneStoryboard && Array.isArray(current.sceneStoryboard.generationClips)
            ? current.sceneStoryboard.generationClips.map((clip) => ({ ...clip, selected: true }))
            : (item.generationClips || []),
          selectedClipIds: current.sceneStoryboard && Array.isArray(current.sceneStoryboard.generationClips)
            ? current.sceneStoryboard.generationClips.map((clip) => clip.clipId)
            : (item.selectedClipIds || []),
          progressMessage: message,
          content: current.status === "ready"
            ? "镜头规划已完成。请选择要生成的长镜头，多选后会按分镜顺序拼接。"
            : this.dramaPlanStatusText(current.status || item.status, message),
        });
      });
      this.setData({ messages }, () => this.scrollToBottom());
    },

    dramaPlanStatusText(status, fallback) {
      const labels = {
        queued: "镜头规划排队中",
        planning: "正在生成分镜、动作与声音计划",
        ready: "镜头规划已完成",
        submitted: "长镜头生成任务已提交",
        failed: "镜头规划失败",
      };
      return fallback || labels[status] || "正在准备镜头规划";
    },

    handleToggleDramaClip(event) {
      const messageId = String(event.currentTarget.dataset.messageId || "");
      const clipId = String(event.currentTarget.dataset.clipId || "");
      if (!messageId || !clipId || this.data.dramaSubmitting) return;
      const messages = this.data.messages.map((item) => {
        if (item.id !== messageId) return item;
        const selected = Array.isArray(item.selectedClipIds) ? item.selectedClipIds.slice() : [];
        const index = selected.indexOf(clipId);
        if (index >= 0) selected.splice(index, 1);
        else selected.push(clipId);
        return {
          ...item,
          selectedClipIds: selected,
          generationClips: (item.generationClips || []).map((clip) => ({
            ...clip,
            selected: selected.indexOf(clip.clipId) >= 0,
          })),
        };
      });
      this.setData({ messages });
    },

    handleGenerateSelectedDramaClips(event) {
      const messageId = String(event.currentTarget.dataset.messageId || "");
      const planId = String(event.currentTarget.dataset.planId || "");
      const message = this.data.messages.find((item) => item.id === messageId) || {};
      const selectedClipIds = Array.isArray(message.selectedClipIds) ? message.selectedClipIds : [];
      if (!selectedClipIds.length) {
        wx.showToast({ title: "请至少选择一个长镜头", icon: "none" });
        return;
      }
      this.startDramaSceneGeneration(planId, messageId, selectedClipIds);
    },

    startDramaSceneGeneration(planId, planMessageId, generationClipIds) {
      const selectedPlanId = String(planId || this.data.dramaScenePlanId || "");
      if (!selectedPlanId || this.data.dramaSubmitting) return;
      const videoMessage = this.decorateMessage({
        id: `drama_video_${Date.now()}`,
        role: "assistant",
        type: "drama-video",
        status: "queued",
        content: `正在分别生成 ${generationClipIds.length} 个长镜头，完成后自动拼接…`,
        progressMessage: "已提交长镜头生成与拼接任务",
        videoId: "",
        videoUrl: "",
      });
      this.setData(
        {
          dramaSubmitting: true,
          loadingReply: true,
          messages: [...this.data.messages, videoMessage],
        },
        () => this.scrollToBottom(),
      );
      api
        .generateDramaScenePlan(selectedPlanId, { audioEnabled: true, generationClipIds })
        .then((result) => {
          const videos = Array.isArray(result && result.videos) ? result.videos : [];
          const video = (result && result.video) || {};
          const assistant = (result && result.assistant) || {};
          if (!video.id) throw new Error("视频生成任务创建失败");
          console.info("[drama] scene.generate output", result);
          this.updateDramaVideoMessage(videoMessage.id, video, assistant.content);
          this.upsertDramaVideo(video);
          this.updateDramaPlanMessage(planMessageId, {
            id: selectedPlanId,
            status: "submitted",
          }, `已提交 ${videos.length} 个长镜头，正在生成并拼接。`);
          this.setData({ dramaScenePlanId: "" });
          if (video.id) this.pollDramaJob(video.id, videoMessage.id);
          wx.showToast({ title: `已开始生成 ${videos.length} 个长镜头`, icon: "none" });
        })
        .catch((error) => {
          console.error("[drama] scene.generate failed", error);
          this.updateDramaVideoMessage(videoMessage.id, {
            status: "failed",
            errorMessage: error.message || "视频生成任务提交失败",
          });
          wx.showToast({ title: error.message || "视频生成任务提交失败", icon: "none" });
        })
        .finally(() => {
          this.setData({ dramaSubmitting: false, loadingReply: false });
        });
    },

    pollDramaJob(videoId, messageId) {
      clearTimeout(this._dramaPollTimer);
      if (!videoId || !this.isDramaMode()) return;
      this._dramaPollingVideoId = videoId;
      api
        .getDramaJob(videoId)
        .then((result) => {
          const video = (result && result.video) || {};
          console.info("[drama] job.poll output", video);
          this.upsertDramaVideo(video);
          this.updateDramaVideoMessage(messageId, video);
          if (["completed", "failed", "reused"].indexOf(video.status) >= 0) {
            this.loadDramaVideos();
            return;
          }
          this._dramaPollTimer = setTimeout(() => {
            this.pollDramaJob(videoId, messageId);
          }, 5000);
        })
        .catch((error) => {
          console.warn("[drama] job.poll failed", { videoId, error });
          // 网络短暂失败不能终止服务端任务；继续以更慢的频率重试。
          this._dramaPollTimer = setTimeout(() => {
            this.pollDramaJob(videoId, messageId);
          }, 10000);
        });
    },

    updateDramaVideoMessage(messageId, video, assistantContent) {
      const current = video || {};
      const messages = this.data.messages.map((item) => {
        if (item.id !== messageId) return item;
        const status = current.status || item.status;
        const message = current.errorMessage || current.progressMessage || assistantContent || item.progressMessage || item.content;
        return this.decorateMessage({
          ...item,
          type: "drama-video",
          status,
          videoId: current.id || item.videoId,
          videoUrl: current.videoUrl || item.videoUrl || "",
          progressMessage: message,
          content: this.dramaStatusText(status, message),
        });
      });
      this.setData({ messages }, () => this.scrollToBottom());
    },

    dramaStatusText(status, fallback) {
      const labels = {
        queued: "剧创任务排队中",
        processing: "正在准备剧创素材",
        resolving_source: "正在定位原文",
        extracting_consistency: "正在提取一致性与画风",
        storyboarding: "正在生成分镜和音乐风格",
        submitting_video: "正在提交视频生成",
        generating_video: "视频生成中，通常需要几分钟",
        storing_video: "正在保存视频",
        completed: "视频已生成",
        reused: "已复用历史视频",
        failed: "视频生成失败",
      };
      return fallback || labels[status] || "剧创任务进行中";
    },

    upsertDramaVideo(video) {
      if (!video || !video.id) return;
      const videos = Array.isArray(this.data.dramaVideos)
        ? this.data.dramaVideos.slice()
        : [];
      const index = videos.findIndex((item) => item.id === video.id);
      if (index >= 0) videos[index] = { ...videos[index], ...video };
      else videos.unshift(video);
      this.setData({ dramaVideos: videos });
    },

    loadDramaVideos() {
      if (!this.isDramaMode() || !this.data.currentConversationId) {
        return Promise.resolve([]);
      }
      return api
        .listDramaVideos({
          bookId: this.bookId,
        })
        .then((videos) => {
          this.setData({ dramaVideos: videos });
          return videos;
        })
        .catch((error) => {
          console.warn("[drama] playlist load failed", error);
          return [];
        });
    },

    handleToggleDramaPlaylist() {
      const next = !this.data.showDramaPlaylist;
      this.setData({ showDramaPlaylist: next, showModeMenu: false });
      if (next) this.loadDramaVideos();
    },

    handlePlayDramaVideo(event) {
      const url = String((event.currentTarget.dataset || {}).url || "").trim();
      if (!url) return;
      this.setData({ dramaVideoUrl: api.toAbsoluteUrl(url) }, () => {
        const context = wx.createVideoContext("drama-video-player", this);
        context.requestFullScreen({ direction: 90 });
        // 全屏切换会短暂暂停 video；等切换稳定后只启动一次，避免
        // autoplay、play() 与 requestFullScreen() 相互中断。
        setTimeout(() => context.play(), 250);
      });
    },

    handleDramaFullscreenChange(event) {
      if (!event.detail || !event.detail.fullScreen) {
        this.setData({ dramaVideoUrl: "" });
      }
    },

    handleReuseDramaVideo(event) {
      const videoId = (event.currentTarget.dataset || {}).id;
      if (!videoId) return;
      api
        .reuseDramaVideo(videoId, {
          sessionId: this.data.dramaSessionId,
          conversationId: this.data.currentConversationId,
        })
        .then((result) => {
          this.upsertDramaVideo(result && result.video);
          this.loadDramaVideos();
          wx.showToast({ title: "已复用到当前对话", icon: "success" });
        })
        .catch((error) => {
          wx.showToast({ title: error.message || "复用失败", icon: "none" });
        });
    },

    syncChatIdentity() {
      const identity = loadIdentity();
      const displayName = identity
        ? String(identity.displayName || "").trim()
        : "";
      const rawAvatarUrl = identity
        ? String(identity.avatarUrl || "").trim()
        : "";
      const userAvatarUrl =
        rawAvatarUrl && rawAvatarUrl.indexOf("/uploads/") === 0
          ? api.toAbsoluteUrl(rawAvatarUrl)
          : rawAvatarUrl;
      const avatarText =
        displayName && displayName !== "微信用户"
          ? Array.from(displayName)[0] || "我"
          : "我";
      this.setData({
        identity,
        userAvatarUrl,
        userAvatarText: avatarText,
      });
    },

    syncOnShow() {
      this.syncChatIdentity();
    },

    showPrivacyPopup() {
      this.setData({ showPrivacyModal: true });
    },

    handleAgreePrivacy(event) {
      wx.setStorageSync("privacy_agreed", true);
      wx.setStorageSync("privacy_authorized_by_button", true);
      this.setData({ showPrivacyModal: false });
      getApp().resolvePrivacy(true, event);
      const action = this.pendingPrivacyAction;
      this.pendingPrivacyAction = null;
      if (typeof action === "function") {
        action();
      }
    },

    handleDisagreePrivacy(event) {
      this.pendingPrivacyAction = null;
      this.setData({ showPrivacyModal: false });
      getApp().resolvePrivacy(false, event);
    },

    initRecorder() {
      this.recorderManager = wx.getRecorderManager();
      this.recorderManager.onStart(() => {
        console.log("recorder start");
        this.voiceRecordStarting = false;
        this.setData({
          isRecording: true,
          voiceCancel: !!this.data.voiceCancel,
        });
        if (this.pendingVoiceStop) {
          const pending = this.pendingVoiceStop;
          this.pendingVoiceStop = null;
          this.voiceRecordingCancelled = pending.cancelled;
          this.voiceRecordingTooShort = pending.tooShort;
          this.recorderManager.stop();
        }
      });
      this.recorderManager.onStop((res) => {
        console.log("recorder stop", res);
        this.voiceRecordStarting = false;
        this.pendingVoiceStop = null;
        const cancelled = this.voiceRecordingCancelled || this.data.voiceCancel;
        const tooShort = this.voiceRecordingTooShort;
        this.voiceRecordingCancelled = false;
        this.voiceRecordingTooShort = false;
        this.voiceRecordStarting = false;
        this.pendingVoiceStop = null;
        this.setData({ isRecording: false, voiceCancel: false });
        if (cancelled) {
          wx.showToast({
            title: tooShort ? "说话时间太短" : "已取消发送",
            icon: "none",
          });
          return;
        }
        const { tempFilePath } = res;
        this.handleVoiceUpload(tempFilePath);
      });
      this.recorderManager.onError((err) => {
        console.error("recorder error", err);
        this.voiceRecordingCancelled = false;
        this.voiceRecordingTooShort = false;
        this.voiceRecordStarting = false;
        this.pendingVoiceStop = null;
        this.setData({ isRecording: false, voiceCancel: false });
        wx.showToast({ title: "录音失败", icon: "none" });
      });
    },

    handleToggleInputMode() {
      const nextInputMode =
        this.data.inputMode === "keyboard" ? "voice" : "keyboard";
      if (nextInputMode === "voice") {
        this.resetAudioPlayback("voice-input");
      }
      this.setData({
        inputMode: nextInputMode,
        isRecording: false,
        voiceCancel: false,
        showModeMenu: false,
      });
      wx.vibrateShort();
    },

    handleChooseImage() {
      if (
        this.data.imageUploading ||
        this.data.isRecording ||
        this.voiceRecordStarting
      ) {
        return;
      }
      this.setData({ showModeMenu: false });
      wx.chooseImage({
        count: 1,
        sizeType: ["compressed"],
        sourceType: ["album", "camera"],
        success: (res) => {
          const filePath = res.tempFilePaths && res.tempFilePaths[0];
          if (!filePath) {
            return;
          }
          this.handleImageCaptionUpload(filePath);
        },
        fail: (err) => {
          const errMsg = String((err && err.errMsg) || "");
          if (errMsg.indexOf("cancel") === -1) {
            console.warn("[chat] choose image failed", err);
            wx.showToast({ title: "选择图片失败", icon: "none" });
          }
        },
      });
    },

    handleImageCaptionUpload(filePath) {
      this.setData({ imageUploading: true });
      wx.showLoading({ title: "正在识别图片……", mask: true });
      api
        .captionImage(filePath)
        .then((result) => {
          console.log("[chat] image caption result", result);
          wx.showToast({ title: "图片结果已打印", icon: "none" });
        })
        .catch((err) => {
          console.error("[chat] image caption failed", err);
          wx.showToast({
            title: err.message || "图片识别失败",
            icon: "none",
          });
        })
        .finally(() => {
          wx.hideLoading();
          this.setData({ imageUploading: false });
        });
    },

    handleVoiceTap() {
      if (this.data.isRecording) {
        this.recorderManager.stop();
        return;
      }

      this.interruptReplyForVoiceInput();
      wx.vibrateShort();
      if (!wx.getStorageSync("privacy_authorized_by_button")) {
        this.requestPrivacyAuthorization(() => {
          this.startRecording();
        });
        return;
      }
      this.startRecording();
    },

    handleVoiceStart(event) {
      if (this.data.isRecording) {
        return;
      }

      this.voiceTouchActive = true;
      const permissionRequestId = (this.voicePermissionRequestId || 0) + 1;
      this.voicePermissionRequestId = permissionRequestId;
      const touch = event.touches && event.touches[0];
      this.voiceStartY = touch ? touch.clientY : 0;
      this.setData({ voiceCancel: false });

      // 按住说话即打断当前回复，随后直接进入录音流程。
      this.interruptReplyForVoiceInput();

      if (!wx.getStorageSync("privacy_authorized_by_button")) {
        this.voiceTouchActive = false;
        this.requestPrivacyAuthorization(() => {
          wx.showToast({ title: "请再次按住说话", icon: "none" });
        });
        return;
      }

      // Check recording permission before starting
      wx.getSetting({
        success: (res) => {
          if (
            !this.voiceTouchActive ||
            this.voicePermissionRequestId !== permissionRequestId
          ) {
            return;
          }
          const auth = res.authSetting["scope.record"];
          if (auth === false) {
            this.voiceTouchActive = false;
            // Explicitly denied, guide to settings
            wx.showModal({
              title: "需要录音权限",
              content: "您已禁用录音权限，请在设置中开启后使用语音功能",
              confirmText: "去设置",
              success: (res) => {
                if (res.confirm) {
                  wx.openSetting();
                }
              },
            });
            return;
          }

          // If undefined (not asked) or true (granted), proceed
          this.voiceRecordingCancelled = false;
          this.voiceRecordingTooShort = false;
          this.voiceStartAt = Date.now();
          wx.vibrateShort();
          this.startRecording();
        },
        fail: (error) => {
          if (this.voicePermissionRequestId !== permissionRequestId) {
            return;
          }
          this.voiceTouchActive = false;
          console.warn("[chat] get recording permission failed", error);
          wx.showToast({ title: "无法获取录音权限", icon: "none" });
        },
      });
    },

    interruptReplyForVoiceInput() {
      const wasLoadingReply = !!this.data.loadingReply;
      // 每次开始语音输入都结束当前回复代次，让尚未执行的旧回调立即失效。
      this._replyRunId = (this._replyRunId || 0) + 1;

      if (!wasLoadingReply) {
        this.resetAudioPlayback("voice-input");
        this.clearStreamState();
        return false;
      }

      // 先让旧请求的所有回调失效，再中止网络请求，避免 abort 的异步回调覆盖新一轮状态。
      const streamTask = this._streamRequestTask;
      this._streamRequestTask = null;
      if (streamTask && typeof streamTask.abort === "function") {
        try {
          streamTask.abort();
        } catch (error) {
          console.warn("[chat] interrupt reply failed", error);
        }
      }
      this.resetAudioPlayback("voice-input");

      clearTimeout(this._streamFlushTimer);
      this._streamFlushTimer = null;

      const messages = (this.data.messages || []).slice();
      let messageIndex = this._streamingMessageIndex;
      const indexedMessage = messages[messageIndex];
      if (!indexedMessage || indexedMessage.id !== this._streamingMessageId) {
        messageIndex = messages.findIndex(
          (item) => item.id === this._streamingMessageId,
        );
      }

      if (messageIndex >= 0) {
        const currentMessage = messages[messageIndex];
        const pendingContent = String(this._pendingStreamReply || "");
        const displayedContent = String(
          (currentMessage && currentMessage.content) || "",
        );
        // pendingContent 在真正收到正文后会一直保留；空 pending + “正在…”属于阶段提示，不算正文。
        const hasPartialReply =
          !!pendingContent.trim() ||
          (!!displayedContent.trim() &&
            !currentMessage.thinking &&
            !/^正在/.test(displayedContent.trim()));

        if (hasPartialReply) {
          const content = pendingContent || displayedContent;
          messages[messageIndex] = Object.assign({}, currentMessage, {
            content,
            renderBlocks: this.buildMessageBlocks("ai", content),
            loading: false,
            streaming: false,
            thinking: false,
            status:
              currentMessage.status === "generating"
                ? "interrupted"
                : currentMessage.status,
          });
        } else {
          // 尚未输出正文时移除空的“思考中/创作中”占位消息。
          messages.splice(messageIndex, 1);
        }
      }

      this.clearStreamState();
      this.setData(
        {
          messages,
          loadingReply: false,
          creativeGenerating: false,
          scrollWithAnimation: true,
          showScrollDownBtn: false,
          playingMessageId: "",
          audioLoadingMessageId: "",
        },
        () => {
          this.scrollToBottom(true);
        },
      );
      return true;
    },

    handleVoiceMove(event) {
      if (
        !this.data.isRecording &&
        !this.voiceRecordStarting &&
        !this.voiceTouchActive
      ) {
        return;
      }
      const touch = event.touches && event.touches[0];
      if (!touch) {
        return;
      }

      // 逻辑升级：区分上滑取消的灵敏度
      const deltaY = this.voiceStartY - touch.clientY;
      const isCancel = deltaY > 60; // 向上滑动超过 60 像素取消

      if (isCancel !== this.data.voiceCancel) {
        if (isCancel) {
          wx.vibrateShort();
        }
        this.setData({ voiceCancel: isCancel });
      }
    },

    handleVoiceEnd() {
      this.voiceTouchActive = false;
      this.voicePermissionRequestId = (this.voicePermissionRequestId || 0) + 1;
      if (!this.data.isRecording && !this.voiceRecordStarting) {
        return;
      }
      const duration = Date.now() - this.voiceStartAt;
      const tooShort = duration > 0 && duration < 500 && !this.data.voiceCancel;
      const cancelled = this.data.voiceCancel || tooShort;
      if (this.voiceRecordStarting) {
        this.pendingVoiceStop = { cancelled, tooShort };
        return;
      }
      this.voiceRecordingTooShort = tooShort;
      this.voiceRecordingCancelled = cancelled;
      this.recorderManager.stop();
    },

    handleVoiceCancel() {
      this.voiceTouchActive = false;
      this.voicePermissionRequestId = (this.voicePermissionRequestId || 0) + 1;
      if (!this.data.isRecording && !this.voiceRecordStarting) {
        return;
      }
      if (this.voiceRecordStarting) {
        this.pendingVoiceStop = { cancelled: true, tooShort: false };
        return;
      }
      this.voiceRecordingCancelled = true;
      this.recorderManager.stop();
    },

    requestPrivacyAuthorization(next, options) {
      this.pendingPrivacyAction = next;
      this.setData({
        privacyModalTitle: (options && options.title) || "隐私授权说明",
        privacyModalText:
          (options && options.text) ||
          "语音对话需要使用录音权限。请先同意隐私授权，再点击录音。",
      });
      this.showPrivacyPopup();
    },

    startRecording() {
      this.voiceRecordStarting = true;
      this.pendingVoiceStop = null;
      this.setData({ isRecording: true, voiceCancel: !!this.data.voiceCancel });
      this.recorderManager.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: "mp3",
      });
    },

    handleStopPropagation() {},

    handleVoiceUpload(filePath) {
      wx.showLoading({ title: "正在识别……", mask: true });
      api
        .speechToText(filePath)
        .then((text) => {
          wx.hideLoading();
          if (text) {
            if (this.data.chatMode === "creative") {
              this.submitCreativeRequest(text);
            } else if (this.isDramaMode()) {
              this.submitDramaAnswer(text);
            } else {
              this.sendMessage(text);
            }
          }
        })
        .catch((err) => {
          wx.hideLoading();
          wx.showToast({
            title: err.message || "识别失败",
            icon: "none",
          });
        });
    },

    disposeChat() {
      clearTimeout(this._scrollTailTimer);
      clearTimeout(this._streamFlushTimer);
      clearTimeout(this._autoScrollTimer);
      clearTimeout(this._ignoreStopTimer);
      clearTimeout(this._storyProgressSyncTimer);
      clearTimeout(this._dramaPollTimer);
      clearTimeout(this._dramaPlanPollTimer);
      this._replyRunId = (this._replyRunId || 0) + 1;
      if (
        this._streamRequestTask &&
        typeof this._streamRequestTask.abort === "function"
      ) {
        this._streamRequestTask.abort();
        this._streamRequestTask = null;
      }
      this.destroyAudioContext("component-detached");
    },

    createMessage(role, content, loading) {
      this.messageSeed += 1;
      return this.decorateMessage({
        id: `msg-${this.messageSeed}`,
        role,
        content,
        renderBlocks: this.buildMessageBlocks(role, content),
        loading: !!loading,
      });
    },

    isAssistantRole(role) {
      return role === "ai" || role === "assistant";
    },

    decorateMessage(message) {
      const role = message && message.role;
      const decorated = Object.assign({}, message, {
        isUser: role === "user",
        isAssistant: this.isAssistantRole(role),
      });

      // 处理二创消息的类型名称显示
      if (decorated.type === "creative" && decorated.creativeType) {
        const typeObj = this.data.creativeTypes.find(
          (t) => t.id === decorated.creativeType,
        );
        decorated.creativeTypeName = typeObj ? typeObj.name : "AI 二创";
      }

      return decorated;
    },

    getDisplayMessageContent(role, content) {
      const rawContent = String(content || "");
      if (role !== "user") {
        return rawContent;
      }
      // 兼容此前错误写入历史的书籍约束前缀；它是服务端上下文，不是用户说的话。
      return rawContent
        .replace(
          /^\s*【当前书籍：[^】]*】仅讲述当前书籍内容，不要引用其他书籍。\s*/,
          "",
        )
        .replace(/\s*回复精简\s*$/, "")
        .trim();
    },

    stripSimpleMarkdown(text) {
      return String(text || "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/^\s{0,3}#{1,4}\s+/gm, "")
        .trim();
    },

    buildInlineSegments(text) {
      const source = String(text || "");
      const segments = [];
      const pattern = /\*\*([^*]+)\*\*/g;
      let lastIndex = 0;
      let match = pattern.exec(source);

      while (match) {
        if (match.index > lastIndex) {
          const plain = source.slice(lastIndex, match.index);
          if (plain) {
            segments.push({ text: plain, strong: false });
          }
        }
        if (match[1]) {
          segments.push({ text: match[1], strong: true });
        }
        lastIndex = pattern.lastIndex;
        match = pattern.exec(source);
      }

      const tail = source.slice(lastIndex);
      if (tail) {
        segments.push({ text: tail, strong: false });
      }

      const nextSegments = segments.length
        ? segments
        : [{ text: source, strong: false }];
      return nextSegments.map((segment, index) =>
        Object.assign({ key: `seg-${index}` }, segment),
      );
    },

    parseStructuredList(text) {
      const source = String(text || "").replace(/\n+/g, " ");
      const pattern = /(^|[\s。；;：:])(\d+)[.、．]\s*/g;
      const matches = [];
      let match = pattern.exec(source);

      while (match) {
        matches.push({
          order: match[2],
          start: match.index + match[1].length,
          contentStart: pattern.lastIndex,
        });
        match = pattern.exec(source);
      }

      if (!matches.length) {
        return null;
      }

      const items = matches.map((item, index) => {
        const end =
          index + 1 < matches.length ? matches[index + 1].start : source.length;
        const raw = source.slice(item.contentStart, end).trim();
        const titleMatch = raw.match(
          /^\*\*([^*]+)\*\*\s*(?:——|--|[-—–:：])?\s*(.*)$/,
        );
        const splitMatch = titleMatch
          ? null
          : raw.match(/^(.{2,18}?)(?:——|--|：|:)\s*(.+)$/);
        const title = titleMatch
          ? titleMatch[1].trim()
          : splitMatch
            ? this.stripSimpleMarkdown(splitMatch[1])
            : "";
        const body = titleMatch
          ? this.stripSimpleMarkdown(titleMatch[2])
          : this.stripSimpleMarkdown(splitMatch ? splitMatch[2] : raw);

        return {
          key: `list-${item.order}-${index}`,
          order: item.order,
          title,
          body,
        };
      });

      return {
        prefix: source.slice(0, matches[0].start).trim(),
        items,
      };
    },

    pushParagraphBlock(blocks, text) {
      const content = String(text || "").trim();
      if (!content) {
        return;
      }
      // 使用内容哈希或序列号作为更稳定的 key，避免 streaming 时抖动
      const stableKey = `p-${blocks.length}-${content.length}`;
      blocks.push({
        key: stableKey,
        type: "paragraph",
        segments: this.buildInlineSegments(content),
      });
    },

    buildMessageBlocks(role, content) {
      if (!this.isAssistantRole(role)) {
        return [];
      }

      let source = String(content || "").trim();
      if (!source) {
        return [];
      }

      source = source.replace(/\r\n/g, "\n").replace(/\t/g, " ");
      const blocks = [];

      // 1. 处理引用块 (Callout) - 以 > 开头
      const lines = source.split("\n");
      let currentCallout = [];
      const processedLines = [];

      lines.forEach((line) => {
        if (line.startsWith(">")) {
          currentCallout.push(line.replace(/^>\s*/, ""));
        } else {
          if (currentCallout.length > 0) {
            blocks.push({
              key: `callout-${blocks.length}-${currentCallout.length}`,
              type: "callout",
              text: currentCallout.join("\n"),
            });
            currentCallout = [];
          }
          processedLines.push(line);
        }
      });
      if (currentCallout.length > 0) {
        blocks.push({
          key: `callout-${blocks.length}`,
          type: "callout",
          text: currentCallout.join("\n"),
        });
      }

      source = processedLines.join("\n").trim();
      if (!source) return blocks;

      // 2. 处理代码块 - 以 ``` 开头
      const codePattern = /```(?:\w+)?\n([\s\S]+?)```/g;
      let codeMatch;
      let lastIdx = 0;
      const finalSourceParts = [];

      while ((codeMatch = codePattern.exec(source)) !== null) {
        if (codeMatch.index > lastIdx) {
          finalSourceParts.push(source.slice(lastIdx, codeMatch.index));
        }
        blocks.push({
          key: `code-${blocks.length}-${codeMatch[1].length}`,
          type: "code",
          text: codeMatch[1].trim(),
        });
        lastIdx = codePattern.lastIndex;
      }
      finalSourceParts.push(source.slice(lastIdx));
      source = finalSourceParts.join("\n").trim();

      // 原有的标题、列表、段落处理逻辑
      const headingMatch =
        source.match(/^\s*(?:#{1,4}\s*)?\*\*([^*]+)\*\*\s*/) ||
        source.match(/^\s*#{1,4}\s+([^\n]+)\n?/);

      if (headingMatch) {
        blocks.push({
          key: "heading-0",
          type: "heading",
          text: this.stripSimpleMarkdown(headingMatch[1]),
        });
        source = source.slice(headingMatch[0].length).trim();
      }

      const sectionMatch = source.match(
        /^(主要内容|核心内容|章节要点|简要回答|回答)[:：]\s*/,
      );
      if (sectionMatch) {
        blocks.push({
          key: `section-${blocks.length}`,
          type: "section",
          text: sectionMatch[1],
        });
        source = source.slice(sectionMatch[0].length).trim();
      }

      const list = this.parseStructuredList(source);
      if (list && list.items.length) {
        this.pushParagraphBlock(blocks, list.prefix);
        blocks.push({
          key: `list-${blocks.length}`,
          type: "list",
          items: list.items,
        });
        return blocks;
      }

      source.split(/\n{2,}|\n(?=\S)/).forEach((paragraph) => {
        this.pushParagraphBlock(blocks, paragraph);
      });
      return blocks;
    },

    // ====================================================================
    // 2026-05-19: 重写加载逻辑，支持多对话
    // ====================================================================

    loadBookAndConversations() {
      this.syncChatIdentity();
      // 嵌入阅读器时，父页已经持有完整书籍数据。再次拉取并 setData 整本书会
      // 在 Pad 上与原文分页同时占用内存，故只保留聊天所需的轻量标题对象。
      if (this.properties.embedded) {
        const book = {
          id: this.bookId,
          title: String(this.properties.bookTitle || ""),
        };
        this.setData({ book });
        return this.loadConversations(book);
      }
      /* 加载书籍信息 + 对话列表 + 最近对话的消息 */
      api
        .getBookById(this.bookId)
        .then((book) => {
          this.setData({ book });
          return this.loadConversations(book);
        })
        .then(() => {
          if (this.initialText) {
            const q = this.initialText;
            this.initialText = "";
            setTimeout(() => {
              this.sendMessage(q);
            }, 500);
          }
        })
        .catch((error) => {
          console.error("loadChatBook failed:", error);
          wx.showToast({
            title: "加载书籍失败",
            icon: "none",
          });
        });
    },

    loadConversations(book) {
      /* 加载对话列表，自动选中最近活跃的对话或新建一个 */
      const bookTitle = book && book.title ? book.title : "";
      return api
        .listConversations(this.bookId, this.chatEntry, this.chatScene)
        .then((convs) => {
          const requestedBookId = String(this.bookId || "");
          const list = Array.isArray(convs) ? convs : [];
          const hasBookIdentity = list.some((item) =>
            String((item && item.bookId) || ""),
          );
          const scopedConversations = hasBookIdentity
            ? list.filter(
                (item) =>
                  String((item && item.bookId) || "") === requestedBookId,
              )
            : list;

          if (hasBookIdentity && scopedConversations.length !== list.length) {
            console.warn("[chat] ignored conversations from another book", {
              requestedBookId,
              receivedBookIds: list
                .map((item) => item && item.bookId)
                .filter(Boolean),
            });
          }

          if (scopedConversations.length > 0) {
            // 有已有对话 → 选中最近更新的一个
            const latest = scopedConversations[0];
            this.setData({
              conversations: scopedConversations,
              currentConversationId: latest.id,
              currentConversationTitle: latest.title,
            });
            return this.loadMessages(latest.id, bookTitle, latest.messages);
          }
          // 没有对话 → 自动新建一个
          return this.createAndSelectConversation(bookTitle);
        })
        .catch((error) => {
          console.error("loadConversations failed:", error);
          // 降级：显示欢迎消息
          const welcomeMessage = this.createMessage(
            "ai",
            this.getWelcomeMessage(bookTitle),
          );
          this.setData(
            {
              messages: [welcomeMessage],
              loadingMessages: false,
            },
            () => {
              this.scrollToBottom(true);
            },
          );
        });
    },

    loadMessages(conversationId, bookTitle, presetMessages) {
      /* 加载指定对话的历史消息 */
      const messagesPromise = Array.isArray(presetMessages)
        ? Promise.resolve(presetMessages)
        : api.getConversationMessages(conversationId);
      return messagesPromise
        .then((messages) => {
          const formatted = messages.map((m) => {
            const content = this.getDisplayMessageContent(m.role, m.content);
            return this.decorateMessage({
              id: m.id,
              role: m.role,
              content,
              renderBlocks: this.buildMessageBlocks(m.role, content),
              loading: false,
            });
          });
          if (formatted.length === 0) {
            // 空对话 → 显示欢迎消息
            const welcomeMessage = this.createMessage(
              "ai",
              this.getWelcomeMessage(bookTitle),
            );
            formatted.push(welcomeMessage);
          }
          this.setData(
            {
              messages: formatted,
              loadingMessages: false, // 关闭骨架屏
            },
            () => {
              this.scrollToBottom(true);
            },
          );
          this.initialized = true;
        })
        .catch((error) => {
          console.error("loadMessages failed:", error);
          const welcomeMessage = this.createMessage(
            "ai",
            this.getWelcomeMessage(bookTitle),
          );
          this.setData(
            {
              messages: [welcomeMessage],
              loadingMessages: false, // 关闭骨架屏
            },
            () => {
              this.scrollToBottom(true);
            },
          );
          this.initialized = true;
        });
    },

    createAndSelectConversation(bookTitle) {
      /* 创建新对话并选中 */
      const title =
        this.chatEntry === "story"
          ? "讲故事"
          : this.chatEntry === "creative"
            ? "二次创作"
            : this.chatEntry === "drama"
              ? "剧创视频"
            : undefined;
      return api
        .createConversation(this.bookId, title, this.chatEntry, this.chatScene)
        .then((conv) => {
          const presetMessages = Array.isArray(conv && conv.messages)
            ? conv.messages
            : [];
          this.setData({
            conversations: [conv],
            currentConversationId: conv.id,
            currentConversationTitle: conv.title,
          });
          if (presetMessages.length) {
            return this.loadMessages(conv.id, bookTitle, presetMessages);
          }
          const welcomeMessage = this.createMessage(
            "ai",
            this.getWelcomeMessage(bookTitle),
          );
          this.setData(
            {
              messages: [welcomeMessage],
              loadingMessages: false, // 新对话创建完也关闭骨架屏
            },
            () => {
              this.scrollToBottom(true);
            },
          );
          this.initialized = true;
        });
    },

    handleBack() {
      wx.navigateBack({
        fail: () => {
          wx.switchTab({
            url: "/pages/index/index",
          });
        },
      });
    },

    // ====================================================================
    // 对话切换 (2026-05-19 新增)
    // ====================================================================

    handleToggleConversationList() {
      /* 展开/收起对话切换面板 */
      this.setData({
        showConversationList: !this.data.showConversationList,
        showModeMenu: false,
      });
    },

    handleNewConversation() {
      /* 新建对话并切换到新对话 */
      if (this.data.loadingReply) {
        return;
      }
      this.resetAudioPlayback();
      const book = this.data.book;
      const bookTitle = book && book.title ? book.title : "";
      wx.showLoading({ title: "创建中……", mask: true });
      this.createAndSelectConversation(bookTitle)
        .then(() => {
          wx.hideLoading();
          this.setData({ showConversationList: false });
        })
        .catch((err) => {
          wx.hideLoading();
          console.error("handleNewConversation failed:", err);
          wx.showToast({ title: err.message || "创建对话失败", icon: "none" });
        });
    },

    handleClearConversations() {
      if (this.data.loadingReply) {
        return;
      }
      wx.showModal({
        title: "清空对话",
        content:
          "将删除这本书当前入口的对话记录，并重置对应的智能会话。此操作不可恢复。",
        confirmText: "清空",
        confirmColor: "#d64545",
        success: (res) => {
          if (!res.confirm) {
            return;
          }
          const book = this.data.book;
          const bookTitle = book && book.title ? book.title : "";
          this.resetAudioPlayback();
          wx.showLoading({ title: "清空中……", mask: true });
          api
            .clearConversations(this.bookId, this.chatEntry, this.chatScene)
            .then(() => this.createAndSelectConversation(bookTitle))
            .then(() => {
              wx.hideLoading();
              this.setData({ showConversationList: false });
              wx.showToast({ title: "已清空", icon: "success" });
            })
            .catch((err) => {
              wx.hideLoading();
              console.error("handleClearConversations failed:", err);
              wx.showToast({ title: err.message || "清空失败", icon: "none" });
            });
        },
      });
    },

    handleSwitchConversation(event) {
      /* 切换到指定的对话 */
      if (this.data.loadingReply) {
        return;
      }
      const convId = event.currentTarget.dataset.id;
      const convTitle = event.currentTarget.dataset.title || "新对话";
      if (convId === this.data.currentConversationId) {
        // 已在当前对话，收起面板
        this.setData({ showConversationList: false });
        return;
      }
      // 切换对话时重置音频状态
      this.resetAudioPlayback();
      const book = this.data.book;
      const bookTitle = book && book.title ? book.title : "";
      this.setData({
        currentConversationId: convId,
        currentConversationTitle: convTitle,
        showConversationList: false,
        messages: [],
      });

      api
        .getConversationMessages(convId)
        .then((messages) => {
          const formatted = messages.map((m) => {
            const content = this.getDisplayMessageContent(m.role, m.content);
            return this.decorateMessage({
              id: m.id,
              role: m.role,
              content,
              renderBlocks: this.buildMessageBlocks(m.role, content),
              loading: false,
            });
          });
          if (formatted.length === 0) {
            const welcomeMessage = this.createMessage(
              "ai",
              this.getWelcomeMessage(bookTitle),
            );
            formatted.push(welcomeMessage);
          }
          this.setData(
            {
              messages: formatted,
            },
            () => {
              this.scrollToBottom(true);
              if (this.isDramaMode()) {
                this.loadDramaVideos();
              }
            },
          );
        })
        .catch((error) => {
          console.error("switch conversation failed:", error);
          const welcomeMessage = this.createMessage(
            "ai",
            this.getWelcomeMessage(bookTitle),
          );
          this.setData(
            {
              messages: [welcomeMessage],
            },
            () => {
              this.scrollToBottom(true);
            },
          );
        });
    },

    handleScroll(e) {
      const { scrollTop, scrollHeight, clientHeight } = e.detail;
      const isScrolled = scrollTop > 20;

      // 判断 user 是否主动上滑离开了底部（阈值 80rpx）
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      const userScrolledUp = distanceFromBottom > 80;
      // 流式输出造成的程序滚动也会触发 bindscroll，这里只在用户触摸或非流式状态下更新用户滚动状态。
      const shouldTrackUserScroll =
        this._userTouchingChat || !this.data.loadingReply;
      if (
        shouldTrackUserScroll &&
        userScrolledUp !== this.data.userHasScrolledUp
      ) {
        this.setData({
          userHasScrolledUp: userScrolledUp,
          showScrollDownBtn: userScrolledUp && this.data.loadingReply,
        });
      }
      if (isScrolled !== this.data.scrolled) {
        this.setData({ scrolled: isScrolled });
      }
    },

    handleChatTouchStart() {
      // 用户开始拖动消息区时暂停自动跟随，避免新 token 把页面强行拉回底部。
      this._userTouchingChat = true;
    },

    handleChatTouchEnd() {
      // 等滚动惯性基本结束后再恢复自动跟随判断，减少触摸结束瞬间的误判。
      setTimeout(() => {
        this._userTouchingChat = false;
        if (this.data.loadingReply && !this.data.userHasScrolledUp) {
          this.scheduleAutoScroll();
        }
      }, 160);
    },

    handleInput(event) {
      this.setData(
        this.buildComposerState({
          inputValue: event.detail.value,
        }),
      );
    },

    handleQuickQuestion(event) {
      if (this._isHandlingSend) return;
      this._isHandlingSend = true;
      setTimeout(() => {
        this._isHandlingSend = false;
      }, 500);
      this.setData({ showModeMenu: false });

      const question = event.currentTarget.dataset.question;
      if (this.data.chatMode === "creative") {
        this.submitCreativeRequest(question);
      } else if (this.isDramaMode()) {
        if (question === "查看播放列表") {
          this.handleToggleDramaPlaylist();
        } else {
          this.startDramaSession();
        }
      } else {
        this.sendMessage(question);
      }
    },

    handleSend() {
      // 增加一个即时锁，防止 bindconfirm 和 bindtap 几乎同时触发导致的重复发送
      if (this._isHandlingSend) return;
      this._isHandlingSend = true;
      setTimeout(() => {
        this._isHandlingSend = false;
      }, 500);

      const content = this.data.inputValue;
      if (!content || !content.trim()) {
        this._isHandlingSend = false;
        return;
      }
      this.setData({ showModeMenu: false });

      // 如果是二创模式，走专门的二创请求逻辑
      if (this.data.chatMode === "creative") {
        this.setData({ inputValue: "" });
        this.submitCreativeRequest(content);
        return;
      }
      if (this.isDramaMode()) {
        this.setData(this.buildComposerState({ inputValue: "", inputLineCount: 1 }));
        this.submitDramaAnswer(content);
        return;
      }

      this.sendMessage(content);
    },

    normalizeInputLineCount(lineCount) {
      const nextCount = Number(lineCount || 1);
      if (!Number.isFinite(nextCount) || nextCount < 1) {
        return 1;
      }
      return Math.min(nextCount, 5);
    },

    buildComposerState(overrides) {
      const nextInputValue = Object.prototype.hasOwnProperty.call(
        overrides || {},
        "inputValue",
      )
        ? overrides.inputValue
        : this.data.inputValue;
      const nextKeyboardHeight = Object.prototype.hasOwnProperty.call(
        overrides || {},
        "keyboardHeight",
      )
        ? overrides.keyboardHeight
        : this.data.keyboardHeight;
      const nextInputLineCount = this.normalizeInputLineCount(
        Object.prototype.hasOwnProperty.call(overrides || {}, "inputLineCount")
          ? overrides.inputLineCount
          : this.data.inputLineCount,
      );
      const shouldShowQuickQueries =
        !String(nextInputValue || "").trim() && nextKeyboardHeight === 0;
      const composerPlaceholderRpx =
        (shouldShowQuickQueries ? 240 : 156) +
        Math.max(0, nextInputLineCount - 1) * 44;

      return Object.assign({}, overrides || {}, {
        inputLineCount: nextInputLineCount,
        isInputExpanded: nextInputLineCount > 1,
        composerPlaceholderRpx,
      });
    },

    handleKeyboardHeightChange(event) {
      const keyboardHeight = Math.max(0, Number(event.detail.height || 0));
      this.setData(
        this.buildComposerState({
          keyboardHeight,
        }),
        () => {
          if (keyboardHeight > 0) {
            this.scrollToBottom();
          }
        },
      );
    },

    handleInputLineChange(event) {
      const lineCount = event && event.detail ? event.detail.lineCount : 1;
      this.setData(
        this.buildComposerState({
          inputLineCount: lineCount,
        }),
        () => {
          if (this.data.isInputExpanded) {
            this.scrollToBottom();
          }
        },
      );
    },

    handleFocus() {
      this.setData({
        isInputFocused: true,
        showModeMenu: false,
      });
    },

    handleBlur() {
      this.setData({
        isInputFocused: false,
        keyboardHeight: 0,
      });
    },

    handleInputBlur() {
      if (!this.data.keyboardHeight) {
        return;
      }

      this.setData(
        this.buildComposerState({
          keyboardHeight: 0,
        }),
      );
    },

    ensureAudioContext() {
      if (this.audioContext) {
        return this.audioContext;
      }

      const audio = wx.createInnerAudioContext();
      // 对长连接 MP3，Android 微信会在 canplay 前后自行启动 autoplay。
      // 此时再显式调用 play() 会报“audio is playing, don't play again”。
      audio.autoplay = true;
      audio.obeyMuteSwitch = false;

      audio.onCanplay(() => {
        if (
          audio !== this.audioContext ||
          !this.isAudioLoading ||
          !this.currentAudioMessageId
        ) {
          return;
        }
        const token = this.audioPlayToken;
        if (this._audioCanplayToken === token) {
          return;
        }
        this._audioCanplayToken = token;
        this.updateLastAudioAttempt({ canplayAt: Date.now() });
        console.info("[chat] audio canplay; waiting for autoplay", {
          ...this.audioDiagnostics(),
          token,
        });
      });

      audio.onPlay(() => {
        if (audio !== this.audioContext || !this.currentAudioMessageId) {
          try {
            audio.stop();
          } catch (error) {
            console.warn("[chat] stale audio stop failed", error);
          }
          return;
        }
        this.isAudioPlaying = true;
        this.isAudioLoading = false;
        clearTimeout(this._audioLoadTimeout);
        this._audioStartRetryCount = 0;
        this.currentAudioStartedAt = Date.now();
        this.updateLastAudioAttempt({ startedAt: this.currentAudioStartedAt });
        console.info("[chat] audio output started", this.audioDiagnostics());
        this.setData({
          playingMessageId: this.currentAudioMessageId,
          audioLoadingMessageId: "",
        });
      });

      audio.onEnded(() => {
        if (audio !== this.audioContext) {
          return;
        }
        console.info("[chat] audio ended", this.audioDiagnostics());
        this.finishCurrentAudio(true);
      });

      audio.onStop(() => {
        if (audio !== this.audioContext) {
          return;
        }
        if (this.ignoreNextStopEvent) {
          console.info(
            "[chat] audio stop acknowledged",
            this.audioDiagnostics(),
          );
          return;
        }
        this.updateLastAudioAttempt({ stoppedAt: Date.now() });
        if (this.isAudioLoading && !this.isAudioPlaying) {
          console.warn(
            "[chat] audio stopped before output started, retrying",
            this.audioDiagnostics(),
          );
          this.retryCurrentAudioPlayback(
            "stopped-before-play",
            this.audioPlayToken,
          );
          return;
        }
        console.info("[chat] audio stopped", this.audioDiagnostics());
        this.finishCurrentAudio(false);
      });

      audio.onPause(() => {
        if (audio !== this.audioContext) {
          return;
        }
        if (this.ignoreNextStopEvent) {
          console.info(
            "[chat] audio pause acknowledged",
            this.audioDiagnostics(),
          );
          return;
        }
        this.updateLastAudioAttempt({ pausedAt: Date.now() });
        if (this.isAudioLoading && !this.isAudioPlaying) {
          console.warn(
            "[chat] audio paused before output started, retrying",
            this.audioDiagnostics(),
          );
          this.retryCurrentAudioPlayback(
            "paused-before-play",
            this.audioPlayToken,
          );
          return;
        }
        console.info("[chat] audio paused", this.audioDiagnostics());
        this.finishCurrentAudio(false);
      });

      audio.onError((error) => {
        if (audio !== this.audioContext) {
          return;
        }
        this.updateLastAudioAttempt({
          erroredAt: Date.now(),
          errorCode: error && error.errCode,
          errorMessage: (error && (error.errMsg || error.message)) || "",
        });
        const diagnostics = this.audioDiagnostics(error);
        if (this.isAlreadyPlayingAudioError(error)) {
          console.info(
            "[chat] duplicate play request ignored; audio is already playing",
            diagnostics,
          );
          return;
        }
        if (this.isExpectedAudioStop(error)) {
          console.info("[chat] audio stop acknowledged", diagnostics);
          return;
        }
        console.error("[chat] audio error", diagnostics);
        if (this.isAudioLoading && this.currentAudioMessageId) {
          this.retryCurrentAudioPlayback(
            "audio-error",
            this.audioPlayToken,
            error,
          );
          return;
        }
        if (!this.currentAudioMessageId) {
          console.info("[chat] stale audio error ignored", diagnostics);
          return;
        }
        this.skipCurrentAudioPlayback("audio-error-after-play");
      });

      this.audioContext = audio;
      return audio;
    },

    startAudioPlayback(messageId, audioUrl, options = {}) {
      const source = api.toAbsoluteUrl(audioUrl) || audioUrl;
      if (!messageId || !source) {
        return;
      }

      const retry = !!options.retry;
      const token = this.audioPlayToken + 1;
      const assignedAt = Date.now();
      clearTimeout(this._audioLoadTimeout);
      this.audioPlayToken = token;
      this._audioCanplayToken = 0;
      this.currentAudioMessageId = messageId;
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = true;
      this._currentAudioSource = source;
      this._audioResetReason = "";
      if (!retry) {
        this._audioStartRetryCount = 0;
      }
      this._lastAudioAttempt = {
        messageId,
        source,
        token,
        assignedAt,
        canplayAt: 0,
        startedAt: 0,
        retryCount: this._audioStartRetryCount,
        trigger: options.trigger || "tts",
      };

      const loadingMessageId =
        options.loadingMessageId === undefined
          ? messageId
          : options.loadingMessageId;
      this.setData({
        playingMessageId: messageId,
        audioLoadingMessageId: loadingMessageId,
      });

      const audio = this.ensureAudioContext();
      audio.autoplay = true;
      console.info("[chat] tts audio source assigned", this.audioDiagnostics());
      audio.src = source;
      // 这个定时器实际保护的是“已设置音源，但尚未进入 onPlay”，不能再叫 load timeout。
      this._audioLoadTimeout = setTimeout(() => {
        if (
          this.audioPlayToken !== token ||
          !this.isAudioLoading ||
          this.currentAudioMessageId !== messageId
        ) {
          return;
        }
        this.updateLastAudioAttempt({
          timedOutAt: Date.now(),
          failureStage: "play-start-timeout",
        });
        console.warn(
          "[chat] audio play-start timeout, rebuilding player",
          this.audioDiagnostics(),
        );
        this.retryCurrentAudioPlayback("play-start-timeout", token);
      }, 15000);
    },

    retryCurrentAudioPlayback(reason, token, error) {
      if (
        token !== this.audioPlayToken ||
        !this.isAudioLoading ||
        !this.currentAudioMessageId ||
        !this._currentAudioSource
      ) {
        return;
      }

      const messageId = this.currentAudioMessageId;
      const source = this._currentAudioSource;
      clearTimeout(this._audioLoadTimeout);
      this.updateLastAudioAttempt({
        retryReason: reason,
        retryErrorCode: error && error.errCode,
        retryErrorMessage: (error && (error.errMsg || error.message)) || "",
      });

      if (this._audioStartRetryCount >= 1) {
        console.error("[chat] audio failed after player rebuild, skipping", {
          ...this.audioDiagnostics(error),
          retryReason: reason,
        });
        this.skipCurrentAudioPlayback("player-rebuild-failed");
        return;
      }

      this._audioStartRetryCount += 1;
      this._audioResetReason = reason;
      this.updateLastAudioAttempt({
        resetAt: Date.now(),
        resetReason: reason,
      });
      console.warn("[chat] rebuilding audio context for retry", {
        ...this.audioDiagnostics(error),
        retryReason: reason,
        retryCount: this._audioStartRetryCount,
      });

      const staleAudio = this.audioContext;
      // 先断开引用，旧实例之后发出的 stop/error 事件会被 handler 忽略。
      this.audioContext = null;
      if (staleAudio) {
        try {
          staleAudio.stop();
        } catch (stopError) {
          console.warn(
            "[chat] stale audio stop failed during retry",
            stopError,
          );
        }
        try {
          staleAudio.destroy();
        } catch (destroyError) {
          console.warn(
            "[chat] stale audio destroy failed during retry",
            destroyError,
          );
        }
      }

      clearTimeout(this._audioRetryTimer);
      const retryCount = this._audioStartRetryCount;
      this._audioRetryTimer = setTimeout(() => {
        if (
          !this.isAudioLoading ||
          this.currentAudioMessageId !== messageId ||
          this._currentAudioSource !== source ||
          this._audioStartRetryCount !== retryCount
        ) {
          return;
        }
        this.startAudioPlayback(messageId, source, {
          retry: true,
          trigger: "player-rebuild-retry",
          loadingMessageId: messageId,
        });
      }, 150);
    },

    skipCurrentAudioPlayback(reason) {
      clearTimeout(this._audioLoadTimeout);
      clearTimeout(this._audioRetryTimer);
      this.updateLastAudioAttempt({
        skippedAt: Date.now(),
        failureStage: reason,
      });
      const staleAudio = this.audioContext;
      this.audioContext = null;
      if (staleAudio) {
        try {
          staleAudio.stop();
        } catch (error) {
          console.warn("[chat] audio stop failed while skipping", error);
        }
        try {
          staleAudio.destroy();
        } catch (error) {
          console.warn("[chat] audio destroy failed while skipping", error);
        }
      }
      this.currentAudioMessageId = "";
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = false;
      this._currentAudioSource = "";
      this._audioStartRetryCount = 0;
      this.setData({ playingMessageId: "", audioLoadingMessageId: "" });
      this.playNextIfIdle();
    },

    updateLastAudioAttempt(patch) {
      if (!this._lastAudioAttempt) {
        return;
      }
      this._lastAudioAttempt = Object.assign({}, this._lastAudioAttempt, patch);
    },

    finishCurrentAudio(reportMetrics) {
      const duration = this.currentAudioStartedAt
        ? Date.now() - this.currentAudioStartedAt
        : 0;
      const finishedMessageId = this.currentAudioMessageId;
      const finishedAudioSource = this._currentAudioSource;

      this.currentAudioMessageId = "";
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = false;
      clearTimeout(this._audioLoadTimeout);
      clearTimeout(this._audioRetryTimer);
      this.updateLastAudioAttempt({
        completedAt: Date.now(),
        completedDuration: duration,
      });

      // 如果还有待播放的段或正在生成的段，保持 loading 状态不变
      const pendingCount =
        (this.pendingTTSQueue && this.pendingTTSQueue.length) || 0;
      const hasMore =
        this.generatingCount > 0 ||
        pendingCount > 0 ||
        this.readyMap.hasOwnProperty(this.nextPlaySeq);
      if (!hasMore) {
        this.setData({ playingMessageId: "", audioLoadingMessageId: "" });
      }

      if (reportMetrics && duration > 0) {
        api.reportVoicePlay(duration);
      }

      if (finishedMessageId) {
        console.info("[chat] audio output completed", {
          ...this.audioDiagnostics(),
          finishedMessageId,
          finishedAudioSource,
          duration,
          reportMetrics: !!reportMetrics,
        });
      }
      this._currentAudioSource = "";

      this.playNextIfIdle();
    },

    destroyAudioContext(reason = "destroy-audio-context") {
      clearTimeout(this._audioRetryTimer);
      if (!this.audioContext) {
        this.resetAudioState();
        return;
      }
      this._audioResetReason = reason;
      this.updateLastAudioAttempt({
        resetAt: Date.now(),
        resetReason: reason,
      });
      this.ignoreNextStopEvent = true;
      console.info(
        "[chat] audio context destroy requested",
        this.audioDiagnostics(),
      );
      this.audioContext.stop();
      this.audioContext.destroy();
      this.audioContext = null;
      this.resetAudioState();
    },

    resetAudioState() {
      this.currentAudioMessageId = "";
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = false;
      this.audioQueue = [];
      this.readyMap = {};
      this.pendingTTSQueue = [];
      this.nextPlaySeq = 0;
      this.nextGenSeq = 0;
      this.generatingCount = 0;
      this.streamSpeechBuffer = "";
      this.speechSegmentCount = 0;
      this._usingServerTtsStream = false;
      this._currentAudioSource = "";
      clearTimeout(this._audioLoadTimeout);
      clearTimeout(this._audioRetryTimer);
      this._audioCanplayToken = 0;
      this._audioStartRetryCount = 0;
      this.audioPlayToken += 1;
      this.setData({
        playingMessageId: "",
        audioLoadingMessageId: "",
      });
    },

    resetAudioPlayback(reason = "reset-audio-playback") {
      // 递增播放纪元，让飞行中的 TTS Promise 和服务端语音回调识别为过期数据。
      this.playbackEpoch += 1;
      this.audioQueue = [];
      this.readyMap = {};
      this.pendingTTSQueue = [];
      this.nextPlaySeq = 0;
      this.nextGenSeq = 0;
      this.generatingCount = 0;
      this.streamSpeechBuffer = "";
      this.speechSegmentCount = 0;
      this._usingServerTtsStream = false;
      clearTimeout(this._audioLoadTimeout);
      clearTimeout(this._audioRetryTimer);
      this.audioPlayToken += 1;
      this._audioResetReason = reason;
      this.updateLastAudioAttempt({
        resetAt: Date.now(),
        resetReason: reason,
      });
      if (this.audioContext) {
        const audio = this.audioContext;
        this.ignoreNextStopEvent = true;
        console.info("[chat] audio reset requested", this.audioDiagnostics());
        try {
          audio.stop();
        } catch (error) {
          console.warn("[chat] audio stop failed during reset", error);
        }
        try {
          audio.destroy();
        } catch (error) {
          console.warn("[chat] audio destroy failed during reset", error);
        }
        this.audioContext = null;
        // 延迟清除标记，确保 onStop 和 onPause（无论触发顺序）都被拦截
        clearTimeout(this._ignoreStopTimer);
        this._ignoreStopTimer = setTimeout(() => {
          this.ignoreNextStopEvent = false;
          this._audioResetReason = "";
        }, 200);
      }
      this._currentAudioSource = "";
      this.currentAudioMessageId = "";
      this.currentAudioStartedAt = 0;
      this.isAudioPlaying = false;
      this.isAudioLoading = false;
      this._audioCanplayToken = 0;
      this._audioStartRetryCount = 0;
      this.setData({
        playingMessageId: "",
        audioLoadingMessageId: "",
      });
    },

    audioDiagnostics(error) {
      const detail = error || {};
      const attempt = this._lastAudioAttempt;
      return {
        messageId: this.currentAudioMessageId || "",
        source: this._currentAudioSource || "",
        playbackEpoch: this.playbackEpoch,
        audioPlayToken: this.audioPlayToken,
        isAudioLoading: !!this.isAudioLoading,
        isAudioPlaying: !!this.isAudioPlaying,
        ignoreNextStopEvent: !!this.ignoreNextStopEvent,
        resetReason: this._audioResetReason || "",
        environment: this.getAudioEnvironment(),
        errorCode: detail.errCode !== undefined ? detail.errCode : undefined,
        errorMessage: detail.errMsg || detail.message || "",
        lastAttempt: attempt
          ? Object.assign({}, attempt, {
              ageMs: attempt.assignedAt ? Date.now() - attempt.assignedAt : 0,
              canplayDelayMs:
                attempt.canplayAt && attempt.assignedAt
                  ? attempt.canplayAt - attempt.assignedAt
                  : 0,
              startDelayMs:
                attempt.startedAt && attempt.assignedAt
                  ? attempt.startedAt - attempt.assignedAt
                  : 0,
            })
          : null,
      };
    },

    getAudioEnvironment() {
      try {
        const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
        return {
          platform: info.platform || "",
          system: info.system || "",
          version: info.version || "",
          SDKVersion: info.SDKVersion || "",
          deviceType: info.deviceType || "",
          deviceOrientation: info.deviceOrientation || "",
          windowWidth: info.windowWidth || 0,
          windowHeight: info.windowHeight || 0,
          screenWidth: info.screenWidth || 0,
          screenHeight: info.screenHeight || 0,
        };
      } catch (error) {
        return {
          readFailed: true,
          errorMessage: (error && error.message) || String(error || ""),
        };
      }
    },

    isExpectedAudioStop(error) {
      const detail = this.audioDiagnostics(error);
      return (
        !!(this.ignoreNextStopEvent || this._audioResetReason) &&
        /(?:errcode\s*:\s*504|player\s+to\s+stop)/i.test(detail.errorMessage)
      );
    },

    isAlreadyPlayingAudioError(error) {
      const detail = this.audioDiagnostics(error);
      return /audio\s+is\s+playing[\s,;]+don'?t\s+play\s+again/i.test(
        detail.errorMessage,
      );
    },

    shouldFlushSpeechBuffer(text, force) {
      const content = String(text || "").trim();
      if (!content) {
        return false;
      }
      if (force) {
        return true;
      }

      // 首段尽早切出，优先降低“点发送到听见声音”的等待时间。
      if (this.speechSegmentCount === 0 && content.length >= 12) {
        return true;
      }

      const punctuationCount = (content.match(/[。！？!?]/g) || []).length;
      // 遇到句末标点就切（一句一段，更流畅）
      if (punctuationCount >= 1 && content.length >= 10) {
        return true;
      }
      // 硬上限 80 字
      if (content.length >= 80) {
        return true;
      }
      return false;
    },

    appendSpeechSegment(messageId, segment, force) {
      const content = String(segment || "");
      if (!content) {
        return;
      }

      this.streamSpeechBuffer = `${this.streamSpeechBuffer}${content}`;
      if (
        !this.shouldFlushSpeechBuffer(this.streamSpeechBuffer.trim(), !!force)
      ) {
        return;
      }

      // 按句子边界切分 buffer，避免一次性把几百字当一个 chunk 发给 TTS
      const fullText = this.streamSpeechBuffer.trim();
      this.streamSpeechBuffer = "";
      if (!fullText) {
        return;
      }

      const chunks = this._splitIntoSpeechChunks(fullText);
      for (let i = 0; i < chunks.length; i += 1) {
        this.speechSegmentCount += 1;
        this.enqueueAudioChunk(messageId, chunks[i]);
      }
    },

    /**
     * 将文本按句子边界切分为适合 TTS 的 chunk（每段不超过 80 字）。
     * 优先在句末标点处切分；超长无标点段按逗号或硬上限切。
     */
    _splitIntoSpeechChunks(text) {
      const maxLen = 80;
      if (text.length <= maxLen) {
        return [text];
      }

      const chunks = [];
      // 先按句末标点切分
      const sentences = text.split(/(?<=[。！？!?\n])/);
      let current = "";

      for (let i = 0; i < sentences.length; i += 1) {
        const s = sentences[i];
        if (!s) continue;
        if ((current + s).length <= maxLen) {
          current += s;
        } else {
          if (current) chunks.push(current);
          // 单句超长时按逗号或硬上限再切
          if (s.length > maxLen) {
            const sub = s.split(/(?<=[，,；;：:])/);
            let buf = "";
            for (let j = 0; j < sub.length; j += 1) {
              if ((buf + sub[j]).length <= maxLen) {
                buf += sub[j];
              } else {
                if (buf) chunks.push(buf);
                buf = sub[j].length > maxLen ? sub[j].slice(0, maxLen) : sub[j];
                // 如果单个子句仍超长，硬切
                if (sub[j].length > maxLen) {
                  chunks.push(buf);
                  let rest = sub[j].slice(maxLen);
                  while (rest.length > maxLen) {
                    chunks.push(rest.slice(0, maxLen));
                    rest = rest.slice(maxLen);
                  }
                  buf = rest;
                }
              }
            }
            current = buf;
          } else {
            current = s;
          }
        }
      }
      if (current) chunks.push(current);
      return chunks.filter(Boolean);
    },

    flushSpeechBuffer(messageId) {
      const remaining = String(this.streamSpeechBuffer || "").trim();
      this.streamSpeechBuffer = "";
      if (!remaining) {
        return;
      }
      const chunks = this._splitIntoSpeechChunks(remaining);
      for (let i = 0; i < chunks.length; i += 1) {
        this.speechSegmentCount += 1;
        this.enqueueAudioChunk(messageId, chunks[i]);
      }
    },

    enqueueAssistantSpeech(messageId, text) {
      const content = String(text || "").trim();
      if (!messageId || !content) {
        return;
      }
      this.ensureAudioContext();
      const chunks = this._splitIntoSpeechChunks(content);
      console.info("[chat] assistant speech enqueue", {
        messageId,
        chars: content.length,
        chunks: chunks.length,
      });
      for (let i = 0; i < chunks.length; i += 1) {
        this.speechSegmentCount += 1;
        this.enqueueAudioChunk(messageId, chunks[i]);
      }
    },

    /**
     * 直接将已生成的音频 URL 入队播放（服务端 TTS 模式）。
     * 跳过前端 TTS 请求，直接放入 readyMap。
     */
    enqueueReadyAudio(messageId, audioUrl) {
      if (!audioUrl) return;
      const streamMatch = String(audioUrl).match(
        /\/api\/chat\/tts-stream\/([^/?#]+)/i,
      );
      if (streamMatch) {
        const streamId = streamMatch[1];
        if (this._seenServerTtsStreams.has(streamId)) {
          console.warn("[chat] duplicate TTS stream ignored", {
            messageId,
            streamId,
            audioUrl,
          });
          return;
        }
        this._seenServerTtsStreams.add(streamId);
      }
      const seq = this.nextGenSeq;
      this.nextGenSeq += 1;
      this.readyMap[seq] = { messageId, audioUrl };
      this.setData({ audioLoadingMessageId: messageId });
      this.playNextIfIdle();
    },

    playStreamingAudio(messageId, audioUrl) {
      this.startAudioPlayback(messageId, audioUrl, {
        trigger: "streaming-audio",
        loadingMessageId: messageId,
      });
    },

    enqueueAudioChunk(messageId, text) {
      const content = String(text || "").trim();
      if (!content) {
        return;
      }

      // 分配序号，放入待生成队列
      const seq = this.nextGenSeq;
      this.nextGenSeq += 1;
      if (!this.pendingTTSQueue) this.pendingTTSQueue = [];
      this.pendingTTSQueue.push({ seq, messageId, text: content });
      this.drainTTSQueue();
    },

    /** 限制并发 TTS 请求数量，避免后端串行排队导致超时 */
    drainTTSQueue() {
      const maxConcurrent = 2;
      if (!this.pendingTTSQueue || !this.pendingTTSQueue.length) {
        return;
      }
      if (this.generatingCount >= maxConcurrent) {
        return;
      }
      const item = this.pendingTTSQueue.shift();
      this.generateAudio(item.seq, item.messageId, item.text);
    },

    generateAudio(seq, messageId, text) {
      const epoch = this.playbackEpoch;
      this.generatingCount += 1;
      this.setData({ audioLoadingMessageId: messageId });

      const startedAt = Date.now();
      console.info("[chat] tts input", {
        seq,
        messageId,
        text,
        textLength: String(text || "").length,
        playbackEpoch: epoch,
      });
      const requestPromise = api.requestSpeech(text);

      // 增加前端超时保护，防止单次 TTS 请求卡死队列
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TTS_TIMEOUT")), 10000),
      );

      Promise.race([requestPromise, timeoutPromise])
        .then(({ audioUrl, cached, size }) => {
          // 播放已被重置，丢弃过期结果
          if (this.playbackEpoch !== epoch) {
            return;
          }
          this.generatingCount -= 1;
          console.info("[chat] tts output ready", {
            seq,
            messageId,
            text,
            chars: String(text || "").length,
            audioUrl,
            cached,
            size,
            duration: Date.now() - startedAt,
          });
          // 按序号存入 readyMap
          this.readyMap[seq] = { messageId, audioUrl };
          this.drainTTSQueue();
          this.playNextIfIdle();
        })
        .catch((error) => {
          // 播放已被重置，丢弃过期错误
          if (this.playbackEpoch !== epoch) {
            return;
          }
          console.error("[chat] tts request failed", {
            seq,
            messageId,
            text,
            textLength: String(text || "").length,
            playbackEpoch: epoch,
            errorCode: error && error.code,
            errorMessage: error && error.message,
            error,
          });
          this.generatingCount -= 1;

          // 遇到 503 或超时，静默跳过此段，保证对话流不卡死
          this.readyMap[seq] = null;
          this.drainTTSQueue();
          this.playNextIfIdle();

          // 如果是严重错误，给用户一个轻提示
          if (
            error.message === "TTS_TIMEOUT" ||
            error.code === "SERVICE_UNAVAILABLE"
          ) {
            console.warn("TTS 服务繁忙，已跳过当前段落朗读");
          }
        });
    },

    playNextIfIdle() {
      if (this.isAudioPlaying || this.isAudioLoading) {
        return;
      }

      // 跳过失败的段（null）
      while (
        this.readyMap.hasOwnProperty(this.nextPlaySeq) &&
        this.readyMap[this.nextPlaySeq] === null
      ) {
        delete this.readyMap[this.nextPlaySeq];
        this.nextPlaySeq += 1;
      }

      const next = this.readyMap[this.nextPlaySeq];
      if (!next) {
        // 下一段还没生成好，等它回来再播
        const pendingCount =
          (this.pendingTTSQueue && this.pendingTTSQueue.length) || 0;
        if (this.generatingCount === 0 && pendingCount === 0) {
          this.setData({ audioLoadingMessageId: "" });
        }
        return;
      }

      delete this.readyMap[this.nextPlaySeq];
      this.nextPlaySeq += 1;

      this.startAudioPlayback(next.messageId, next.audioUrl, {
        trigger: "queued-tts",
        loadingMessageId: this.generatingCount > 0 ? next.messageId : "",
      });
    },

    processAudioQueue() {
      this.playNextIfIdle();
    },

    handleSpeakMessage(event) {
      const dataset = event.currentTarget.dataset || {};
      const { id } = dataset;
      const message = this.data.messages.find((item) => item.id === id);
      const loading = (message && message.loading) || dataset.loading;
      const content = String(
        (message && message.content) || dataset.content || "",
      ).trim();
      if (!id || loading) {
        return;
      }
      if (!content) {
        wx.showToast({
          title: "暂无可朗读内容",
          icon: "none",
        });
        return;
      }

      if (
        this.data.playingMessageId === id ||
        this.data.audioLoadingMessageId === id
      ) {
        this.resetAudioPlayback();
        return;
      }

      this.resetAudioPlayback();
      this.enqueueAssistantSpeech(id, content);
    },

    handleCopyMessage(event) {
      const dataset = event.currentTarget.dataset || {};
      const messageId = dataset.id;
      const message = this.data.messages.find((item) => item.id === messageId);
      const content = String(
        (message && message.content) || dataset.content || "",
      ).trim();
      if (!content) {
        wx.showToast({
          title: "暂无可复制内容",
          icon: "none",
        });
        return;
      }
      this.copyMessageContent(content);
    },

    copyMessageContent(content) {
      const doCopy = () => {
        wx.setClipboardData({
          data: content,
          success: () => {
            wx.showToast({
              title: "已复制",
              icon: "success",
            });
          },
          fail: (error) => {
            console.error("[chat] copy message failed", error);
            wx.showToast({
              title:
                error && error.errno === 112
                  ? "请先在隐私指引声明剪贴板用途"
                  : "复制失败",
              icon: "none",
            });
          },
        });
      };

      if (typeof wx.requirePrivacyAuthorize !== "function") {
        doCopy();
        return;
      }

      wx.requirePrivacyAuthorize({
        success: doCopy,
        fail: (error) => {
          console.error("[chat] clipboard privacy authorize failed", error);
          if (error && error.errno === 112) {
            wx.showToast({
              title: "请先在隐私指引声明剪贴板用途",
              icon: "none",
            });
            return;
          }
          this.requestPrivacyAuthorization(doCopy, {
            title: "复制授权说明",
            text: "复制消息需要写入系统剪贴板。请先同意隐私授权，再点击复制。",
          });
        },
      });
    },

    sendMessage(rawText) {
      const message = String(rawText || "").trim();
      if (!message) {
        wx.showToast({
          title: "请输入问题",
          icon: "none",
        });
        return;
      }
      if (this.data.loadingReply) {
        return;
      }

      const replyRunId = (this._replyRunId || 0) + 1;
      this._replyRunId = replyRunId;
      this.resetAudioPlayback();
      this.ensureAudioContext();
      this._storyProgressSyncId = (this._storyProgressSyncId || 0) + 1;
      this._storyStateAppliedForStream = false;

      // 书籍、模式和章节均通过独立字段发送；不能把内部约束拼进 message，
      // 否则后端保存会话后会把它当成用户输入回显。
      const serverQuestion = `${message}\n回复精简`;
      const userMessage = this.createMessage("user", message);
      // 创建带有思考状态的 AI 消息
      const loadingMessage = this.decorateMessage({
        id: `msg-ai-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        role: "assistant",
        content: "",
        renderBlocks: [],
        loading: true,
        streaming: true,
        thinking: true, // 初始开启思考动画
      });
      const messages = this.data.messages.concat([userMessage, loadingMessage]);
      // 记录本轮流式回复所在的消息，后续只更新这一条，避免每个 token 重建整个 messages 数组。
      this._streamingMessageIndex = messages.length - 1;
      this._streamingMessageId = loadingMessage.id;
      this._pendingStreamReply = "";
      this._lastFlushedStreamReply = "";
      this._usingServerTtsStream = false;
      clearTimeout(this._streamFlushTimer);
      clearTimeout(this._autoScrollTimer);

      this.setData(
        Object.assign(
          {
            messages,
            loadingReply: true,
            // 流式期间关闭滚动动画，防止动画被高频重启导致页面卡住或抢滚动。
            scrollWithAnimation: false,
            userHasScrolledUp: false,
            showScrollDownBtn: false,
          },
          this.buildComposerState({
            inputValue: "",
            inputLineCount: 1,
          }),
        ),
        () => {
          this.scrollToBottom(true);
        },
      );

      if (this.isCreativeMode()) {
        this.sendCreativeMessage(message, replyRunId);
        return;
      }

      const convId = this.data.currentConversationId;
      // 路由传入的书籍 ID 是当前阅读页的权威标识，不能让历史对象里的
      // bookKey 覆盖它，否则会把会话上下文错误地切到另一部书。
      const chatBookId =
        this.bookId || (this.data.book && this.data.book.id) || "";
      const streamPlaybackEpoch = this.playbackEpoch;
      const streamPromise = api.sendBookChatMessageStream(
        chatBookId,
        serverQuestion,
        {
          conversationId: convId,
          entry: this.chatEntry,
          scene: this.chatScene,
          chapterId: this.data.chapterId,
          chapterTitle: this.data.chapterTitle,
          tts: true,
          onTtsStream: (stream) => {
            if (
              this._replyRunId !== replyRunId ||
              this.playbackEpoch !== streamPlaybackEpoch
            ) {
              return;
            }
            this._usingServerTtsStream = true;
            // 长回复会收到多个音频片段。不能用新的 src 覆盖正在播放的片段，
            // 否则会截断尾字并让句子中间出现长停顿；统一复用既有顺序队列。
            this.enqueueReadyAudio(loadingMessage.id, stream.audioUrl);
          },
          onState: (state) => {
            if (this._replyRunId !== replyRunId) {
              return;
            }
            if (this.isStoryMode()) {
              this._storyProgressSyncId = (this._storyProgressSyncId || 0) + 1;
              this._storyStateAppliedForStream = true;
              this.applyStoryProgressState(state);
            }
          },
          onSegment: (segment, fullReply) => {
            if (this._replyRunId !== replyRunId) {
              return;
            }
            this._pendingStreamReply = fullReply;
            this.scheduleStreamFlush();
          },
        },
      );
      // 保存引用，供语音打断或页面卸载时中止尚未完成的请求。
      this._streamRequestTask = streamPromise;
      streamPromise
        .then((result) => {
          if (this._replyRunId !== replyRunId) {
            return;
          }
          if (this._streamRequestTask === streamPromise) {
            this._streamRequestTask = null;
          }
          const finalReply = result.reply || "";
          if (this.isStoryMode() && !this._storyStateAppliedForStream) {
            if (result && result.state) {
              this._storyStateAppliedForStream = true;
              this.applyStoryProgressState(result.state);
            }
          }
          this._pendingStreamReply = finalReply;
          this.flushStreamReply(true);
          this.setData(
            {
              loadingReply: false,
              scrollWithAnimation: true,
            },
            () => {
              if (this._replyRunId !== replyRunId) {
                return;
              }
              this.clearStreamState();
              if (!this.data.userHasScrolledUp) {
                this.scrollToBottom();
              }
            },
          );
        })
        .catch((error) => {
          if (this._replyRunId !== replyRunId) {
            return;
          }
          console.error("[chat] stream failed:", error);
          if (this._streamRequestTask === streamPromise) {
            this._streamRequestTask = null;
          }
          this.streamSpeechBuffer = "";
          this._usingServerTtsStream = false;
          const errorMessage =
            error && error.message ? String(error.message) : "";
          const failedContent =
            this._pendingStreamReply ||
            (errorMessage
              ? `暂时无法获取回答：${errorMessage}`
              : "暂时无法获取回答，请稍后重试。");
          this._pendingStreamReply = failedContent;
          this.flushStreamReply(true);
          this.setData(
            {
              loadingReply: false,
              scrollWithAnimation: true,
              audioLoadingMessageId: "",
            },
            () => {
              if (this._replyRunId !== replyRunId) {
                return;
              }
              this.clearStreamState();
              if (!this.data.userHasScrolledUp) {
                this.scrollToBottom();
              }
            },
          );
        });
    },

    sendCreativeMessage(message, replyRunId) {
      const activeReplyRunId = replyRunId || this._replyRunId;
      const convId = this.data.currentConversationId;
      const book = this.data.book || {};
      const bookId = this.bookId || book.id || book.bookId || "";
      const replyFallback = "暂时没有生成内容，请换个角度再试试。";
      const messageId = this._streamingMessageId;

      const creativePromise = api.generateCreativeWorkStream(
        {
          bookId,
          userPrompt: message,
          chapterId: this.data.chapterId,
          originalText: this.getCreativeOriginalText(),
          type: this.data.creativeType,
        },
        {
          onPhase: (phase) => {
            if (this._replyRunId !== activeReplyRunId) {
              return;
            }
            if (this._pendingStreamReply) {
              return;
            }
            this._pendingStreamReply = String(
              (phase && phase.message) || "正在检索原著素材...",
            );
            this.flushStreamReply(true);
            this._pendingStreamReply = "";
            this._lastFlushedStreamReply = "";
          },
          onSegment: (segment, fullReply) => {
            if (this._replyRunId !== activeReplyRunId) {
              return;
            }
            this._pendingStreamReply = fullReply;
            this.scheduleStreamFlush();
          },
        },
      );
      this._streamRequestTask = creativePromise;

      creativePromise
        .then((work) => {
          if (this._replyRunId !== activeReplyRunId) {
            return null;
          }
          const savedWork = work && work.work;
          const reply = String(
            (work && (work.reply || work.answer)) ||
              (savedWork && savedWork.content) ||
              replyFallback,
          ).trim();
          const finalReply = reply || replyFallback;
          this._pendingStreamReply = finalReply;
          this.flushStreamReply(true);
          this.enqueueAssistantSpeech(messageId, finalReply);
          return api
            .appendConversationMessages(convId, [
              { role: "user", content: message },
              { role: "assistant", content: finalReply },
            ])
            .catch((error) => {
              console.warn("[chat] creative history save failed:", error);
              return null;
            });
        })
        .then(() => {
          if (this._replyRunId !== activeReplyRunId) {
            return;
          }
          if (this._streamRequestTask === creativePromise) {
            this._streamRequestTask = null;
          }
          this.setData(
            {
              loadingReply: false,
              scrollWithAnimation: true,
            },
            () => {
              if (this._replyRunId !== activeReplyRunId) {
                return;
              }
              this.clearStreamState();
              if (!this.data.userHasScrolledUp) {
                this.scrollToBottom();
              }
            },
          );
        })
        .catch((error) => {
          if (this._replyRunId !== activeReplyRunId) {
            return;
          }
          console.error(
            "[chat] creative generate failed:",
            {
              message: error && error.message,
              errMsg: error && error.errMsg,
              statusCode: error && error.statusCode,
              code: error && error.code,
              requestId: error && error.requestId,
              elapsedMs: error && error.elapsedMs,
              timeout: error && error.timeout,
              requestUrl: error && error.requestUrl,
            },
            error,
          );
          if (this._streamRequestTask === creativePromise) {
            this._streamRequestTask = null;
          }
          const errorMessage =
            error && (error.message || error.errMsg || error.statusCode)
              ? String(
                  error.message || error.errMsg || `HTTP ${error.statusCode}`,
                )
              : "";
          this._pendingStreamReply = errorMessage
            ? `暂时无法完成二次创作：${errorMessage}`
            : "暂时无法完成二次创作，请稍后重试。";
          this.flushStreamReply(true);
          this.setData(
            {
              loadingReply: false,
              scrollWithAnimation: true,
              audioLoadingMessageId: "",
            },
            () => {
              if (this._replyRunId !== activeReplyRunId) {
                return;
              }
              this.clearStreamState();
              if (!this.data.userHasScrolledUp) {
                this.scrollToBottom();
              }
            },
          );
        });
    },

    scheduleStreamFlush() {
      // 同一时间只允许一个刷新定时器，把多个 token 合并成一次 setData。
      if (this._streamFlushTimer) {
        return;
      }
      const replyRunId = this._replyRunId;
      const flushTimer = setTimeout(() => {
        if (
          this._replyRunId !== replyRunId ||
          this._streamFlushTimer !== flushTimer
        ) {
          return;
        }
        this.flushStreamReply();
      }, 60); // 微调刷新率，实现更细腻的打字机感
      this._streamFlushTimer = flushTimer;
    },

    flushStreamReply(force = false) {
      clearTimeout(this._streamFlushTimer);
      this._streamFlushTimer = null;

      const content = String(this._pendingStreamReply || "");
      if (!force && content === this._lastFlushedStreamReply) {
        return;
      }

      let messageIndex = this._streamingMessageIndex;
      const target = this.data.messages[messageIndex];
      if (!target || target.id !== this._streamingMessageId) {
        messageIndex = this.data.messages.findIndex(
          (item) => item.id === this._streamingMessageId,
        );
        this._streamingMessageIndex = messageIndex;
      }
      if (messageIndex < 0) {
        return;
      }

      this._lastFlushedStreamReply = content;
      const replyRunId = this._replyRunId;
      // 只更新最后一条助手消息的字段，降低小程序 JS 层到视图层的数据传输量。
      this.setData(
        {
          [`messages[${messageIndex}].content`]: content,
          [`messages[${messageIndex}].renderBlocks`]: this.buildMessageBlocks(
            "ai",
            content,
          ),
          [`messages[${messageIndex}].thinking`]: false, // 收到内容，关闭思考动画
          [`messages[${messageIndex}].loading`]: !force,
        },
        () => {
          if (this._replyRunId !== replyRunId) {
            return;
          }
          this.scheduleAutoScroll();
        },
      );
    },

    clearStreamState() {
      // 本轮回答结束后清掉所有流式定时器和临时状态，避免影响下一轮提问。
      clearTimeout(this._streamFlushTimer);
      clearTimeout(this._autoScrollTimer);
      clearTimeout(this._scrollTailTimer);
      this._streamFlushTimer = null;
      this._autoScrollTimer = null;
      this._scrollTailTimer = null;
      this._pendingStreamReply = "";
      this._lastFlushedStreamReply = "";
      this._streamingMessageIndex = -1;
      this._streamingMessageId = "";
    },

    scheduleAutoScroll() {
      // 用户正在查看上方内容时不自动跟随，只显示“新内容”按钮。
      if (this.data.userHasScrolledUp || this._userTouchingChat) {
        return;
      }
      if (this._autoScrollTimer) {
        return;
      }
      this._autoScrollTimer = setTimeout(() => {
        this._autoScrollTimer = null;
        this.scrollToBottom();
      }, 160);
    },

    scrollToBottom(force = false) {
      // force: 强制滚动（用户点击按钮、流式结束）
      // 非强制时，用户正在上滑查看则不打断
      if (!force && (this.data.userHasScrolledUp || this._userTouchingChat)) {
        return;
      }

      // 流式期间节流：最多 120ms 滚一次
      const now = Date.now();
      if (
        !force &&
        this.data.loadingReply &&
        now - this.lastScrollToBottomTime < 120
      ) {
        return;
      }
      this.lastScrollToBottomTime = now;

      if (!this.data.messages.length) {
        return;
      }
      // scroll-top 绑定相同值时不会触发滚动，递增一个足够大的值来稳定滚到底部。
      this._scrollTop += 100000;
      this.setData({
        scrollTop: this._scrollTop,
      });
    },

    handleScrollDownTap() {
      this.setData({
        userHasScrolledUp: false,
        showScrollDownBtn: false,
      });
      this.scrollToBottom(true);
    },

    _resetScrollState() {
      clearTimeout(this._scrollTailTimer);
      clearTimeout(this._autoScrollTimer);
      this._scrollTailTimer = null;
      this._autoScrollTimer = null;
      this.lastScrollToBottomTime = 0;
      this.setData({
        userHasScrolledUp: false,
        showScrollDownBtn: false,
      });
    },
  },
});
