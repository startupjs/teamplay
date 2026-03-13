import { describe, it } from 'mocha'
import { strict as assert } from 'node:assert'
import { addModel, getRootSignal } from '../index.js'
import BaseModel, { belongsTo, hasMany, hasOne } from '../orm/index.js'

describe('ORM associations', () => {
  it('exposes getAssociations() on model signals', () => {
    class CourseModel extends BaseModel {}
    CourseModel.collection = 'ormAssocCoursesA'

    class LessonModel extends BaseModel {}
    LessonModel.collection = 'ormAssocLessonsA'

    hasMany(LessonModel, { direct: true })(CourseModel)

    addModel('ormAssocCoursesA.*', CourseModel)

    const $root = getRootSignal({ rootId: '_orm_assoc_root_1' })
    const $course = $root.ormAssocCoursesA.course1
    const associations = $course.getAssociations()

    assert.equal(Array.isArray(associations), true)
    assert.equal(associations.length, 1)
    assert.equal(associations[0].type, 'hasMany')
    assert.equal(associations[0].key, 'ormAssocLessonsAIds')
    assert.equal(associations[0].direct, true)
    assert.equal(associations[0].orm, LessonModel)
  })

  it('creates opposite associations for hasMany/hasOne/belongsTo', () => {
    class CourseModel extends BaseModel {}
    CourseModel.collection = 'ormAssocCoursesB'
    class LessonModel extends BaseModel {}
    LessonModel.collection = 'ormAssocLessonsB'
    class StageModel extends BaseModel {}
    StageModel.collection = 'ormAssocStagesB'

    hasMany(LessonModel)(CourseModel)
    hasOne(StageModel)(LessonModel)
    belongsTo(CourseModel)(LessonModel)

    assert.deepEqual(CourseModel.associations.map(a => a.type), ['hasMany', 'oppositeBelongsTo'])
    assert.deepEqual(LessonModel.associations.map(a => a.type), ['oppositeHasMany', 'hasOne', 'belongsTo'])
    assert.deepEqual(StageModel.associations.map(a => a.type), ['oppositeHasOne'])
  })

  it('supports explicit key and validates missing collection', () => {
    class HostModel extends BaseModel {}
    HostModel.collection = 'ormAssocHostsC'

    class RefModel extends BaseModel {}

    assert.throws(
      () => belongsTo(RefModel)(HostModel),
      /must define static "collection" or pass options.key/
    )

    hasOne(RefModel, { key: 'targetId' })(HostModel)
    const association = HostModel.associations.find(a => a.key === 'targetId')
    assert.equal(association.type, 'hasOne')
  })

  it('keeps inherited associations isolated per subclass', () => {
    class ParentModel extends BaseModel {}
    ParentModel.collection = 'ormAssocParentD'

    class ChildModel extends ParentModel {}
    ChildModel.collection = 'ormAssocChildD'

    ParentModel.addAssociation({ type: 'manualParent' })
    ChildModel.addAssociation({ type: 'manualChild' })

    assert.deepEqual(ParentModel.associations.map(a => a.type), ['manualParent'])
    assert.deepEqual(ChildModel.associations.map(a => a.type), ['manualParent', 'manualChild'])
  })
})
