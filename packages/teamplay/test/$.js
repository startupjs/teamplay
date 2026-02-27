import { it, describe, afterEach, before } from 'mocha'
import { strict as assert } from 'node:assert'
import { afterEachTestGc, runGc } from './_helpers.js'
import { $, batch, __DEBUG_SIGNALS_CACHE__ as signalsCache } from '../index.js'
import { get as _get } from '../orm/dataTree.js'
import { LOCAL } from '../orm/$.js'
import connect from '../connect/test.js'

before(connect)

export function afterEachTestGcLocal () {
  afterEach(async () => {
    assert.deepEqual(_get([LOCAL]), {}, 'all local data should be GC\'ed')
  })
}

describe('$() function. Values', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('create local model. Test that data gets deleted after the signal is GC\'ed', async () => {
    assert.equal(_get([LOCAL]), undefined, 'initially local model is undefined')
    const $value = $()
    $value.set(42)
    assert.equal($value.get(), 42)
    $value.set('hello')
    assert.equal($value.get(), 'hello')
    assert.deepEqual(_get([LOCAL]), { _0: 'hello' })
    await runGc()
    assert.equal($value.get(), 'hello')
  })

  it('create local model with initial value', async () => {
    const $number = $(84)
    assert.equal($number.get(), 84)
    const $bool = $(true)
    assert.equal($bool.get(), true)
    const $string = $('hello')
    assert.equal($string.get(), 'hello')
    const array = [1, 2, 3]
    const $array = $(array)
    assert.equal($array.get(), array)
    assert.deepEqual($array.get(), [1, 2, 3])
    const object = { a: 1, b: 2 }
    const $object = $(object)
    assert.equal($object.get(), object)
    assert.deepEqual($object.get(), { a: 1, b: 2 })
  })

  it('create local model with destructuring', async () => {
    const { $firstName, $lastName } = $({ firstName: 'John', lastName: 'Smith' })
    assert.equal($firstName.get(), 'John')
    assert.equal($lastName.get(), 'Smith')
  })

  it('create local model with destructuring and check the parent object', async () => {
    const $user = $()
    const { $firstName, $lastName } = $user
    $firstName.set('John')
    $lastName.set('Smith')
    assert.equal($firstName.get(), 'John')
    assert.equal($lastName.get(), 'Smith')
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('test gc. Create using destructuring', async () => {
    const cacheSize = signalsCache.size
    const $user = $({ firstName: 'John', lastName: 'Smith' })
    assert.equal(signalsCache.size, cacheSize + 1, '+1: $user')
    const { $firstName, $lastName } = $user
    assert.equal(signalsCache.size, cacheSize + 3, '+3: $user, $firstName, $lastName')
    assert.equal($firstName.get(), 'John')
    assert.equal(signalsCache.size, cacheSize + 4, '+4: $user, $firstName, $lastName, $firstName.get')
    await runGc()
    assert.equal(signalsCache.size, cacheSize + 3, '+3: $firstName.get was cleared since it\'s not in a variable')
    assert.equal($firstName.get(), 'John')
    assert.equal($lastName.get(), 'Smith')
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('child signals hold a strong ref to the $() signal and after GC is run children data still exists', async () => {
    const { $firstName, $lastName } = $()
    $firstName.set('John')
    $lastName.set('Smith')
    assert.equal($firstName.get(), 'John', 'firstName should be John')
    assert.equal($lastName.get(), 'Smith', 'lastName should be Smith')
    await runGc()
    assert.equal($firstName.get(), 'John', 'firstName should still be John after GC')
    assert.equal($lastName.get(), 'Smith', 'lastName should still be Smith after GC')
  })
})

describe.skip('persistance of $() function across component re-renders', () => {
  it('support partial application with saving signal to identify uniqueness', () => {
    const id = Symbol('unique id')
    $(id)(({ id: _id }) => { assert.equal(_id, id) })
  })
})

describe('$() function. Reactions', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('reaction', async () => {
    const { $firstName, $lastName } = $({ firstName: 'John', lastName: 'Smith' })
    const $fullName = $(() => `${$firstName.get()} ${$lastName.get()}`)
    assert.equal($fullName.get(), 'John Smith')
    $firstName.set('Jane')
    await runGc()
    assert.equal($fullName.get(), 'Jane Smith')
    $firstName.set('Alice')
    assert.equal($fullName.get(), 'Alice Smith')
    await runGc()
    $lastName.set('Brown')
    await runGc()
    assert.equal($fullName.get(), 'Alice Brown')
    $firstName.set('John')
    $lastName.set('Smith')
    await runGc()
    assert.equal($fullName.get(), 'John Smith')
  })
})

describe('Signal array mutators (local)', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('supports array mutators and increment on local signals', async () => {
    const $list = $([1, 2, 3])
    const len1 = await $list.push(4)
    assert.equal(len1, 4)
    const len2 = await $list.unshift(0)
    assert.equal(len2, 5)
    const len3 = await $list.insert(2, ['a', 'b'])
    assert.equal(len3, 7)
    const popped = await $list.pop()
    assert.equal(popped, 4)
    const shifted = await $list.shift()
    assert.equal(shifted, 0)
    const removed = await $list.remove(1, 2)
    assert.deepEqual(removed, ['a', 'b'])
    const moved = await $list.move(1, 0)
    assert.deepEqual(moved, [2])
    assert.deepEqual($list.get(), [2, 1, 3])

    const $count = $(0)
    const inc = await $count.increment(2)
    assert.equal(inc, 2)
    assert.equal($count.get(), 2)
  })

  it('supports stringInsert/stringRemove on local signals', async () => {
    const $text = $('abc')
    const prev1 = await $text.stringInsert(0, 'X')
    assert.equal(prev1, 'abc')
    assert.equal($text.get(), 'Xabc')
    const prev2 = await $text.stringRemove(1, 2)
    assert.equal(prev2, 'Xabc')
    assert.equal($text.get(), 'Xc')
  })
})

describe('set, get, del on local collections', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('set undefined deletes the key in object', () => {
    const $obj = $({ a: 1, b: 2 })
    $obj.a.set(undefined)
    assert.deepEqual($obj.get(), { b: 2 })
  })

  it('set undefined on non-existing key does nothing', () => {
    const $obj = $({ a: 1, b: 2 })
    $obj.c.set(undefined)
    assert.deepEqual($obj.get(), { a: 1, b: 2 })
  })

  it('set undefined sets array\'s element to undefined', () => {
    const $arr = $([1, 2])
    $arr[0].set(undefined)
    assert.deepEqual($arr.get(), [undefined, 2])
  })

  it('set undefined on non-existing array index adds an undefined element', () => {
    const $arr = $([1, 2])
    $arr[3].set(undefined)
    assert.deepEqual($arr.get(), [1, 2, undefined, undefined])
  })

  it('del deletes the key in object', () => {
    const $obj = $({ a: 1, b: 2 })
    $obj.a.del()
    assert.deepEqual($obj.get(), { b: 2 })
  })

  it('del deletes the element in array', () => {
    const $arr = $([1, 2])
    $arr[0].del()
    assert.deepEqual($arr.get(), [2])
  })

  it('del deletes the element in array. Single element', () => {
    const $arr = $(['foo'])
    assert.deepEqual($arr.get(), ['foo'])
    $arr[0].del()
    assert.deepEqual($arr.get(), [])
  })

  it('del deletes the element in array. Deleting non-existent element', () => {
    const $arr = $(['foo'])
    assert.deepEqual($arr.get(), ['foo'])
    $arr[1].del()
    assert.deepEqual($arr.get(), ['foo'])
    $arr[2].del()
    assert.deepEqual($arr.get(), ['foo'])
    $arr[0].del()
    assert.deepEqual($arr.get(), [])
    $arr[0].del()
    assert.deepEqual($arr.get(), [])
    $arr[1].del()
    assert.deepEqual($arr.get(), [])
  })

  it('del deletes the element in array. Complex case', () => {
    const $settings = $({
      queryParams: {
        sort: [
          { key: 'name', dataType: 'string', sortNormalized: false, value: 1 }
        ]
      }
    })
    assert.deepEqual($settings.queryParams.sort.get(), [{ key: 'name', dataType: 'string', sortNormalized: false, value: 1 }])
    $settings.queryParams.sort[0].del()
    assert.deepEqual($settings.queryParams.sort.get(), [])
  })
})

