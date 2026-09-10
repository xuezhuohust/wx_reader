// 横屏 Pad 布局判定集中在这里。微信部分 Android Pad 不会提供 deviceType，
// 因此保留设备型号白名单作为兜底；新增机型只需补充下面的配置即可。
const PAD_MODEL_PATTERNS = [
  /\b2410crp4cc\b/i, // Xiaomi Pad 7（当前测试设备）
]

function getWindowInfo() {
  return typeof wx.getWindowInfo === 'function'
    ? wx.getWindowInfo()
    : wx.getSystemInfoSync()
}

function getDeviceInfo() {
  const systemInfo = wx.getSystemInfoSync()
  const deviceInfo = typeof wx.getDeviceInfo === 'function'
    ? wx.getDeviceInfo()
    : {}
  return { systemInfo, deviceInfo }
}

function getLayoutProfile(inputWindowInfo, inputOrientation, options) {
  const windowInfo = inputWindowInfo || getWindowInfo()
  const { systemInfo, deviceInfo } = getDeviceInfo()
  const rawWidth = Number(windowInfo.windowWidth || 0)
  const rawHeight = Number(windowInfo.windowHeight || 0)
  const deviceType = String(deviceInfo.deviceType || systemInfo.deviceType || '').toLowerCase()
  const model = String(deviceInfo.model || systemInfo.model || '')
  const platform = String(deviceInfo.platform || systemInfo.platform || '').toLowerCase()
  const reportedOrientation = String(
    deviceInfo.deviceOrientation || systemInfo.deviceOrientation || ''
  ).toLowerCase()
  const eventOrientation = String(inputOrientation || '').toLowerCase()
  const hasEventOrientation = eventOrientation === 'landscape' || eventOrientation === 'portrait'
  const hasExplicitOrientation = reportedOrientation === 'landscape' || reportedOrientation === 'portrait'
  const preferReportedOrientation = !!(options && options.preferReportedOrientation)
  const isDevTools = deviceType === 'devtools'
    || platform === 'devtools'
    || /devtools/i.test(model)
  // 安卓机型有时先发出方向事件、稍后才更新 windowWidth/windowHeight。此时
  // 使用同一窗口的交换尺寸作为过渡值，避免竖屏先按横屏高度留出大块空白。
  const effectiveOrientation = !isDevTools && hasEventOrientation
    ? eventOrientation
    : (preferReportedOrientation && hasExplicitOrientation ? reportedOrientation : '')
  const shouldSwapBounds = !!effectiveOrientation
    && ((effectiveOrientation === 'portrait' && rawWidth > rawHeight)
      || (effectiveOrientation === 'landscape' && rawHeight > rawWidth))
  const width = shouldSwapBounds ? rawHeight : rawWidth
  const height = shouldSwapBounds ? rawWidth : rawHeight
  const screenWidth = Number(windowInfo.screenWidth || systemInfo.screenWidth || width || 0)
  const screenHeight = Number(windowInfo.screenHeight || systemInfo.screenHeight || height || 0)
  const isConfiguredPad = PAD_MODEL_PATTERNS.some((pattern) => pattern.test(model))
  const isPad = deviceType === 'pad'
    || /ipad|tablet|\bpad\b/i.test(model)
    || isConfiguredPad
  // 页面实际应采用当前小程序窗口的比例。Android Pad 的系统信息在旋转
  // 首帧可能仍保留旧方向，因此真机旋转事件的 value 需要优先参与判断。
  const hasWindowBounds = width > 0 && height > 0
  // 开发者工具的设备方向经常固定为 portrait，始终以模拟器窗口比例为准。
  const isLandscape = effectiveOrientation
    ? effectiveOrientation === 'landscape'
    : (hasWindowBounds
      ? width > height
      : (hasExplicitOrientation
        ? reportedOrientation === 'landscape'
        : screenWidth > screenHeight))

  return {
    windowInfo,
    systemInfo,
    deviceInfo,
    deviceType,
    model,
    platform,
    orientation: effectiveOrientation || reportedOrientation,
    width,
    height,
    screenWidth,
    screenHeight,
    isPad,
    isLandscape,
    isLandscapePad: isPad && isLandscape,
  }
}

module.exports = {
  getLayoutProfile,
}
