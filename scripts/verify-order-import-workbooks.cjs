#!/usr/bin/env node

const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fs = require('node:fs');
const path = require('node:path');

const rootDir = path.resolve(__dirname, '..');
const workbookDir = path.join(rootDir, 'outputs', 'component-order-template');
const hiddenHelperSheetName = 'ERP导入清单';
const uploadSheetName = 'ERP上传净表';
const finalWorkbookName = '组件零件清单下单台账模板-最终版.xlsx';
const expectedUploadHeaders = [
  '订单块(自动)',
  '订单编号',
  '制单日期',
  '客户名称',
  '项目型号',
  '行类型',
  '自动序号',
  '零件类型',
  '组件编号(自动)',
  '所属组件编号(自动/可改)',
  '物料号',
  '图号',
  '产品名称',
  '展开尺寸',
  '厚度',
  '订单数',
  '单套用量',
  '需求数量(自动)',
  '单位',
  '工艺路线',
  '工艺备注',
  '图纸日期',
  '图纸状态',
  '版本'
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function cellFormulaOrText(cell) {
  const value = cell.value;
  if (value && typeof value === 'object' && value.formula) {
    return value.formula;
  }
  if (value && typeof value === 'object' && value.richText) {
    return value.richText.map((item) => item.text).join('');
  }
  return cell.text || String(value ?? '');
}

function normalizeHeader(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function findHeaderRow(worksheet) {
  for (let rowNo = 1; rowNo <= Math.min(20, worksheet.rowCount); rowNo += 1) {
    const row = worksheet.getRow(rowNo);
    const values = [];
    row.eachCell({ includeEmpty: false }, (cell) => values.push(normalizeHeader(cell.text)));
    if (values.includes('订单编号') && values.includes('行类型') && values.includes('需求数量(自动)')) {
      return rowNo;
    }
  }
  return 0;
}

function visibleSheets(workbook) {
  return workbook.worksheets.filter((sheet) => (sheet.state || 'visible') === 'visible').map((sheet) => sheet.name);
}

function scanWorkbook(workbook) {
  const brokenRefs = [];
  const visibleHelperText = [];
  for (const worksheet of workbook.worksheets) {
    const isVisible = (worksheet.state || 'visible') === 'visible';
    worksheet.eachRow((row, rowNo) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNo) => {
        const text = cellFormulaOrText(cell);
        if (text.includes('#REF')) {
          brokenRefs.push(`${worksheet.name}!${rowNo}:${columnNo}`);
        }
        if (isVisible && text.includes(hiddenHelperSheetName) && !text.startsWith('IF(')) {
          visibleHelperText.push(`${worksheet.name}!${rowNo}:${columnNo}`);
        }
      });
    });
  }
  return { brokenRefs, visibleHelperText };
}

async function readWorkbook(filePath) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(filePath);
  } catch (error) {
    throw new Error(`${path.basename(filePath)} 不是可读取的 xlsx 文件：${error.message}`);
  }
  return workbook;
}

async function assertNoExcelTableParts(filePath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(filePath));
  const tableParts = Object.keys(zip.files).filter((name) => name.startsWith('xl/tables/'));
  assert(
    tableParts.length === 0,
    `${path.basename(filePath)} 不应包含残留 Excel table XML 部件，避免 Excel 打开时要求修复：${tableParts.join('、')}`
  );
}

function assertUploadSheet(fileName, workbook) {
  const worksheet = workbook.getWorksheet(uploadSheetName);
  assert(worksheet, `${fileName} 必须包含 ${uploadSheetName} 工作表`);

  const headerRowNo = findHeaderRow(worksheet);
  assert(headerRowNo > 0, `${fileName} 的 ${uploadSheetName} 找不到有效表头`);

  const headers = new Set();
  worksheet.getRow(headerRowNo).eachCell({ includeEmpty: false }, (cell) => {
    headers.add(normalizeHeader(cell.text));
  });
  for (const header of expectedUploadHeaders) {
    assert(headers.has(normalizeHeader(header)), `${fileName} 的 ${uploadSheetName} 缺少表头：${header}`);
  }
}

function assertFinalWorkbook(fileName, workbook) {
  if (fileName !== finalWorkbookName) {
    return;
  }
  const visible = visibleSheets(workbook);
  for (const sheetName of ['清单台账', '使用说明', '选项', uploadSheetName]) {
    assert(visible.includes(sheetName), `${fileName} 必须显示工作表：${sheetName}`);
  }
  assert(!visible.includes(hiddenHelperSheetName), `${fileName} 不应显示隐藏中间计算表 ${hiddenHelperSheetName}`);

  const helperSheet = workbook.getWorksheet(hiddenHelperSheetName);
  assert(helperSheet, `${fileName} 必须保留隐藏中间计算表，避免 ${uploadSheetName} 公式断链`);
  assert(helperSheet.state === 'veryHidden', `${fileName} 的 ${hiddenHelperSheetName} 必须是 veryHidden`);

  const { brokenRefs, visibleHelperText } = scanWorkbook(workbook);
  assert(brokenRefs.length === 0, `${fileName} 存在 #REF 公式断链：${brokenRefs.slice(0, 10).join('、')}`);
  assert(
    visibleHelperText.length === 0,
    `${fileName} 可见工作表仍在说明旧中间表：${visibleHelperText.slice(0, 10).join('、')}`
  );
}

async function main() {
  assert(fs.existsSync(workbookDir), `缺少 Excel 输出目录：${workbookDir}`);
  const files = fs.readdirSync(workbookDir).filter((fileName) => fileName.endsWith('.xlsx')).sort();
  assert(files.includes(finalWorkbookName), `缺少最终版台账模板：${finalWorkbookName}`);
  assert(files.some((fileName) => fileName === 'erpordertest.xlsx'), '缺少汇总测试上传文件：erpordertest.xlsx');
  assert(files.filter((fileName) => fileName.startsWith('erpordertest-')).length >= 3, '至少需要 3 个 erpordertest 分订单上传测试文件');

  const checked = [];
  for (const fileName of files) {
    const filePath = path.join(workbookDir, fileName);
    const workbook = await readWorkbook(filePath);
    await assertNoExcelTableParts(filePath);
    assertUploadSheet(fileName, workbook);
    assertFinalWorkbook(fileName, workbook);
    checked.push({
      fileName,
      visibleSheets: visibleSheets(workbook),
      hiddenSheets: workbook.worksheets
        .filter((sheet) => (sheet.state || 'visible') !== 'visible')
        .map((sheet) => `${sheet.name}:${sheet.state}`)
    });
  }

  console.log(JSON.stringify({ ok: true, checked }, null, 2));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
