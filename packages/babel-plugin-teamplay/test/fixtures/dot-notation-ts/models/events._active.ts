import { aggregation } from 'teamplay'

export default aggregation(function activeEvents () {
  return [{ $match: { active: true } }]
})
