const BASE32HEX = "0123456789abcdefghijklmnopqrstuv";

/** @typedef {{originalUid: string | null, canonicalUid: string | null, kind: 'google' | 'synthetic' | 'invalid', encoding: 'plain' | 'base32hex' | 'opaque'}} GoogleUidIdentity */

function encodeBase32Hex(bytes) {
  let buffer = 0;
  let bits = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32HEX[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits > 0) encoded += BASE32HEX[(buffer << (5 - bits)) & 31];
  return encoded;
}

function decodeKnownGoogleUid(value) {
  // Only the reversible 32-character hex UID format observed in this repo.
  // Unknown Google ID formats remain opaque; never guess their identity.
  if (!/^_[0-9a-v]{52}$/.test(value)) return null;
  const encoded = value.slice(1);
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (const character of encoded) {
    buffer = (buffer << 5) | BASE32HEX.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
    buffer &= (1 << bits) - 1;
  }
  if (buffer !== 0 || encodeBase32Hex(bytes) !== encoded) return null;
  const decoded = String.fromCharCode(...bytes);
  return /^[0-9a-fA-F]{32}$/.test(decoded) ? decoded : null;
}

/**
 * Pure, shared identity function; no database, Node APIs or credentials.
 * Preserves original text and casing. It does not remove @google.com,
 * hyphens or recurrence suffixes. This function cannot determine whether the
 * input is a Google resource id, a series iCalUID, or a legacy identifier.
 * Identity namespace and verified iCalUID occurrence scope are separate.
 * @param {unknown} rawUid
 * @returns {GoogleUidIdentity}
 */
export function canonicalizeGoogleUid(rawUid) {
  const originalUid = typeof rawUid === "string" ? rawUid : null;
  const value = originalUid?.trim() ?? "";
  if (!value || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    return { originalUid, canonicalUid: null, kind: "invalid", encoding: "plain" };
  }
  if (value.startsWith("manual-gcal-") || value === "test-gcal-001") {
    return { originalUid, canonicalUid: value, kind: "synthetic", encoding: "plain" };
  }
  const decoded = decodeKnownGoogleUid(value);
  return {
    originalUid,
    canonicalUid: decoded ?? value,
    kind: "google",
    encoding: decoded ? "base32hex" : value.startsWith("_") ? "opaque" : "plain",
  };
}
