import { defineSchema, type FromJsonSchema } from 'teamplay'

const schema = defineSchema({
  title: {
    type: 'string',
    required: true,
    label: 'Event title',
    description: 'Visible public event name'
  },
  description: {
    type: 'string',
    label: 'Event description'
  },
  type: {
    type: 'string',
    label: 'Event type'
  },
  required: {
    type: 'boolean',
    label: 'Requires approval'
  },
  enum: {
    type: 'string',
    label: 'Enum named field'
  },
  const: {
    type: 'number',
    label: 'Const named field'
  },
  properties: {
    type: 'object',
    label: 'Event properties',
    properties: {
      color: {
        type: 'string',
        label: 'Color'
      }
    }
  },
  active: { type: 'boolean' },
  details: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        label: 'Summary'
      }
    }
  },
  createdAt: { type: 'number', required: true }
})

export default schema
export default interface Event extends FromJsonSchema<typeof schema> {}
