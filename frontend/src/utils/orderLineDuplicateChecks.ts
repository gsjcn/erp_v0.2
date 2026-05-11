import { createApp, defineComponent, h, ref } from 'vue';
import { ElButton, ElDialog } from 'element-plus';
import { erpApi } from '../api/erp';
import type { CreateOrderLinePayload, DrawingDuplicateMatch } from '../api/erp';
import { normalizeDisplayFileName } from './fileNames';

type DuplicatePair = {
  first: { line: CreateOrderLinePayload; index: number };
  second: { line: CreateOrderLinePayload; index: number };
  value: string;
};

function normalize(value?: string) {
  return normalizeDisplayFileName(value).trim().toLowerCase();
}

function displayDrawingFileName(fileName?: string | null, fallback = '未记录文件名') {
  return normalizeDisplayFileName(fileName) || fallback;
}

function describeLine(line: CreateOrderLinePayload, index: number) {
  const partName = line.partName?.trim() || `第 ${index + 1} 个零件`;
  const partCode = line.partCode?.trim();
  return partCode ? `${partName}（${partCode}）` : partName;
}

function describeDrawingNoConflictLine(line: CreateOrderLinePayload, index: number) {
  const partCode = line.partCode?.trim() || `第 ${index + 1} 个零件`;
  const drawingNo = line.drawingNo?.trim() || '未填写';
  const drawingVersion = line.drawingVersion?.trim() || '-';
  return `零件 ${escapeHtml(partCode)} 图号：${escapeHtml(drawingNo)}, 版本号${escapeHtml(drawingVersion)}`;
}

function describeDrawingNoConflictMatch(match: DrawingDuplicateMatch) {
  const partCode = match.partCode?.trim() || '历史零件';
  const drawingNo = match.drawingNo?.trim() || '未填写';
  const drawingVersion = match.drawingVersion?.trim() || '-';
  return `零件 ${escapeHtml(partCode)} 图号：${escapeHtml(drawingNo)}, 版本号${escapeHtml(drawingVersion)}`;
}

function renderDrawingNoConflictHtml(lines: string[], extraText?: string) {
  return `
    <div style="display:grid;gap:8px;line-height:1.7;color:#334155;">
      <p style="margin:0;">不同零件编号，图号冲突，请确认是否继续使用相同图号</p>
      ${lines.map((line) => `<p style="margin:0;">${line}</p>`).join('')}
      ${extraText ? `<p style="margin:0;color:#64748b;">${escapeHtml(extraText)}</p>` : ''}
    </div>
  `;
}

