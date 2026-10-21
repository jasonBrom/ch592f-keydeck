export function describeEnvironment({
  hostname = '',
  secure = false,
  hid = false,
  bluetooth = false,
} = {}) {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  if (!secure)
    return { local, text: '请通过 localhost 或 HTTPS 打开控制台，浏览器设备接口需要安全上下文。' };
  const methods = [hid ? 'USB / WebHID' : null, bluetooth ? '蓝牙 / Web Bluetooth' : null].filter(
    Boolean,
  );
  return {
    local,
    text: methods.length
      ? `${local ? '本地控制台' : '在线控制台'} · 可用：${methods.join('、')}。${local ? 'Windows 已配对蓝牙需本地服务。' : 'Windows 已配对蓝牙管理需启动本地控制台。'}`
      : '当前浏览器未提供 WebHID / Web Bluetooth。可离线编辑与导出配置；连接请用支持这些接口的桌面版 Chrome / Edge。',
  };
}
