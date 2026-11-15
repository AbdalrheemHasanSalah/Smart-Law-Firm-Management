import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { GuestOnly, PATHS, Require } from './auth/auth'
import { Forgot, Invitation, Login, LoginChooser, Onboarding, Register, ResetPassword } from './pages/Auth'
import Landing from './pages/Landing'
import { Today } from './pages/Office'
import { CaseFile, Cases, Clients, Contracts, Documents, Tasks, Team } from './pages/Workspace'
import { Messages } from './pages/Messages'
import { Platform, Portal } from './pages/Others'
import { Shell } from './ui/Shell'

const STAFF = ['admin', 'lawyer', 'assistant'] as const

const office = (page: ReactNode, roles: readonly ('admin' | 'lawyer' | 'assistant')[] = STAFF) => (
  <Require roles={roles}>
    <Shell>{page}</Shell>
  </Require>
)

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path={PATHS.home} element={<Landing />} />
      <Route path={PATHS.login} element={<GuestOnly><LoginChooser /></GuestOnly>} />
      <Route path="/login/:portal" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path={PATHS.register} element={<Register />} />
      <Route path={PATHS.forgot} element={<GuestOnly><Forgot /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<Invitation />} />
      <Route path={PATHS.onboarding} element={<Require><Onboarding /></Require>} />

      <Route path={PATHS.office} element={<Require roles={STAFF}><Shell plain><Today /></Shell></Require>} />
      <Route path={`${PATHS.office}/cases`} element={office(<Cases />)} />
      <Route path={`${PATHS.office}/cases/:caseId`} element={office(<CaseFile />)} />
      <Route path={`${PATHS.office}/clients`} element={office(<Clients />)} />
      <Route path={`${PATHS.office}/tasks`} element={office(<Tasks />)} />
      <Route path={`${PATHS.office}/documents`} element={office(<Documents />)} />
      <Route path={`${PATHS.office}/contracts`} element={office(<Contracts />)} />
      <Route path={`${PATHS.office}/team`} element={office(<Team />, ['admin'])} />

      <Route path={`${PATHS.office}/messages`} element={office(<Messages />)} />
      <Route path={`${PATHS.client}/messages`} element={<Require roles={['client']}><Shell><Messages /></Shell></Require>} />
      <Route path={PATHS.client} element={<Require roles={['client']}><Shell><Portal /></Shell></Require>} />
      <Route path={PATHS.platform} element={<Require platform><Shell><Platform /></Shell></Require>} />
      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
  </BrowserRouter>
)
