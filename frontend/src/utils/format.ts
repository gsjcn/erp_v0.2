export function formatDate(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleDateString('zh-CN');
}

export function formatDateTime(value?: string) {
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

export function formatQuantity(value: number, unit?: string) {
  const number = Number.isInteger(value) ? value.toFixed(0) : value.toString();
  return `${number} ${unit || ''}`.trim();
}
