import AsyncStorage from '@react-native-async-storage/async-storage'
import createConnectWithPersistence from './index.js'

async function getItem (key) {
  const value = await AsyncStorage.getItem(key)
  if (value == null) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

async function setItem (key, value) {
  return AsyncStorage.setItem(key, JSON.stringify(value))
}

async function iterate (iterator) {
  const keys = await AsyncStorage.getAllKeys()
  for (const key of keys) {
    const value = await getItem(key)
    await iterator(value, key)
  }
}

export const storage = { getItem, setItem, iterate }

export default createConnectWithPersistence({ storage })
