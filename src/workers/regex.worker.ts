import { runRegex, type RegexRequest } from '../lib/regex-tools';
const scope = globalThis as unknown as { onmessage: ((event: MessageEvent<RegexRequest>) => void) | null; postMessage: (value: unknown) => void };
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ result: runRegex(data) }); }
  catch (error) { scope.postMessage({ error: error instanceof Error ? error.message : '正则执行失败，请检查输入。' }); }
};
