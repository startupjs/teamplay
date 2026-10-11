const BufferedSender = require('sockjs-client/lib/transport/lib/buffered-sender')
const getByteLength = require('./byteLength.cjs')

const transportList = [
  // 'xhr-polling' is the only transport which reliably works with Metro Server
  require('sockjs-client/lib/transport/xhr-polling')
]
module.exports = require('sockjs-client/lib/main.js')(transportList)

// SockJS sends every message queued while a POST is in flight as the next
// POST, however many or large they are. The server refuses a POST past its
// batch limits (see constants.js), so a batch is cut to them here: as many
// queued messages as fit (always at least one; a single message larger than
// the byte limit goes alone), the rest in the next POSTs.
const limits = { bytes: Infinity, messages: Infinity }

module.exports.setBatchLimits = function setBatchLimits ({ bytes, messages }) {
  limits.bytes = bytes
  limits.messages = messages
}

BufferedSender.prototype.sendSchedule = function sendSchedule () {
  const self = this
  if (this.sendBuffer.length === 0) return
  let count = 0
  let size = 2 // the brackets
  for (; count < this.sendBuffer.length; count++) {
    // SockJS quotes and escapes a message before it queues it: its UTF-8
    // size is what goes on the wire
    const itemSize = getByteLength(this.sendBuffer[count]) + (count > 0 ? 1 : 0)
    if (count > 0 && (count >= limits.messages || size + itemSize > limits.bytes)) break
    size += itemSize
  }
  const batch = this.sendBuffer.slice(0, count)
  this.sendBuffer = this.sendBuffer.slice(count)
  this.sendStop = this.sender(this.url, '[' + batch.join(',') + ']', function (err) {
    self.sendStop = null
    if (err) {
      self.emit('close', err.code || 1006, 'Sending error: ' + err)
      self.close()
    } else {
      self.sendScheduleWait()
    }
  })
}
