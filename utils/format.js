// 格式化工具模块 - 提供价格、日期、状态等常见格式化方法

/** 个位数补零 */
function pad(value) {
  return value < 10 ? `0${value}` : `${value}`
}

/** 格式化价格为 ¥xx.xx */
function formatPrice(price) {
  return `¥${Number(price || 0).toFixed(2)}`
}

/** 格式化日期为 xxxx.xx.xx 格式 */
function formatDate(dateText) {
  if (!dateText) {
    return '暂无记录'
  }
  return String(dateText).replace(/-/g, '.')
}

/** 格式化相对阅读时间（今天/昨天/具体日期） */
function formatRelativeReadTime(dateText) {
  if (!dateText) {
    return "Not started";
  }

  const now = new Date();
  const target = new Date(dateText.replace(/-/g, "/"));
  const diff = now.getTime() - target.getTime();
  const day = 24 * 60 * 60 * 1000;

  if (diff < day) {
    return "Read today";
  }
  if (diff < day * 2) {
    return "Read yesterday";
  }
  return `Read on ${formatDate(dateText)}`;
}

/** 获取当前时间的格式化字符串 yyyy-MM-dd HH:mm */
function formatNow() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/** 获取建库状态的显示文本和主题色 */
function getBuildStatusMeta(status) {
  const map = {
    none: { text: "Unindexed", theme: "neutral" },
    building: { text: "Indexing", theme: "warning" },
    done: { text: "Indexed", theme: "success" },
    failed: { text: "Failed", theme: "danger" },
  }
  return map[status] || map.none
}

/** 获取上下架状态的显示文本和主题色 */
function getOnlineStatusMeta(status) {
  const map = {
    online: { text: "Published", theme: "success" },
    offline: { text: "Draft", theme: "neutral" },
  }
  return map[status] || map.offline
}

/** 获取购买状态的显示文本和主题色（兼容多种真值表示） */
function getPurchaseStatusMeta(purchased) {
  const purchasedFlag = purchased === true
    || purchased === 'true'
    || purchased === '1'
    || purchased === 1
    || purchased === 'yes'
    || purchased === 'purchased'

  return purchasedFlag
    ? { text: "In Library", theme: "primary" }
    : { text: "Available", theme: "neutral" }
}

module.exports = {
  formatDate,
  formatNow,
  formatPrice,
  formatRelativeReadTime,
  getBuildStatusMeta,
  getOnlineStatusMeta,
  getPurchaseStatusMeta,
}
