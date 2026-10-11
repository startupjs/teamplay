export const DEFAULT_PATH = '/channel'
// The largest message a client may send, in bytes. 16 MiB matches MongoDB's
// document limit, so a write that fits in the database is never refused for
// its size; a project with smaller messages sets a lower value.
export const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024

// The xhr-polling fallback (SockJS) sends the messages the client queued as
// one POST: a JSON array of the messages, each escaped as a JSON string. The
// client never puts more than XHR_BATCH_MESSAGES messages, or more than
// XHR_BATCH_BYTES bytes, in one POST (a single message larger than that goes
// alone), and the server refuses a POST that breaks the same rules, so the
// limits must be the same on both sides; they do not depend on
// maxMessageSize.
export const XHR_BATCH_BYTES = 1024 * 1024
export const XHR_BATCH_MESSAGES = 1000
// SockJS escapes some characters as \uXXXX, so a message takes at most this
// many times its UTF-8 size in a POST (a combining mark: 2 bytes -> 6; a
// surrogate pair: 4 bytes -> 12)
export const XHR_ESCAPE_FACTOR = 3
