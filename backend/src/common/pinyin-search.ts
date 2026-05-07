import { pinyin } from 'pinyin-pro';

export function normalizeSearchKeyword(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

function toPinyinToken(value: string, pattern?: 'first') {
  try {
    return pinyin(value, {
      toneType: 'none',
      type: 'array',
      pattern
    }).join('');
  } catch {
    return '';
  }
}

export function buildPinyinSearchText(parts: Array<string | null | undefined>) {
  const tokens = new Set<string>();

  for (const part of parts) {
    const value = String(part || '').trim();
    if (!value) {
      continue;
    }

    // 同时保存原文、全拼和拼音首字母，保证“常”“changzhou”“cz”都能命中同一个客户。
    tokens.add(value);
    tokens.add(toPinyinToken(value));
    tokens.add(toPinyinToken(value, 'first'));
  }

  return normalizeSearchKeyword([...tokens].join(' '));
}
