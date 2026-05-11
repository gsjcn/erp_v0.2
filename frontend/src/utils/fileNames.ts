const mojibakeLatinPattern = /[\u00c0-\u00ff]/;
const chinesePattern = /[\u3400-\u9fff]/;

function cleanDisplayFileName(fileName: string) {
  const sanitizedName = fileName.replace(/[\0\r\n]/g, '').trim();
  const parts = sanitizedName.split(/[\\/]+/);
  return parts[parts.length - 1] || '';
}

function usefulDecodedName(fileName: string, originalName: string) {
  return fileName && fileName !== originalName && !fileName.includes('\uFFFD');
}

function decodePercentFileName(fileName: string) {
  const encodedName = fileName.replace(/^UTF-8''/i, '');
  if (!/%[0-9a-f]{2}/i.test(encodedName)) {
    return '';
  }

  try {
    return cleanDisplayFileName(decodeURIComponent(encodedName));
  } catch {
    return '';
  }
}

function decodeLatin1Mojibake(fileName: string) {
  const bytes = new Uint8Array([...fileName].map((char) => char.charCodeAt(0) & 0xff));
  try {
    return cleanDisplayFileName(new TextDecoder('utf-8').decode(bytes));
  } catch {
    return '';
  }
}

export function normalizeDisplayFileName(fileName?: string | null) {
  const cleanName = cleanDisplayFileName(String(fileName || ''));
  if (!cleanName) {
    return cleanName;
  }

  const percentDecodedName = decodePercentFileName(cleanName);
  if (usefulDecodedName(percentDecodedName, cleanName)) {
    return percentDecodedName;
  }

  let candidateName = cleanName;
  for (let attempt = 0; attempt < 3 && mojibakeLatinPattern.test(candidateName); attempt += 1) {
    const decodedName = decodeLatin1Mojibake(candidateName);
    if (!usefulDecodedName(decodedName, candidateName)) {
      break;
    }
    candidateName = decodedName;
    if (chinesePattern.test(candidateName)) {
      return candidateName;
    }
  }

  return cleanName;
}
