import crypto from 'crypto';

export function generateHMACSignature(
  data: Record<string, any>,
  integritySalt: string,
  excludeFields: string[] = ['signature']
): string {
  const sortedParams = Object.keys(data)
    .filter(key =>
      !excludeFields.includes(key) &&
      data[key] !== '' &&
      data[key] !== null &&
      data[key] !== undefined
    )
    .sort();

  const messageParts = [integritySalt];
  for (const param of sortedParams) {
    messageParts.push(String(data[param]));
  }
  const message = messageParts.join('&');

  return crypto
    .createHmac('sha256', integritySalt)
    .update(message)
    .digest('hex');
}

// EasyPaisa uses HMAC-SHA1 with base64 output
export function generateHMACSHA1Signature(
  data: Record<string, any>,
  hashKey: string
): string {
  const sortedParams = Object.keys(data)
    .filter(key => data[key] !== '' && data[key] !== null && data[key] !== undefined)
    .sort();

  const message = sortedParams.map(k => String(data[k])).join('&');

  return crypto
    .createHmac('sha1', hashKey)
    .update(message)
    .digest('base64');
}

export function generateTransactionId(prefix: string = 'TXN'): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}_${timestamp}_${random}`.toUpperCase();
}