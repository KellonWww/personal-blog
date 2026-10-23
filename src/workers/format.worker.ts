import { formatText } from '../lib/format-tools';
import type { FormatRequest } from '../lib/format-config';
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<FormatRequest>) => void) | null; postMessage: (value: unknown) => void };
scope.onmessage = async ({ data }) => {
  try { scope.postMessage({ result: await formatText(data) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '格式化失败，请检查语言类型与输入。' }); }
};