describe('Signal.assign() function', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('assign simple values to empty object', async () => {
    const $user = $()
    await $user.assign({ firstName: 'John', lastName: 'Smith', age: 30 })
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith', age: 30 })
  })

  it('assign values with different types', async () => {
    const $data = $()
    await $data.assign({
      string: 'hello',
      number: 42,
      boolean: true,
      array: [1, 2, 3],
      object: { a: 1, b: 2 }
    })
    const result = $data.get()
    assert.equal(result.string, 'hello')
    assert.equal(result.number, 42)
    assert.equal(result.boolean, true)
    assert.deepEqual(result.array, [1, 2, 3])
    assert.deepEqual(result.object, { a: 1, b: 2 })
  })

  it('assign partial properties (other properties remain unchanged)', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30 })
    await $user.assign({ age: 31 })
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith', age: 31 })
  })

  it('update existing properties with new values', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30 })
    await $user.assign({ firstName: 'Jane', age: 25 })
    assert.deepEqual($user.get(), { firstName: 'Jane', lastName: 'Smith', age: 25 })
  })

  it('assign mix of new and existing properties', async () => {
    const $user = $({ firstName: 'John', age: 30 })
    await $user.assign({ lastName: 'Smith', age: 31, email: 'john@example.com' })
    assert.deepEqual($user.get(), {
      firstName: 'John',
      lastName: 'Smith',
      age: 31,
      email: 'john@example.com'
    })
  })

  it('delete properties using null values', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30 })
    await $user.assign({ age: null })
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('delete properties using undefined values', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30 })
    await $user.assign({ age: undefined })
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('assign mix of values and null/undefined for deletion', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30, email: 'john@example.com' })
    await $user.assign({ lastName: 'Doe', age: null, email: undefined })
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Doe' })
  })

  it('assign nested object values', async () => {
    const $data = $()
    await $data.assign({
      user: { name: 'John', age: 30 },
      settings: { theme: 'dark', language: 'en' }
    })
    const result = $data.get()
    assert.deepEqual(result.user, { name: 'John', age: 30 })
    assert.deepEqual(result.settings, { theme: 'dark', language: 'en' })
  })

  it('verify child signals are created correctly after assign', async () => {
    const $user = $()
    await $user.assign({ firstName: 'John', lastName: 'Smith' })
    assert.equal($user.firstName.get(), 'John')
    assert.equal($user.lastName.get(), 'Smith')
  })

  it('throw error when assigning to root signal', async () => {
    await assert.rejects(
      async () => await $.assign({ test: 'value' }),
      { message: "Can't assign to the root signal data" }
    )
  })

  it('throw error when assigning non-object value (string)', async () => {
    const $data = $()
    await assert.rejects(
      async () => await $data.assign('not an object'),
      { message: 'Signal.assign() expects an object argument, got: string' }
    )
  })

  it('throw error when assigning non-object value (number)', async () => {
    const $data = $()
    await assert.rejects(
      async () => await $data.assign(42),
      { message: 'Signal.assign() expects an object argument, got: number' }
    )
  })

  it('assign array assigns numeric indices', async () => {
    const $data = $()
    // Arrays are objects, so assign() will iterate through numeric keys
    await $data.assign([1, 2, 3])
    const result = $data.get()
    assert.equal(result[0], 1)
    assert.equal(result[1], 2)
    assert.equal(result[2], 3)
  })

  it('throw error with too many arguments', async () => {
    const $data = $()
    await assert.rejects(
      async () => await $data.assign({ a: 1 }, { b: 2 }),
      { message: 'Signal.assign() expects a single argument' }
    )
  })

  it('no-op when assigning null', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith' })
    await $user.assign(null)
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('no-op when assigning undefined', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith' })
    await $user.assign(undefined)
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('return Promise that resolves after all operations', async () => {
    const $user = $()
    const promise = $user.assign({ firstName: 'John', lastName: 'Smith', age: 30 })
    assert.ok(promise instanceof Promise, 'assign should return a Promise')
    await promise
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith', age: 30 })
  })

  it('handle multiple concurrent assigns', async () => {
    const $data = $()
    await Promise.all([
      $data.assign({ a: 1, b: 2 }),
      $data.assign({ c: 3, d: 4 }),
      $data.assign({ e: 5, f: 6 })
    ])
    const result = $data.get()
    assert.ok(result.a !== undefined || result.c !== undefined || result.e !== undefined,
      'at least some properties should be set')
  })

  it('verify underlying data tree after assign', async () => {
    const $user = $()
    await $user.assign({ firstName: 'John', lastName: 'Smith' })
    const localData = _get([LOCAL])
    assert.ok(localData, 'local data should exist')
    // Find the user data in the local tree
    const userKey = Object.keys(localData).find(key => {
      const value = localData[key]
      return value && typeof value === 'object' && value.firstName === 'John' && value.lastName === 'Smith'
    })
    assert.ok(userKey, 'user data should exist in data tree')
    assert.deepEqual(localData[userKey], { firstName: 'John', lastName: 'Smith' })
  })

  it('assign empty object does nothing', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith' })
    await $user.assign({})
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('assign does not copy inherited properties', async () => {
    const proto = { inherited: 'value' }
    const obj = Object.create(proto)
    obj.own = 'property'
    const $data = $()
    await $data.assign(obj)
    const result = $data.get()
    assert.equal(result.own, 'property')
    assert.equal(result.inherited, undefined, 'inherited property should not be copied')
  })

  it('assign overwrites entire nested object', async () => {
    const $data = $({ settings: { a: 1, b: 2, c: 3 } })
    await $data.assign({ settings: { x: 10, y: 20 } })
    assert.deepEqual($data.settings.get(), { x: 10, y: 20 })
  })

  it('verify del() is called for null values', async () => {
    const $user = $({ firstName: 'John', lastName: 'Smith', age: 30 })
    assert.equal($user.age.get(), 30)
    await $user.assign({ age: null })
    assert.equal($user.age.get(), undefined, 'age should be deleted')
    assert.deepEqual($user.get(), { firstName: 'John', lastName: 'Smith' })
  })

  it('verify set() is called for non-null values', async () => {
    const $user = $({ firstName: 'John' })
    await $user.assign({ lastName: 'Smith', age: 30 })
    assert.equal($user.firstName.get(), 'John')
    assert.equal($user.lastName.get(), 'Smith')
    assert.equal($user.age.get(), 30)
  })
})

describe('Signal.batch() function', () => {
  afterEachTestGc()
  afterEachTestGcLocal()

  it('batch executes the callback and returns its result', async () => {
    const $obj = $()
    const result = $.batch(() => {
      $obj.set({ a: 1 })
      return 'ok'
    })
    assert.equal(result, 'ok')
    assert.deepEqual($obj.get(), { a: 1 })
  })

  it('batch helper proxies to root batch', () => {
    const $obj = $()
    const result = batch(() => {
      $obj.set({ b: 2 })
      return 'done'
    })
    assert.equal(result, 'done')
    assert.deepEqual($obj.get(), { b: 2 })
  })
})
