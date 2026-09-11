const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup(overrides = {}) {
  let component
  let sheet
  const storage = new Map()
  const timers = []
  const api = {
    toAbsoluteUrl: (url) => url ? `https://example.com${url}` : '',
    ...overrides,
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/book-chat/book-chat.js'), 'utf8'), {
    require: (name) => name.endsWith('/api') ? api : {},
    Component: (value) => { component = value },
    wx: {
      showActionSheet: (options) => { sheet = options },
      showToast() {},
      setStorageSync: (key, value) => storage.set(key, value),
      getStorageSync: (key) => storage.get(key),
    },
    console: { log() {}, warn() {}, error() {} },
    clearTimeout() {},
    setTimeout: (callback) => { timers.push(callback); return timers.length },
  })
  const reader = {
    ...component.methods,
    bookId: 'book',
    properties: {},
    data: {
      currentConversationId: 'conversation', chapterId: 'chapter',
      backgroundImage: '/old.png', backgroundSource: 'chapter',
      messages: [{ id: 'plan-message', scenePlanId: 'plan', status: 'ready', selectedClipIds: ['clip-2'] }],
    },
    setData(data, callback) { Object.assign(this.data, data); if (callback) callback() },
    decorateMessage: (message) => message,
    scrollToBottom() {},
  }
  return { reader, storage, timers, sheet: () => sheet }
}

const selectionEvent = { currentTarget: { dataset: { messageId: 'plan-message', planId: 'plan' } } }
const flush = () => new Promise((resolve) => setImmediate(resolve))

test('selection opens both choices without submitting; video retains the selected clip IDs', () => {
  const { reader, sheet } = setup()
  let video
  reader.startDramaSceneGeneration = (...args) => { video = args }
  reader.startDramaSceneImageGeneration = () => assert.fail('unexpected image submission')
  reader.handleGenerateSelectedDramaClips(selectionEvent)
  assert.deepEqual(Array.from(sheet().itemList), ['生成视频', '生成场景图'])
  assert.equal(video, undefined)
  sheet().success({ tapIndex: 0 })
  sheet().complete()
  assert.equal(video[0], 'plan')
  assert.equal(video[1], 'plan-message')
  assert.deepEqual(Array.from(video[2]), ['clip-2'])
  assert.equal(reader._dramaChoosingTarget, false)
})

test('scene images can use the entire plan even when no video clips are selected; cancel does nothing', () => {
  const { reader, sheet } = setup()
  let imagePlan
  reader.data.messages[0].selectedClipIds = []
  reader.startDramaSceneGeneration = () => assert.fail('unexpected video submission')
  reader.startDramaSceneImageGeneration = (planId) => { imagePlan = planId }
  reader.handleGenerateSelectedDramaClips(selectionEvent)
  sheet().complete()
  assert.equal(imagePlan, undefined)
  reader.handleGenerateSelectedDramaClips(selectionEvent)
  sheet().success({ tapIndex: 1 })
  assert.equal(imagePlan, 'plan')
})

test('completion replaces and saves the background, ignoring an older chapter image response', async () => {
  let resolveChapter
  const { reader, storage } = setup({
    generateImage: () => new Promise((resolve) => { resolveChapter = resolve }),
    generateDramaSceneImage: async () => ({ sceneImage: { status: 'queued' } }),
    getDramaScenePlan: async () => ({ scenePlan: { sceneImage: { status: 'completed', image: { imageUrl: '/scene.png' } } } }),
  })
  reader.generateChatBackground('book', 'chapter')
  await reader.startDramaSceneImageGeneration('plan')
  await flush()
  assert.equal(reader.data.backgroundImage, 'https://example.com/scene.png')
  assert.equal(reader.data.backgroundSource, 'scene')
  assert.equal(reader.data.dramaImageGenerating, false)
  assert.equal(storage.get(reader.dramaSceneBackgroundKey('conversation')).imageUrl, reader.data.backgroundImage)
  resolveChapter({ imageUrl: '/late-chapter.png' })
  await flush()
  assert.equal(reader.data.backgroundImage, 'https://example.com/scene.png')
})

test('failed images preserve the previous background and remain retryable', async () => {
  const { reader } = setup({ generateDramaSceneImage: async () => { throw new Error('模型暂不可用') } })
  await reader.startDramaSceneImageGeneration('plan')
  assert.equal(reader.data.backgroundImage, '/old.png')
  assert.equal(reader.data.dramaImageGenerating, false)
  assert.equal(reader.data.messages.at(-1).status, 'failed')
  assert.equal(reader.data.messages.at(-1).scenePlanId, 'plan')
  assert.equal(reader.data.messages.at(-1).content, '模型暂不可用')
})

test('an accepted submission is recoverable if the user changes conversations while it is pending', async () => {
  let accept
  const { reader, storage } = setup({
    generateDramaSceneImage: () => new Promise((resolve) => { accept = resolve }),
  })
  const request = reader.startDramaSceneImageGeneration('plan')
  reader.data.currentConversationId = 'different'
  accept({ sceneImage: { status: 'queued' } })
  await request
  assert.equal(reader.data.backgroundImage, '/old.png')
  assert.equal(storage.get(reader.dramaSceneBackgroundKey('conversation')).pendingPlanId, 'plan')
  assert.equal(storage.has(reader.dramaSceneBackgroundKey('different')), false)
})

test('a response for a different conversation or a disposed component cannot replace its background', () => {
  const { reader } = setup()
  const run = reader.beginDramaSceneImageRun('plan')
  reader.data.currentConversationId = 'different'
  reader.applyDramaSceneImageJob(run, { status: 'completed', image: { imageUrl: '/wrong.png' } })
  assert.equal(reader.data.backgroundImage, '/old.png')
  reader.data.currentConversationId = 'conversation'
  reader._chatDisposed = true
  reader.applyDramaSceneImageJob(run, { status: 'completed', image: { imageUrl: '/wrong.png' } })
  assert.equal(reader.data.backgroundImage, '/old.png')
})

test('restoring a conversation resumes its pending image and preserves the previous scene until completion', async () => {
  const { reader, storage } = setup({
    getDramaScenePlan: async () => ({ scenePlan: { sceneImage: { status: 'completed', image: { imageUrl: '/new.png' } } } }),
  })
  storage.set(reader.dramaSceneBackgroundKey('conversation'), { imageUrl: '/saved.png', pendingPlanId: 'plan' })
  reader.restoreDramaSceneBackground()
  assert.equal(reader.data.backgroundImage, '/saved.png')
  await flush()
  assert.equal(reader.data.backgroundImage, 'https://example.com/new.png')
  assert.equal(storage.get(reader.dramaSceneBackgroundKey('conversation')).pendingPlanId, undefined)
})

test('temporary polling failures retry, while removed tasks stop polling', async () => {
  let requests = 0
  const { reader, timers } = setup({
    getDramaScenePlan: async () => {
      requests++
      if (requests === 1) throw new Error('offline')
      throw Object.assign(new Error('任务不存在'), { statusCode: 404 })
    },
  })
  const run = reader.beginDramaSceneImageRun('plan')
  await reader.pollDramaSceneImage(run)
  assert.equal(timers.length, 1)
  await timers[0]()
  assert.equal(timers.length, 1)
  assert.equal(reader.data.dramaImageGenerating, false)
  assert.equal(reader.data.backgroundImage, '/old.png')
  assert.equal(reader.data.messages.at(-1).status, 'failed')
})
