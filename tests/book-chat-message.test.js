const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('sends exactly the question shown to the user, without a hidden Chinese hint', () => {
  let component
  let sentMessage
  // Leave the request pending so this test only exercises message construction.
  const api = {
    toAbsoluteUrl: (url) => url,
    sendBookChatMessageStream: (bookId, message) => {
      sentMessage = message
      return new Promise(() => {})
    },
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../components/book-chat/book-chat.js'), 'utf8'), {
    require: (name) => name.endsWith('/api') ? api : {},
    Component: (value) => { component = value },
    clearTimeout,
  })
  const reader = {
    data: { messages: [], currentConversationId: 'conversation', book: { id: 'book' } },
    resetAudioPlayback() {},
    ensureAudioContext() {},
    createMessage: (role, content) => ({ role, content }),
    decorateMessage: (message) => message,
    buildComposerState: (state) => state,
    setData(data, callback) { Object.assign(this.data, data); callback() },
    scrollToBottom() {},
    isCreativeMode: () => false,
  }
  component.methods.sendMessage.call(reader, 'tell me about this book')
  assert.equal(sentMessage, 'tell me about this book')
  assert.equal(sentMessage, reader.data.messages[0].content)
})
