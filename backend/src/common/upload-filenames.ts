const mojibakeLatinPattern = /[\u00c0-\u00ff]/;
const chinesePattern = /[\u3400-\u9fff]/;

function cleanFileName(fileName: string) {
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
    return cleanFileName(decodeURIComponent(encodedName));
  } catch {
    return '';
  }
}

export function normalizeMultipartFileName(fileName?: string | null) {
  const cleanName = cleanFileName(String(fileName || ''));
  if (!cleanName) {
    return cleanName;
  }

  const percentDecodedName = decodePercentFileName(cleanName);
  if (usefulDecodedName(percentDecodedName, cleanName)) {
    return percentDecodedName;
  }

  let candidateName = cleanName;
  for (let attempt = 0; attempt < 3 && mojibakeLatinPattern.test(candidateName); attempt += 1) {
    const decodedName = Buffer.from(candidateName, 'latin1').toString('utf8');
    if (!usefulDecodedName(decodedName, candidateName)) {
      break;
    }
    candidateName = cleanFileName(decodedName);
    if (chinesePattern.test(candidateName)) {
      return candidateName;
    }
  }

  return cleanName;
}
