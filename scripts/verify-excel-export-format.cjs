const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const scanDirs = ['frontend/src', 'backend/src'];
const failures = [];

const bannedPatterns = [
  {
    name: 'application/vnd.ms-excel',
    pattern: /application\/vnd\.ms-excel/i,
    message: 'Excel 导出不得使用 application/vnd.ms-excel 伪装 HTML 表格'
  },
  {
    name: 'downloadHtmlAsExcel',
    pattern: /\bdownloadHtmlAsExcel\b/,
    message: 'Excel 导出不得使用 HTML 伪 Excel 工具'
  },
  {
    name: 'HTML Excel blob',
    pattern: /new\s+Blob\s*\(\s*\[[\s\S]{0,120}(?:<!doctype\s+html|<html|\\ufeff)/i,
    message: 'Excel 导出不得把 HTML 或文本 Blob 伪装成 Excel'
  },
  {
    name: '.xls download filename',
    pattern: /download\s*=\s*['"`][^'"`]*\.xls['"`]/i,
    message: '新导出文件名不得使用 .xls 后缀'
  },
  {
    name: '.xls generated filename',
    pattern: /[`'"][^`'"]*\.xls[`'"]/i,
    message: '代码中不得生成 .xls 导出文件名'
  }
];

const allowedXlsPatterns = [
  /replace\s*\(\s*\/\\?\\\.xls\$\//,
  /replace\s*\(\s*\/\\\.xls\$\//,
  /历史\s*`?\.xls`?\s*文件/,
  /不得再生成\s*`?\.xls`?\s*后缀/
];

for (const dir of scanDirs) {
  walk(path.join(rootDir, dir));
}
verifyBackendExcelResponseHeaders();
verifyFrontendExcelDownloadFilenames();

if (failures.length) {
  console.error('Excel export format verification failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Excel export format verification passed.');

function walk(currentPath) {
  if (!fs.existsSync(currentPath)) {
    return;
  }
  const stat = fs.statSync(currentPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(currentPath)) {
      if (entry === 'dist' || entry === 'node_modules') {
        continue;
      }
      walk(path.join(currentPath, entry));
    }
    return;
  }

  if (!/\.(ts|tsx|vue|js|cjs|mjs)$/.test(currentPath)) {
    return;
  }

  const source = fs.readFileSync(currentPath, 'utf8');
  const relativePath = path.relative(rootDir, currentPath).replace(/\\/g, '/');
  for (const banned of bannedPatterns) {
    if (!banned.pattern.test(source)) {
      continue;
    }
    if (banned.name.includes('.xls') && isAllowedXlsReference(source)) {
      continue;
    }
    failures.push(`${relativePath}: ${banned.message}`);
  }
}

function isAllowedXlsReference(source) {
  return allowedXlsPatterns.some((pattern) => pattern.test(source));
}

function verifyBackendExcelResponseHeaders() {
  const controllerDir = path.join(rootDir, 'backend/src');
  const controllerFiles = [];
  collectFiles(controllerDir, controllerFiles, (filePath) => filePath.endsWith('.controller.ts'));

  for (const filePath of controllerFiles) {
    const source = fs.readFileSync(filePath, 'utf8');
    const relativePath = path.relative(rootDir, filePath).replace(/\\/g, '/');
    const lines = source.split(/\r?\n/);
    lines.forEach((line, index) => {
      const routeMatch = line.match(/@Get\s*\(\s*['"`]([^'"`]*)['"`]\s*\)/);
      if (!routeMatch) {
        return;
      }

      const routePath = routeMatch[1];
      if (!/(^|\/|-)export($|\/|-)|(^|\/|-)template($|\/|-)|(^|\/|-)error-report($|\/|-)/.test(routePath)) {
        return;
      }

      const headerWindow = lines.slice(index, index + 8).join('\n');
      if (!headerWindow.includes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) {
        failures.push(
          `${relativePath}:${index + 1}: Excel endpoint "${routePath}" must declare the real .xlsx Content-Type.`
        );
      }
      if (!/@Header\s*\(\s*['"`]Content-Disposition['"`][\s\S]*?\.xlsx/.test(headerWindow)) {
        failures.push(
          `${relativePath}:${index + 1}: Excel endpoint "${routePath}" must declare a .xlsx Content-Disposition filename.`
        );
      }
    });
  }
}

function verifyFrontendExcelDownloadFilenames() {
  const apiPath = path.join(rootDir, 'frontend/src/api/erp.ts');
  if (!fs.existsSync(apiPath)) {
    failures.push('frontend/src/api/erp.ts: missing frontend API source for Excel download filename checks');
    return;
  }

  const source = fs.readFileSync(apiPath, 'utf8');
  const relativePath = path.relative(rootDir, apiPath).replace(/\\/g, '/');
  const helperDefinitions = [...source.matchAll(/\basync\s+function\s+downloadXlsxResponse\s*\(/g)];
  const helperCalls = [...source.matchAll(/\bdownloadXlsxResponse\s*\(/g)];
  if (helperDefinitions.length !== 1) {
    failures.push(`${relativePath}: expected exactly one downloadXlsxResponse helper for frontend Excel downloads`);
  }
  if (helperCalls.length - helperDefinitions.length <= 0) {
    failures.push(`${relativePath}: expected Excel export methods to use downloadXlsxResponse`);
  }
  if (!/function\s+xlsxFilename\s*\(\s*filename\s*:\s*string\s*\)/.test(source)) {
    failures.push(`${relativePath}: expected xlsxFilename helper to normalize frontend Excel filenames`);
  }

  const objectUrlCalls = [...source.matchAll(/\bURL\.createObjectURL\s*\(/g)];
  if (objectUrlCalls.length !== 1) {
    failures.push(`${relativePath}: frontend Excel downloads must create object URLs only inside downloadXlsxResponse`);
  }
  const anchorCreations = [...source.matchAll(/document\.createElement\s*\(\s*['"`]a['"`]\s*\)/g)];
  if (anchorCreations.length !== 1) {
    failures.push(`${relativePath}: frontend Excel downloads must create anchor elements only inside downloadXlsxResponse`);
  }

  const downloadAssignments = [...source.matchAll(/link\.download\s*=\s*([^;\n]+);/g)];
  if (downloadAssignments.length !== 1) {
    failures.push(`${relativePath}: expected exactly one link.download assignment inside downloadXlsxResponse`);
    return;
  }

  for (const assignment of downloadAssignments) {
    const expression = assignment[1];
    if (expression.includes('xlsxFilename')) {
      continue;
    }
    const lineNo = source.slice(0, assignment.index || 0).split(/\r?\n/).length;
    failures.push(`${relativePath}:${lineNo}: frontend Excel download filename must be normalized by xlsxFilename`);
  }
}

function collectFiles(currentPath, output, predicate) {
  if (!fs.existsSync(currentPath)) {
    return;
  }
  const stat = fs.statSync(currentPath);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(currentPath)) {
      if (entry === 'dist' || entry === 'node_modules') {
        continue;
      }
      collectFiles(path.join(currentPath, entry), output, predicate);
    }
    return;
  }
  if (stat.isFile() && predicate(currentPath)) {
    output.push(currentPath);
  }
}
