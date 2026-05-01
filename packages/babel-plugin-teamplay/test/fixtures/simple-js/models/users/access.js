import { accessControl } from 'teamplay'

export default accessControl({
  create: true,
  read: true,
  update ({ session }) {
    return Boolean(session?.userId)
  },
  delete: false
})
