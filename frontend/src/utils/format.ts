export function formatDate(value?: string) {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleDateString('zh-CN');
}

export function formatQuantity(value: number, unit?: string) {
  const number = Number.isInteger(value) ? value.toFixed(0) : value.toString();
  return `${number} ${unit || ''}`.trim();
}