function findDuplicatePair(lines: CreateOrderLinePayload[], getter: (line: CreateOrderLinePayload) => string | undefined) {
  const seen = new Map<string, { line: CreateOrderLinePayload; index: number; value: string }>();
  for (const [index, line] of lines.entries()) {
    const rawValue = normalizeDisplayFileName(getter(line)).trim();
    const key = normalize(rawValue);
    if (!key || !rawValue) {
      continue;
    }

    const existing = seen.get(key);
    if (existing) {
      return {
        first: { line: existing.line, index: existing.index },
        second: { line, index },
        value: existing.value
      } satisfies DuplicatePair;
    }
    seen.set(key, { line, index, value: rawValue });
  }
  return undefined;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderDrawingPreview(line: CreateOrderLinePayload, index: number) {
  const fileName = escapeHtml(displayDrawingFileName(line.drawingFileName));
  const fileUrl = line.drawingFileUrl || '';
  const safeUrl = escapeHtml(fileUrl);
  const title = escapeHtml(describeLine(line, index));
  const isImage = /\.(png|jpe?g|webp)$/i.test(fileUrl);
  const preview = fileUrl
    ? isImage
      ? `<img src="${safeUrl}" alt="${fileName}" style="width:100%;max-height:150px;object-fit:contain;border:1px solid #d9e2ec;border-radius:6px;background:#fff;" />`
      : `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="color:#2563eb;">打开图纸</a>`
    : '<span style="color:#64748b;">未保存访问地址</span>';

  return `
    <div style="display:grid;gap:8px;padding:10px;border:1px solid #d9e2ec;border-radius:8px;background:#f8fafc;">
      <strong style="color:#0f172a;">${title}</strong>
      <span style="color:#475569;word-break:break-all;">${fileName}</span>
      ${preview}
    </div>
  `;
}

function renderExistingDrawingPreview(match: DrawingDuplicateMatch) {
  const fileName = escapeHtml(displayDrawingFileName(match.drawingFileName || match.drawingNo, '未记录图纸'));
  const fileUrl = match.drawingFileUrl || '';
  const safeUrl = escapeHtml(fileUrl);
  const title = escapeHtml(`${match.partName}（${match.partCode} / ${match.orderNo}）`);
  const isImage = /\.(png|jpe?g|webp)$/i.test(fileUrl);
  const preview = fileUrl
    ? isImage
      ? `<img src="${safeUrl}" alt="${fileName}" style="width:100%;max-height:150px;object-fit:contain;border:1px solid #d9e2ec;border-radius:6px;background:#fff;" />`
      : `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="color:#2563eb;">打开历史图纸</a>`
    : '<span style="color:#64748b;">历史记录未保存图纸文件地址</span>';

  return `
    <div style="display:grid;gap:8px;padding:10px;border:1px solid #d9e2ec;border-radius:8px;background:#f8fafc;">
      <strong style="color:#0f172a;">${title}</strong>
      <span style="color:#475569;word-break:break-all;">${fileName}</span>
      ${preview}
    </div>
  `;
}

function renderSelectedDrawingPreview(file: File, fileUrl: string) {
  const displayName = displayDrawingFileName(file.name);
  const fileName = escapeHtml(displayName);
  const safeUrl = escapeHtml(fileUrl);
  const isImage = /\.(png|jpe?g|webp)$/i.test(displayName || file.name);
  const preview = isImage
    ? `<img src="${safeUrl}" alt="${fileName}" style="width:100%;max-height:150px;object-fit:contain;border:1px solid #d9e2ec;border-radius:6px;background:#fff;" />`
    : `<a href="${safeUrl}" target="_blank" rel="noreferrer" style="color:#2563eb;">打开当前选择图纸</a>`;

  return `
    <div style="display:grid;gap:8px;padding:10px;border:1px solid #d9e2ec;border-radius:8px;background:#fff7ed;">
      <strong style="color:#0f172a;">当前选择文件</strong>
      <span style="color:#475569;word-break:break-all;">${fileName}</span>
      ${preview}
    </div>
  `;
}

function confirmDrawingDuplicateDialog(options: {
  title: string;
  message?: string;
  html?: string;
  confirmText: string;
  cancelText?: string;
}) {
  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  return new Promise<boolean>((resolve) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    let settled = false;

    const settle = (confirmed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(confirmed);
    };

    const DialogHost = defineComponent({
      setup() {
        const visible = ref(true);
        const closeWith = (confirmed: boolean) => {
          settle(confirmed);
          visible.value = false;
        };
        return () =>
          h(
            ElDialog,
            {
              modelValue: visible.value,
              'onUpdate:modelValue': (value: boolean) => {
                visible.value = value;
                if (!value) {
                  settle(false);
                }
              },
              title: options.title,
              width: 'min(760px, calc(100vw - 32px))',
              appendToBody: true,
              destroyOnClose: true,
              closeOnClickModal: false,
              onClosed: () => {
                app.unmount();
                container.remove();
              }
            },
            {
              default: () =>
                options.html
                  ? h('div', { class: 'drawing-duplicate-dialog-body', innerHTML: options.html })
                  : h('p', { class: 'drawing-duplicate-dialog-message' }, options.message || ''),
              footer: () => [
                h(ElButton, { onClick: () => closeWith(false) }, () => options.cancelText || '返回修改'),
                h(ElButton, { type: 'primary', onClick: () => closeWith(true) }, () => options.confirmText)
              ]
            }
          );
      }
    });

    const app = createApp(DialogHost);
    app.mount(container);
  });
}

function findSameOrderDrawingFile(
  lines: CreateOrderLinePayload[],
  currentLine: CreateOrderLinePayload,
  fileName: string
) {
  const key = normalize(fileName);
  if (!key) {
    return undefined;
  }

  return lines
    .map((line, index) => ({ line, index }))
    .find(({ line }) => line !== currentLine && normalize(line.drawingFileName) === key);
}

async function confirmDrawingFileHtml(html: string, title: string) {
  return confirmDrawingDuplicateDialog({
    title,
    html,
    confirmText: '确认继续'
  });
}

export async function confirmDuplicateDrawingNos(lines: CreateOrderLinePayload[]) {
  const duplicate = findDuplicatePair(lines, (line) => line.drawingNo);
  if (!duplicate) {
    return true;
  }

  const html = renderDrawingNoConflictHtml([
    describeDrawingNoConflictLine(duplicate.first.line, duplicate.first.index),
    describeDrawingNoConflictLine(duplicate.second.line, duplicate.second.index)
  ]);
  return confirmDrawingDuplicateDialog({
    title: '图号或版本号冲突',
    html,
    confirmText: '继续使用'
  });
}

export async function confirmDuplicateDrawingFiles(lines: CreateOrderLinePayload[]) {
  const duplicate = findDuplicatePair(lines, (line) => line.drawingFileName);
  if (!duplicate) {
    return true;
  }

  const html = `
    <div style="display:grid;gap:12px;line-height:1.6;">
      <p style="margin:0;color:#334155;">
        图纸文件名 <strong>${escapeHtml(duplicate.value)}</strong> 已重复上传。请核对下面两份图纸，确认是否继续使用同名图纸。
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${renderDrawingPreview(duplicate.first.line, duplicate.first.index)}
        ${renderDrawingPreview(duplicate.second.line, duplicate.second.index)}
      </div>
    </div>
  `;

  return confirmDrawingFileHtml(html, '图纸文件名重复确认');
}

