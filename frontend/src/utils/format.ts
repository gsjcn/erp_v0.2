export function formatDate(value?: Date | string | null) {
  if (!value) {
    return '-';
  }
  if (value instanceof Date) {
    return formatDateParts(value);
  }
  const businessDate = dateOnlyBusinessDate(value);
  const date = businessDate || new Date(value);
  if (!isValidDate(date)) {
    return '-';
  }
  return formatDateParts(date);
}

export function formatDateTime(value?: Date | string | null) {
  if (!value) {
    return '-';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!isValidDate(date)) {
    return '-';
  }
  return `${formatDateParts(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

export function formatDateInputValue(value: Date) {
  if (!isValidDate(value)) {
    return '';
  }
  return formatDateParts(value);
}

export function formatDateTimeInputValue(value: Date) {
  // datetime-local 需要浏览器本地墙钟时间，不能用 toISOString 直接生成 UTC 时间。
  if (!isValidDate(value)) {
    return '';
  }
  return `${formatDateInputValue(value)}T${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`;
}

export function formatDateInputText(value?: Date | string | null) {
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    return formatDateInputValue(value);
  }
  const businessDate = dateOnlyBusinessDate(value);
  if (businessDate) {
    return formatDateInputValue(businessDate);
  }
  const date = new Date(value);
  if (!isValidDate(date)) {
    return '';
  }
  return formatDateInputValue(date);
}

function dateOnlyBusinessDate(value: string) {
  // 订单日期、交期、图纸日期等业务日期只取日期字段，避免浏览器时区把 UTC 零点显示成前一天。
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.000)?Z)?$/.exec(value.trim());
  if (!match) {
    return null;
  }
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function formatDateParts(value: Date) {
  if (!isValidDate(value)) {
    return '-';
  }
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime());
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

export function formatQuantity(value?: number | null, unit?: string | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return unit ? `- ${unit}` : '-';
  }
  const number = formatNumber(value);
  return `${number} ${unit || ''}`.trim();
}

export function formatNumber(value?: number | null, fractionDigits = 3) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(fractionDigits).replace(/\.?0+$/, '');
}
