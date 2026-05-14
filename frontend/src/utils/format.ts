export function formatDate(value?: string) {
  if (!value) {
    return '-';
  }
  const businessDate = dateOnlyBusinessDate(value);
  if (businessDate) {
    return businessDate.toLocaleDateString('zh-CN');
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }
  return date.toLocaleDateString('zh-CN');
}

export function formatDateTime(value?: Date | string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

export function formatDateInputValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDateTimeInputValue(value: Date) {
  // datetime-local 需要浏览器本地墙钟时间，不能用 toISOString 直接生成 UTC 时间。
  const hour = String(value.getHours()).padStart(2, '0');
  const minute = String(value.getMinutes()).padStart(2, '0');
  const second = String(value.getSeconds()).padStart(2, '0');
  return `${formatDateInputValue(value)}T${hour}:${minute}:${second}`;
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
  if (Number.isNaN(date.getTime())) {
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

export function formatQuantity(value: number, unit?: string) {
  const number = Number.isInteger(value) ? value.toFixed(0) : value.toString();
  return `${number} ${unit || ''}`.trim();
}