export async function confirmExistingDrawingNos(lines: CreateOrderLinePayload[], excludeOrderNo?: string) {
  const checkedDrawingNos = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const drawingNo = line.drawingNo?.trim();
    if (!drawingNo) {
      continue;
    }

    const key = normalize(drawingNo);
    if (checkedDrawingNos.has(key)) {
      continue;
    }
    checkedDrawingNos.add(key);

    // 历史订单查重只做提醒确认，不阻止业务复用同一图号；是否继续由操作人员确认。
    const matches = await erpApi.duplicateDrawingNos(drawingNo, excludeOrderNo);
    const match = matches[0];
    if (!match) {
      continue;
    }

    const confirmed = await confirmDrawingDuplicateDialog({
      title: '图号或版本号冲突',
      html: renderDrawingNoConflictHtml(
        [describeDrawingNoConflictMatch(match), describeDrawingNoConflictLine(line, index)],
        `历史订单：${match.orderNo} / ${match.customerName || '-'}`
      ),
      confirmText: '继续使用'
    });
    if (!confirmed) {
      return false;
    }
  }
  return true;
}

export async function confirmExistingDrawingFiles(lines: CreateOrderLinePayload[], excludeOrderNo?: string) {
  const checkedFileNames = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const fileName = normalizeDisplayFileName(line.drawingFileName).trim();
    if (!fileName) {
      continue;
    }

    const key = normalize(fileName);
    if (checkedFileNames.has(key)) {
      continue;
    }
    checkedFileNames.add(key);

    // 图纸文件名重复时必须展示当前图纸和历史图纸入口，避免同名文件误用。
    const matches = await erpApi.duplicateDrawingFiles(fileName, excludeOrderNo);
    const match = matches[0];
    if (!match) {
      continue;
    }

    const html = `
      <div style="display:grid;gap:12px;line-height:1.6;">
        <p style="margin:0;color:#334155;">
          图纸文件名 <strong>${escapeHtml(fileName)}</strong> 已在历史订单中使用。请核对当前图纸和历史图纸，确认是否继续使用同名图纸。
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          ${renderExistingDrawingPreview(match)}
          ${renderDrawingPreview(line, index)}
        </div>
      </div>
    `;

    if (!(await confirmDrawingFileHtml(html, '历史图纸文件名重复确认'))) {
      return false;
    }
  }
  return true;
}

export async function confirmUploadDrawingFileName(
  file: File,
  lines: CreateOrderLinePayload[],
  currentLine: CreateOrderLinePayload,
  excludeOrderNo?: string
) {
  const fileName = normalizeDisplayFileName(file.name).trim();
  if (!fileName) {
    return true;
  }

  const selectedFileUrl = URL.createObjectURL(file);
  try {
    const sameOrderLine = findSameOrderDrawingFile(lines, currentLine, fileName);
    if (sameOrderLine) {
      const html = `
        <div style="display:grid;gap:12px;line-height:1.6;">
          <p style="margin:0;color:#334155;">
            当前选择的图纸文件名 <strong>${escapeHtml(fileName)}</strong> 已在本订单其他零件中使用。请先核对两份图纸，确认是否继续上传同名图纸。
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            ${renderDrawingPreview(sameOrderLine.line, sameOrderLine.index)}
            ${renderSelectedDrawingPreview(file, selectedFileUrl)}
          </div>
        </div>
      `;

      if (!(await confirmDrawingFileHtml(html, '图纸文件名重复确认'))) {
        return false;
      }
    }

    // 上传前先查历史订单，避免同名图纸误用；保存时仍会再次兜底检查。
    const matches = await erpApi.duplicateDrawingFiles(fileName, excludeOrderNo);
    const match = matches[0];
    if (match) {
      const html = `
        <div style="display:grid;gap:12px;line-height:1.6;">
          <p style="margin:0;color:#334155;">
            当前选择的图纸文件名 <strong>${escapeHtml(fileName)}</strong> 已在历史订单中使用。请核对当前选择图纸和历史图纸，确认是否继续上传同名图纸。
          </p>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            ${renderExistingDrawingPreview(match)}
            ${renderSelectedDrawingPreview(file, selectedFileUrl)}
          </div>
        </div>
      `;

      if (!(await confirmDrawingFileHtml(html, '历史图纸文件名重复确认'))) {
        return false;
      }
    }

    return true;
  } finally {
    URL.revokeObjectURL(selectedFileUrl);
  }
}
