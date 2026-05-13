const Sequencer = require('@jest/test-sequencer').default

class PathOrderSequencer extends Sequencer {
  sort (tests) {
    return Array.from(tests).sort((left, right) => left.path.localeCompare(right.path))
  }
}

module.exports = PathOrderSequencer
