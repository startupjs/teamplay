// The UTF-8 size of a string, without encoding it
module.exports = function getByteLength (text) {
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) {
      bytes += 1
    } else if (code < 0x800) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // a surrogate pair: one 4-byte character
      bytes += 4
      i++
    } else {
      bytes += 3
    }
  }
  return bytes
}
