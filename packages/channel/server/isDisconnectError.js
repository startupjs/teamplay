// Whether a failed send was cut short by the client going away. With
// permessage-deflate ws compresses a message before writing it, and when the
// connection closes or ends meanwhile it hands the send callback an error
// ("The socket was closed while data was being compressed", "write after
// end"). That is normal at disconnect: such a send is dropped quietly, like a
// send after the close. Any other failed send is a real error.
// isOpen: whether the connection was still open when the send failed
const DISCONNECT_CODES = new Set([
  'EPIPE',
  'ECONNRESET',
  'ECONNABORTED',
  'ERR_STREAM_WRITE_AFTER_END',
  'ERR_STREAM_DESTROYED'
])
// ws: "The socket was closed while data was being compressed" (or "while the
// blob was being read")
const CLOSED_MEANWHILE = /^The socket was closed while /

export function isDisconnectError (err, isOpen) {
  if (!isOpen) return true
  if (!err) return false
  return DISCONNECT_CODES.has(err.code) || CLOSED_MEANWHILE.test(String(err.message))
}
