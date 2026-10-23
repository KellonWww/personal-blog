export const tools = [
  { icon: 'format', name: '文本格式化', desc: '格式化 JSON、SQL、HTML、CSS 与常见代码文本，保留 JSON 压缩、校验与字段路径。', href: '/toolbox/format', ready: true },
  { icon: 'time', name: '时间转换', desc: '秒 / 毫秒时间戳与日期互转，支持时区换算与夏令时校验。', href: '/toolbox/time', ready: true },
  { icon: 'diff', name: '文本 Diff', desc: '逐行对比两段文本，标记新增与删除，可忽略空白差异。', href: '/toolbox/diff', ready: true },
  { icon: 'codec', name: '编解码工作台', desc: 'Base64、URL、Unicode 编解码，支持中文与 emoji。', href: '/toolbox/codec', ready: true },
  { icon: 'text', name: '文本处理', desc: '按行去重与排序、去空行、大小写转换、添加前后缀。', href: '/toolbox/text', ready: true },
  { icon: 'regex', name: '正则测试器', desc: '匹配高亮、捕获组与替换预览，独立线程执行。', href: '/toolbox/regex', ready: true },
  { icon: 'qr', name: '二维码生成', desc: '把文字与网址变成二维码，实时预览，下载 PNG 或矢量 SVG。', href: '/toolbox/qr', ready: true },
  { icon: 'jwt', name: 'JWT 解析', desc: '读取 Header、Payload 与时间声明；仅本地解析，不验证签名。', href: '/toolbox/jwt', ready: true },
  { icon: 'url', name: 'URL 参数编辑', desc: '拆解网址、编辑重复参数、移除追踪字段，即时重组链接。', href: '/toolbox/url', ready: true },
  { icon: 'generator', name: '安全生成器', desc: '批量 UUID、随机密码与文本 / 文件 SHA-256，全部本地生成。', href: '/toolbox/generator', ready: true }
] as const;

export type ToolIconName = (typeof tools)[number]['icon'];
