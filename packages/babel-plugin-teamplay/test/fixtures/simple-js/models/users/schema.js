const schema = {
  name: {
    type: 'string',
    label: 'User name',
    description: 'Public display name'
  },
  profile: {
    type: 'object',
    properties: {
      bio: {
        type: 'string',
        label: 'Bio'
      }
    }
  }
}

export default schema
