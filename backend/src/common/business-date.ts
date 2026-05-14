const defaultBusinessTimeZone = process.env.BUSINESS_TIME_ZONE || 'Asia/Shanghai';

export function businessDateKey(value: Date = new Date(), timeZone = defaultBusinessTimeZone) {
  // 业务编号按公司业务日期生成，避免 Docker / NAS 时区为 UTC 时凌晨编号落到前一天。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  return `${year}${month}${day}`;
}

export function businessDateTimeKey(value: Date = new Date(), timeZone = defaultBusinessTimeZone) {
  // 盘点等流水编号需要日期和时间都按公司业务时区生成，避免 Docker / NAS 默认 UTC。
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(value);
  const year = parts.find((part) => part.type === 'year')?.value || '0000';
  const month = parts.find((part) => part.type === 'month')?.value || '00';
  const day = parts.find((part) => part.type === 'day')?.value || '00';
  const hour = parts.find((part) => part.type === 'hour')?.value || '00';
  const minute = parts.find((part) => part.type === 'minute')?.value || '00';
  const second = parts.find((part) => part.type === 'second')?.value || '00';
  return `${year}${month}${day}${hour}${minute}${second}`;
}
