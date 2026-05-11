import { defineSchema, type FromJsonSchema } from 'teamplay'

const schema = defineSchema({
  userId: {
    type: 'string',
    required: true,
    label: 'Session user id'
  },
  banner: {
    type: 'object',
    properties: {
      visible: {
        type: 'boolean',
        label: 'Banner visibility'
      }
    }
  }
})

export default schema
export default interface Session extends FromJsonSchema<typeof schema> {}
