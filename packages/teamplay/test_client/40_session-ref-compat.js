import { createElement as el, Fragment } from 'react'
import { describe, it, beforeAll as before, afterEach, expect } from '@jest/globals'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { $, observer, sub } from '../src/index.ts'
import connect from '../src/connect/test.js'
import { getConnection } from '../src/orm/connection.ts'
import { del as _del } from '../src/orm/dataTree.js'

const isCompatMode = process.env.TEAMPLAY_COMPAT === '1'
const describeCompat = isCompatMode ? describe : describe.skip

before(connect)
afterEach(cleanup)
afterEach(() => {
  _del(['_session'])
  _del(['users'])
  _del(['tenants'])
})

describeCompat('session alias + ref contract', () => {
  async function submitTenantRawOp (tenantId, op) {
    const shareDoc = getConnection().get('tenants', tenantId)
    await new Promise((resolve, reject) => {
      shareDoc.submitOp(op, err => err ? reject(err) : resolve())
    })
  }

  async function setupSessionRefs () {
    await act(async () => {
      await $.users.u1.set({ id: 'u1', name: 'Alice', email: 'alice@example.com', timeZone: 'Europe/Kyiv', profile: { lang: 'en' }, baseLearnLanguages: ['en'] })
      await $.users.u2.set({ id: 'u2', name: 'Bob', email: 'bob@example.com', timeZone: 'Europe/Istanbul', profile: { lang: 'tr' }, baseLearnLanguages: ['tr'] })
      await $.tenants.t1.set({
        id: 't1',
        name: 'Exxon Mobil',
        features: { credits: true },
        branding: { theme: 'dark' },
        subjectId: 'subj-1',
        questions: { deposit: 15 }
      })
      await $.tenants.t2.set({
        id: 't2',
        name: 'Chevron',
        features: { credits: false },
        branding: { theme: 'light' },
        subjectId: 'subj-2',
        questions: { deposit: 40 }
      })
      $.session.userId.set('u1')
      $.session.tenantId.set('t1')
      $.session.user.ref($.users.u1)
      $.session.tenant.ref($.tenants.t1)
    })
  }

  it('exposes nested session ref paths through the alias exactly like canonical _session', async () => {
    await setupSessionRefs()

    expect($.session.user.email.get()).toBe('alice@example.com')
    expect($.session.user.timeZone.get()).toBe('Europe/Kyiv')
    expect($.session.tenant.name.get()).toBe('Exxon Mobil')
    expect($.session.tenant.questions.deposit.get()).toBe(15)

    expect($.session.user.email).toBe($._session.user.email)
    expect($.session.user.timeZone).toBe($._session.user.timeZone)
    expect($.session.tenant.questions.deposit).toBe($._session.tenant.questions.deposit)

    expect($.session.user.email.path()).toBe('_session.user.email')
    expect($.session.tenant.questions.deposit.path()).toBe('_session.tenant.questions.deposit')
    expect($.session.user.path()).toBe('_session.user')
    expect($.session.tenant.path()).toBe('_session.tenant')
  })

  it('materializes target ids in plain session snapshot', async () => {
    await setupSessionRefs()

    const session = $.session.get()

    expect(session.user).toBeDefined()
    expect(session.tenant).toBeDefined()
    expect(session.user._id).toBe('u1')
    expect(session.user.id).toBe('u1')
    expect(session.tenant._id).toBe('t1')
    expect(session.tenant.id).toBe('t1')
  })

  it('exposes the same session user/tenant signals through alias and canonical paths', async () => {
    await setupSessionRefs()

    expect($.session.user).toBe($._session.user)
    expect($.session.tenant).toBe($._session.tenant)

    expect($.session.user.path()).toBe('_session.user')
    expect($.session.tenant.path()).toBe('_session.tenant')

    expect($.session.user.get().name).toBe('Alice')
    expect($.session.tenant.get().name).toBe('Exxon Mobil')
  })

  it('resolves getId() and getCollection() through session refs', async () => {
    await setupSessionRefs()

    expect($.session.user.getId()).toBe('u1')
    expect($.session.tenant.getId()).toBe('t1')
    expect($.session.user.getCollection()).toBe('users')
    expect($.session.tenant.getCollection()).toBe('tenants')

    expect($.session.user.name.getId()).toBe('name')
    expect($.session.tenant.questions.deposit.getId()).toBe('deposit')
  })

  it('session user ref reflects the dereferenced user value and writes through to the target doc', async () => {
    await setupSessionRefs()

    let lastUserSignal
    const Component = observer(() => {
      const $user = $.session.user
      const user = $user.get()
      lastUserSignal = $user
      return el(Fragment, null,
        el('span', { id: 'sessionUserName' }, user?.name || ''),
        el('span', { id: 'sessionUserLang' }, user?.profile?.lang || ''),
        el('button', { id: 'renameSessionUser', onClick: () => $user.name.set('Bob') }),
        el('button', { id: 'reLangSessionUser', onClick: () => $user.profile.lang.set('de') })
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#sessionUserName').textContent).toBe('Alice')
    expect(container.querySelector('#sessionUserLang').textContent).toBe('en')
    expect(lastUserSignal).toBe($.session.user)
    expect(lastUserSignal).toBe($._session.user)

    fireEvent.click(container.querySelector('#renameSessionUser'))
    await waitFor(() => {
      expect($.users.u1.name.get()).toBe('Bob')
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionUserName').textContent).toBe('Bob')
    })

    fireEvent.click(container.querySelector('#reLangSessionUser'))
    await waitFor(() => {
      expect($.users.u1.profile.lang.get()).toBe('de')
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionUserLang').textContent).toBe('de')
    })
  })

  it('session user ref rerenders when the target user doc changes directly', async () => {
    await setupSessionRefs()

    const Component = observer(() => {
      const user = $.session.user.get()
      return el('span', { id: 'sessionUserNameDirect' }, user?.name || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sessionUserNameDirect').textContent).toBe('Alice')

    await act(async () => {
      await $.users.u1.name.set('Carol')
    })

    await waitFor(() => {
      expect(container.querySelector('#sessionUserNameDirect').textContent).toBe('Carol')
    })
  })

  it('nested session user and tenant paths follow direct target doc updates', async () => {
    await setupSessionRefs()

    const Component = observer(() => {
      const userTimeZone = $.session.user.timeZone.get()
      const tenantName = $.session.tenant.name.get()
      const tenantDeposit = $.session.tenant.questions.deposit.get()
      return el(Fragment, null,
        el('span', { id: 'nestedUserTimeZone' }, userTimeZone || ''),
        el('span', { id: 'nestedTenantName' }, tenantName || ''),
        el('span', { id: 'nestedTenantDeposit' }, String(tenantDeposit ?? ''))
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#nestedUserTimeZone').textContent).toBe('Europe/Kyiv')
    expect(container.querySelector('#nestedTenantName').textContent).toBe('Exxon Mobil')
    expect(container.querySelector('#nestedTenantDeposit').textContent).toBe('15')

    await act(async () => {
      await $.users.u1.timeZone.set('UTC')
      await $.tenants.t1.name.set('Exxon LNG')
      await $.tenants.t1.questions.deposit.set(25)
    })

    await waitFor(() => {
      expect(container.querySelector('#nestedUserTimeZone').textContent).toBe('UTC')
    })
    await waitFor(() => {
      expect(container.querySelector('#nestedTenantName').textContent).toBe('Exxon LNG')
    })
    await waitFor(() => {
      expect(container.querySelector('#nestedTenantDeposit').textContent).toBe('25')
    })
  })

  it('session user refs switch to the new target when the session ref is rebound', async () => {
    await setupSessionRefs()

    let latestUserSignal
    const Component = observer(() => {
      const $user = $.session.user
      const user = $user.get()
      const userTimeZone = $.session.user.timeZone.get()
      latestUserSignal = $user
      return el(Fragment, null,
        el('span', { id: 'reboundUserName' }, user?.name || ''),
        el('span', { id: 'reboundUserTimeZone' }, userTimeZone || '')
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#reboundUserName').textContent).toBe('Alice')
    expect(container.querySelector('#reboundUserTimeZone').textContent).toBe('Europe/Kyiv')
    expect(latestUserSignal).toBe($.session.user)

    await act(async () => {
      $.session.userId.set('u2')
      $.session.user.ref($.users.u2)
    })

    await waitFor(() => {
      expect(container.querySelector('#reboundUserName').textContent).toBe('Bob')
    })
    await waitFor(() => {
      expect(container.querySelector('#reboundUserTimeZone').textContent).toBe('Europe/Istanbul')
    })

    expect($.session.user.email.get()).toBe('bob@example.com')
    expect($.session.userId.get()).toBe('u2')
  })

  it('tenant session refs switch to the new target when the session ref is rebound', async () => {
    await setupSessionRefs()

    const Component = observer(() => {
      const tenant = $.session.tenant.get()
      const tenantName = $.session.tenant.name.get()
      const tenantDeposit = $.session.tenant.questions.deposit.get()
      return el(Fragment, null,
        el('span', { id: 'reboundTenantRootName' }, tenant?.name || ''),
        el('span', { id: 'reboundTenantName' }, tenantName || ''),
        el('span', { id: 'reboundTenantDeposit' }, String(tenantDeposit ?? ''))
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#reboundTenantRootName').textContent).toBe('Exxon Mobil')
    expect(container.querySelector('#reboundTenantName').textContent).toBe('Exxon Mobil')
    expect(container.querySelector('#reboundTenantDeposit').textContent).toBe('15')

    await act(async () => {
      $.session.tenantId.set('t2')
      $.session.tenant.ref($.tenants.t2)
    })

    await waitFor(() => {
      expect(container.querySelector('#reboundTenantRootName').textContent).toBe('Chevron')
    })
    await waitFor(() => {
      expect(container.querySelector('#reboundTenantName').textContent).toBe('Chevron')
    })
    await waitFor(() => {
      expect(container.querySelector('#reboundTenantDeposit').textContent).toBe('40')
    })

    expect($.session.tenant.subjectId.get()).toBe('subj-2')
    expect($.session.tenantId.get()).toBe('t2')
  })

  it('session tenant ref rerenders when the target tenant doc changes directly', async () => {
    await setupSessionRefs()

    let lastTenantSignal
    const Component = observer(() => {
      const $tenant = $.session.tenant
      const tenant = $tenant.get()
      lastTenantSignal = $tenant
      return el(Fragment, null,
        el('span', { id: 'sessionTenantName' }, tenant?.name || ''),
        el('span', { id: 'sessionTenantTheme' }, tenant?.branding?.theme || '')
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#sessionTenantName').textContent).toBe('Exxon Mobil')
    expect(container.querySelector('#sessionTenantTheme').textContent).toBe('dark')
    expect(lastTenantSignal).toBe($.session.tenant)
    expect(lastTenantSignal).toBe($._session.tenant)

    await act(async () => {
      await $.tenants.t1.name.set('Exxon LNG')
      await $.tenants.t1.branding.theme.set('light')
    })

    await waitFor(() => {
      expect(container.querySelector('#sessionTenantName').textContent).toBe('Exxon LNG')
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionTenantTheme').textContent).toBe('light')
    })
  })

  it('session tenant ref stays in sync when the tenant doc changes via raw ShareDB ops', async () => {
    await setupSessionRefs()
    await act(async () => {
      await sub($.tenants.t1)
    })

    const Component = observer(() => {
      const tenant = $.session.tenant.get()
      return el(Fragment, null,
        el('span', { id: 'sessionTenantNameRawOp' }, tenant?.name || ''),
        el('span', { id: 'sessionTenantThemeRawOp' }, tenant?.branding?.theme || '')
      )
    })

    const { container } = render(el(Component))

    expect(container.querySelector('#sessionTenantNameRawOp').textContent).toBe('Exxon Mobil')
    expect(container.querySelector('#sessionTenantThemeRawOp').textContent).toBe('dark')

    await act(async () => {
      await submitTenantRawOp('t1', [
        { p: ['name'], od: 'Exxon Mobil', oi: 'Exxon Remote' },
        { p: ['branding', 'theme'], od: 'dark', oi: 'sunrise' }
      ])
    })

    await waitFor(() => {
      expect($.tenants.t1.name.get()).toBe('Exxon Remote')
    })
    await waitFor(() => {
      expect($.tenants.t1.branding.theme.get()).toBe('sunrise')
    })

    await waitFor(() => {
      expect($.session.tenant.get().name).toBe('Exxon Remote')
    })
    await waitFor(() => {
      expect($.session.tenant.get().branding.theme).toBe('sunrise')
    })

    await waitFor(() => {
      expect(container.querySelector('#sessionTenantNameRawOp').textContent).toBe('Exxon Remote')
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionTenantThemeRawOp').textContent).toBe('sunrise')
    })
  })

  it('tenant ref keeps following the rebound tenant under raw ShareDB ops', async () => {
    await setupSessionRefs()
    await act(async () => {
      await sub($.tenants.t1)
      await sub($.tenants.t2)
    })

    const Component = observer(() => {
      const tenantName = $.session.tenant.name.get()
      return el('span', { id: 'sessionTenantNameReboundRawOp' }, tenantName || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sessionTenantNameReboundRawOp').textContent).toBe('Exxon Mobil')

    await act(async () => {
      $.session.tenantId.set('t2')
      $.session.tenant.ref($.tenants.t2)
    })

    await waitFor(() => {
      expect(container.querySelector('#sessionTenantNameReboundRawOp').textContent).toBe('Chevron')
    })

    await act(async () => {
      await submitTenantRawOp('t1', [{ p: ['name'], od: 'Exxon Mobil', oi: 'Exxon Should Not Show' }])
      await submitTenantRawOp('t2', [{ p: ['name'], od: 'Chevron', oi: 'Chevron Remote' }])
    })

    await waitFor(() => {
      expect($.tenants.t1.name.get()).toBe('Exxon Should Not Show')
    })
    await waitFor(() => {
      expect($.tenants.t2.name.get()).toBe('Chevron Remote')
    })
    await waitFor(() => {
      expect($.session.tenant.get().name).toBe('Chevron Remote')
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionTenantNameReboundRawOp').textContent).toBe('Chevron Remote')
    })
  })

  it('tenant ref mirrors target field deletion from raw ShareDB ops', async () => {
    await setupSessionRefs()
    await act(async () => {
      await sub($.tenants.t1)
    })

    const Component = observer(() => {
      const tenantTheme = $.session.tenant.branding.theme.get()
      return el('span', { id: 'sessionTenantThemeDeleteRawOp' }, tenantTheme || '')
    })

    const { container } = render(el(Component))
    expect(container.querySelector('#sessionTenantThemeDeleteRawOp').textContent).toBe('dark')

    await act(async () => {
      await submitTenantRawOp('t1', [{ p: ['branding', 'theme'], od: 'dark' }])
    })

    await waitFor(() => {
      expect($.tenants.t1.branding.theme.get()).toBeUndefined()
    })
    await waitFor(() => {
      expect($.session.tenant.branding.theme.get()).toBeUndefined()
    })
    await waitFor(() => {
      expect(container.querySelector('#sessionTenantThemeDeleteRawOp').textContent).toBe('')
    })
  })

  it('removeRef freezes alias snapshot even when target changes via raw ShareDB ops', async () => {
    await setupSessionRefs()
    await act(async () => {
      await sub($.tenants.t1)
    })

    const before = $.session.tenant.get()
    expect(before?.name).toBe('Exxon Mobil')

    await act(async () => {
      $.session.tenant.removeRef()
      await submitTenantRawOp('t1', [{ p: ['name'], od: 'Exxon Mobil', oi: 'Exxon After RemoveRef' }])
    })

    await waitFor(() => {
      expect($.tenants.t1.name.get()).toBe('Exxon After RemoveRef')
    })

    expect($.session.tenant.get().name).toBe('Exxon Mobil')
  })
})
