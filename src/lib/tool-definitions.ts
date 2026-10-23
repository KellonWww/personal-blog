export const tools = [
  { icon: 'format', name: '文本格式化', desc: '格式化 JSON、SQL、HTML、CSS 与常见代码文本，保留 JSON 压缩、校验与字段路径。', href: '/toolbox/format', ready: true },
  { icon: 'time', name: '时间转换', desc: '秒 / 毫秒时间戳与日期互转，支持时区换算与夏令时校验。', href: '/toolbox/time', ready: true },
  { icon: 'diff', name: '文本 Diff', desc: '逐行对比两段文本，标记新增与删除，可忽略空白差异。', href: '/toolbox/diff', ready: true },
  { icon: 'codec', name: '编解码工作台', desc: 'Base64、URL、Unicode 编解码，支持中文与 emoji。', href: '/toolbox/codec', ready: true },
  { icon: 'text', name: '文本处理', desc: '按行去重与排序、去空行、大小写转换、添加前后缀。', href: '/toolbox/text', ready: true },
  { icon: 'regex', name: '正则测试器', desc: '匹配高亮、捕获组与替换预览，独立线程执行。', href: '/toolbox/regex', ready: true }
] as const;

export type ToolIconName = (typeof tools)[number]['icon'];
