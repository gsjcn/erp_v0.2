const { readFileSync } = require('fs');
const { resolve } = require('path');
const vm = require('vm');
const ts = require('typescript');

const rootDir = resolve(__dirname, '..');
const mojibakePattern =
  /[ÃÂ�]|锟|脙|脗|鈥|绗|闃舵|寮€|涓€|瀵煎|璁㈠崟|鏂囦欢|缂栫爜|鍚嶇О|绮剧‘|鍖归厤|鍓嶇紑|鎷奸煶|鍥剧焊|瀹㈡埛|鍘嗗彶|搴撳瓨|鏉ユ簮|涔辩爜|淇|楠岃瘉|鏃犳硶|鏈壘|鎵惧埌|涓|尮閰|墿鏂|璇蜂粠|嬫媺|閫夋嫨|鏌ヨ|澶辫触|宸ヨ緭|闃绘柇/;

function loadTsExports(relativePath) {
  const filePath = resolve(rootDir, relativePath);
  const source = readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021
    },
    fileName: filePath
  });
  const module = { exports: {} };
  const sandbox = {
    Buffer,
    TextDecoder,
    Uint8Array,
    exports: module.exports,
    module,
    require
  };
  vm.runInNewContext(outputText, sandbox, { filename: filePath });
  return module.exports;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual, expected, message) {
  assert(actual === expected, `${message}: expected "${expected}", got "${actual}"`);
}

function assertNoMojibake(value, label) {
  assert(!mojibakePattern.test(value), `${label} 不能出现乱码：${value}`);
}

function mojibakeLatin1(value) {
  return Buffer.from(value, 'utf8').toString('latin1');
}

const { normalizeDisplayFileName } = loadTsExports('frontend/src/utils/fileNames.ts');
const { normalizeMultipartFileName } = loadTsExports('backend/src/common/upload-filenames.ts');

const cases = [
  {
    name: '正常中文文件名',
    input: '订单导入-乱码修复验证.xlsx',
    expected: '订单导入-乱码修复验证.xlsx'
  },
  {
    name: '带路径中文文件名',
    input: 'C:\\fakepath\\订单导入-乱码修复验证.xlsx',
    expected: '订单导入-乱码修复验证.xlsx'
  },
  {
    name: '百分号编码文件名',
    input: "UTF-8''%E8%AE%A2%E5%8D%95%E5%AF%BC%E5%85%A5-%E4%B9%B1%E7%A0%81%E4%BF%AE%E5%A4%8D%E9%AA%8C%E8%AF%81.xlsx",
    expected: '订单导入-乱码修复验证.xlsx'
  },
  {
    name: 'multipart latin1 乱码文件名',
    input: mojibakeLatin1('订单导入-乱码修复验证.xlsx'),
    expected: '订单导入-乱码修复验证.xlsx'
  },
  {
    name: '来源 Excel 中文文件名',
    input: mojibakeLatin1('示例订单来源 ERP净表.xlsx'),
    expected: '示例订单来源 ERP净表.xlsx'
  }
];

for (const testCase of cases) {
  const frontendName = normalizeDisplayFileName(testCase.input);
  const backendName = normalizeMultipartFileName(testCase.input);
  assertEqual(frontendName, testCase.expected, `frontend ${testCase.name}`);
  assertEqual(backendName, testCase.expected, `backend ${testCase.name}`);
  assertNoMojibake(frontendName, `frontend ${testCase.name}`);
  assertNoMojibake(backendName, `backend ${testCase.name}`);
}

console.log(`File name normalizer verification passed: ${cases.length} cases`);
