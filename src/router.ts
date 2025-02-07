import { Component, Ref, ref } from 'vue'
import {
  createMemoryHistory,
  createRouter,
  RouteLocationRaw,
  Router,
  RouteRecordRaw,
  RouterOptions,
  START_LOCATION,
} from 'vue-router'

export const EmptyView: Component = {
  name: 'RouterMockEmptyView',
  render: () => null,
}

/**
 * Router Mock instance
 */
export interface RouterMock extends Router {
  /**
   * Current depeth of the router view. This index is used to find the component
   * to display in the array `router.currentRoute.value.matched`.
   */
  depth: Ref<number>
  /**
   * Set a value to be returned on a navigation guard for the next navigation.
   *
   * @param returnValue - value that will be returned on a simulated navigation
   * guard
   */
  setNextGuardReturn(
    returnValue: Error | boolean | RouteLocationRaw | undefined
  ): void

  // NOTE: we could automatically wait for a tick inside getPendingNavigation(), that would require access to the wrapper, unless directly using nextTick from vue works. We could allow an optional parameter `eager: true` to not wait for a tick. Waiting one tick by default is likely to be more useful than not.

  /**
   * Returns a Promise of the pending navigation. Resolves right away if there
   * isn't any.
   */
  getPendingNavigation(): ReturnType<Router['push']>
}

export interface RouterMockOptions extends Partial<RouterOptions> {
  /**
   * Override the starting location before each test. Defaults to
   * START_LOCATION.
   */
  initialLocation?: RouteLocationRaw
  /**
   * Run in-component guards. Defaults to false
   */
  runInComponentGuards?: boolean
  /**
   * Run per-route guards. Defaults to false
   */
  runPerRouteGuards?: boolean
}

/**
 * Creates a router mock instance
 * @param options - options to initialize the router
 */
export function createRouterMock(options: RouterMockOptions = {}): RouterMock {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/:pathMatch(.*)*',
        component: EmptyView,
      },
    ],
    ...options,
  })

  let { runPerRouteGuards, runInComponentGuards } = options
  const initialLocation = options.initialLocation || START_LOCATION

  const { push, addRoute, replace } = router

  const addRouteMock = jest.fn(
    (
      parentRecordName: Required<RouteRecordRaw>['name'] | RouteRecordRaw,
      record?: RouteRecordRaw
    ) => {
      record = record || (parentRecordName as RouteRecordRaw)

      if (!runPerRouteGuards) {
        // remove existing records to force our own router.beforeEach and easier
        // way to mock navigation guard returns.
        delete record.beforeEnter
      }

      // @ts-ignore: this should be valid
      return addRoute(parentRecordName, record)
    }
  )

  const pushMock = jest.fn((to: RouteLocationRaw) => {
    return consumeNextReturn(to)
  })

  const replaceMock = jest.fn((to: RouteLocationRaw) => {
    return consumeNextReturn(to, { replace: true })
  })

  router.push = pushMock
  router.replace = replaceMock
  router.addRoute = addRouteMock

  beforeEach(() => {
    pushMock.mockClear()
    replaceMock.mockClear()
    addRouteMock.mockClear()

    nextReturn = undefined
    router.currentRoute.value =
      initialLocation === START_LOCATION
        ? START_LOCATION
        : router.resolve(initialLocation)
  })

  let nextReturn: Error | boolean | RouteLocationRaw | undefined = undefined

  function setNextGuardReturn(
    returnValue: Error | boolean | RouteLocationRaw | undefined
  ) {
    nextReturn = returnValue
  }

  function consumeNextReturn(
    to: RouteLocationRaw,
    options: { replace?: boolean } = {}
  ) {
    if (nextReturn != null || runInComponentGuards) {
      const removeGuard = router.beforeEach(() => {
        const value = nextReturn
        removeGuard()
        nextReturn = undefined
        return value
      })

      // avoid existing navigation guards
      const record = router.currentRoute.value.matched[depth.value]
      if (record && !runInComponentGuards) {
        record.leaveGuards.clear()
        record.updateGuards.clear()
        Object.values(record.components).forEach((component) => {
          // TODO: handle promises?
          // @ts-ignore
          delete component.beforeRouteUpdate
          // @ts-ignore
          delete component.beforeRouteLeave
        })
      }

      pendingNavigation = (options.replace ? replace : push)(to)
      pendingNavigation
        .catch(() => {})
        .finally(() => {
          pendingNavigation = undefined
        })
      return pendingNavigation
    }

    // NOTE: should we trigger a push to reset the internal pending navigation of the router?
    router.currentRoute.value = router.resolve(to)
    return Promise.resolve()
  }

  let pendingNavigation: ReturnType<typeof push> | undefined
  function getPendingNavigation() {
    return pendingNavigation || Promise.resolve()
  }

  const depth = ref(0)

  return {
    ...router,
    depth,
    setNextGuardReturn,
    getPendingNavigation,
  }
}
