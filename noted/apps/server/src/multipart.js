/**
 * Parse multipart/form-data from an HTTP request.
 * Returns an object with { fields, files }.
 * files[name] = { filename, mimeType, data: Buffer }
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<{ fields: object, files: object }>}
 */
export async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(.+?)(?:;|$)/);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');

  const boundary = boundaryMatch[1].trim();
  const body = await readBody(req);
  const parts = splitParts(body, boundary);

  const fields = {};
  const files = {};

  for (const part of parts) {
    const { headers, data } = parsePart(part);
    const disposition = headers['content-disposition'] || '';
    const nameMatch = disposition.match(/name="([^"]+)"/);
    const filenameMatch = disposition.match(/filename="([^"]+)"/);

    if (!nameMatch) continue;
    const name = nameMatch[1];

    if (filenameMatch) {
      const filename = filenameMatch[1];
      const mimeType = headers['content-type'] || 'application/octet-stream';
      files[name] = { filename, mimeType: mimeType.trim(), data };
    } else {
      fields[name] = data.toString('utf-8');
    }
  }

  return { fields, files };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        req.destroy();
        reject(new Error('Upload too large (50MB max)'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function splitParts(body, boundary) {
  const delimiter = Buffer.from('--' + boundary);
  const ending = Buffer.from('--' + boundary + '--');
  const parts = [];
  let pos = 0;

  // Skip preamble — find first delimiter
  let start = bufferIndexOf(body, delimiter, pos);
  if (start === -1) return parts;
  pos = start + delimiter.length + 2; // skip delimiter + \r\n

  while (pos < body.length) {
    const end = bufferIndexOf(body, delimiter, pos);
    if (end === -1) break;

    // Part data is between pos and end - 2 (trim trailing \r\n)
    const partData = body.subarray(pos, end - 2);
    parts.push(partData);

    // Check for ending
    const nextBytes = body.subarray(end, end + ending.length);
    if (nextBytes.equals(ending)) break;

    pos = end + delimiter.length + 2; // skip delimiter + \r\n
  }

  return parts;
}

function parsePart(partBuf) {
  // Find \r\n\r\n separator between headers and body
  const sep = bufferIndexOf(partBuf, Buffer.from('\r\n\r\n'), 0);
  if (sep === -1) return { headers: {}, data: partBuf };

  const headerStr = partBuf.subarray(0, sep).toString('utf-8');
  const data = partBuf.subarray(sep + 4);

  const headers = {};
  for (const line of headerStr.split('\r\n')) {
    const idx = line.indexOf(':');
    if (idx !== -1) {
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
  }

  return { headers, data };
}

function bufferIndexOf(buf, search, fromIndex) {
  for (let i = fromIndex; i <= buf.length - search.length; i++) {
    let found = true;
    for (let j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}
