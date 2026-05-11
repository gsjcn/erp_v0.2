import { pinyin } from 'pinyin-pro';

type PinyinSearchEntryType = 'raw' | 'fullPinyin' | 'initials' | 'syllable';

type PinyinSearchEntry = {
  type: PinyinSearchEntryType;
  value: string;
};

export function normalizeSearchKeyword(value?: string | null) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\-_./\\]+/g, '');
}

function toPinyinTokens(value: string, pattern?: 'first') {
  try {
    return pinyin(value, {
      toneType: 'none',
      type: 'array',
      pattern
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function addPinyinSearchEntry(entries: PinyinSearchEntry[], seen: Set<string>, type: PinyinSearchEntryType, value: string) {
  const normalizedValue = normalizeSearchKeyword(value);
  if (!normalizedValue) {
    return;
  }
  const key = `${type}:${normalizedValue}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  entries.push({ type, value: normalizedValue });
}

export function buildPinyinSearchEntries(parts: Array<string | null | undefined>) {
  const entries: PinyinSearchEntry[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const value = String(part || '').trim();
    if (!value) {
      continue;
    }

    addPinyinSearchEntry(entries, seen, 'raw', value);

    const fullPinyinTokens = toPinyinTokens(value);
    if (fullPinyinTokens.length > 0) {
      addPinyinSearchEntry(entries, seen, 'fullPinyin', fullPinyinTokens.join(''));
      for (const token of fullPinyinTokens) {
        addPinyinSearchEntry(entries, seen, 'syllable', token);
      }
    }

    const initialTokens = toPinyinTokens(value, 'first');
    if (initialTokens.length > 0) {
      addPinyinSearchEntry(entries, seen, 'initials', initialTokens.join(''));
    }
  }

  return entries;
}

function pinyinEntryMatchesKeyword(entry: PinyinSearchEntry, keyword: string) {
  if (entry.type === 'raw') {
    if (entry.value.includes(keyword)) {
      return true;
    }
    return isCodeLikeKeyword(keyword) && isSubsequenceSearchMatch(entry.value, keyword);
  }

  if (entry.type === 'initials') {
    return entry.value.includes(keyword);
  }

  if (entry.type === 'syllable') {
    return entry.value.startsWith(keyword);
  }

  // 短字母优先按首字母、编码或单字拼音处理，避免跨音节误命中。
  if (/^[a-z]+$/.test(keyword) && keyword.length <= 3) {
    return entry.value.startsWith(keyword);
  }

  if (entry.type === 'fullPinyin' && isCodeLikeKeyword(keyword) && isSubsequenceSearchMatch(entry.value, keyword)) {
    return true;
  }

  return entry.value.includes(keyword);
}

function isCodeLikeKeyword(keyword: string) {
  return keyword.length >= 3 && /^[a-z0-9]+$/.test(keyword) && /\d/.test(keyword);
}

function isSubsequenceSearchMatch(value: string, keyword: string) {
  let keywordIndex = 0;
  for (const character of value) {
    if (character === keyword[keywordIndex]) {
      keywordIndex += 1;
      if (keywordIndex === keyword.length) {
        return true;
      }
    }
  }
  return false;
}

export function pinyinSearchMatches(parts: Array<string | null | undefined>, keyword?: string | null) {
  const normalizedKeyword = normalizeSearchKeyword(keyword);
  if (!normalizedKeyword) {
    return true;
  }

  return buildPinyinSearchEntries(parts).some((entry) => pinyinEntryMatchesKeyword(entry, normalizedKeyword));
}

export function filterPinyinSearchOptions(options: string[], keyword?: string | null) {
  return options.filter((option) => pinyinSearchMatches([option], keyword));
}
