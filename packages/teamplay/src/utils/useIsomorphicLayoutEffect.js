import { useEffect, useLayoutEffect } from 'react'
import isServer from './isServer.ts'

export default isServer ? useEffect : useLayoutEffect
