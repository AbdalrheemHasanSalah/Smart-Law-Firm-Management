import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { GuestOnly, PATHS, Require } from './auth/auth'
import { Forgot, Invitation, Login, LoginChooser, Onboarding, Register, ResetPassword } from './pages/Auth'
import Landing from './pages/Landing'
import { Today } from './pages/Office'
import { CaseFile, Cases, Clients, Contracts, Documents, Tasks } from './pages/Workspace'
import { MyHr, TeamPage } from './pages/TeamHr'
import { Messages } from './pages/Messages'
import { OfficeRequest, Platform } from './pages/OfficeRequests'
import { Portal } from './pages/Others'
import { PowersOfAttorney } from './pages/PowersOfAttorney'
import { MyCustody } from './pages/FinanceOffice'
import { Reports } from './pages/Reports'
import { OfficeSubscription, PlatformSubscriptions } from './pages/Subscriptions'
import { Activity } from './pages/Activity'
import { Calendar } from './pages/Calendar'
import { ClientStatement, OfficeFinance, PortalStatement } from './pages/Finance'
import { SupportInbox } from './pages/Support'
import { Tools } from './pages/Tools'
import { Shell } from './ui/Shell'
import { SupportWidget } from './ui/SupportWidget'

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
      <Route path={`${PATHS.office}/powers-of-attorney`} element={office(<PowersOfAttorney />)} />
      <Route path={`${PATHS.office}/custody`} element={office(<MyCustody />)} />
      <Route path={`${PATHS.office}/reports`} element={office(<Reports />)} />
      <Route path={`${PATHS.office}/tools`} element={office(<Tools />)} />
      <Route path={`${PATHS.office}/activity`} element={office(<Activity />, ['admin'])} />
      <Route path={`${PATHS.office}/calendar`} element={office(<Calendar />)} />
      <Route path={`${PATHS.office}/finance`} element={office(<OfficeFinance />, ['admin'])} />
      <Route path={`${PATHS.office}/clients/:clientId/statement`} element={office(<ClientStatement />, ['admin'])} />
      <Route path={`${PATHS.client}/statement`} element={<Require roles={['client']}><Shell><PortalStatement /></Shell></Require>} />
      <Route path={`${PATHS.office}/team`} element={office(<TeamPage />, ['admin'])} />
      <Route path={`${PATHS.office}/me`} element={office(<MyHr />)} />

      <Route path={`${PATHS.office}/messages`} element={office(<Messages />)} />
      <Route path={`${PATHS.client}/messages`} element={<Require roles={['client']}><Shell><Messages /></Shell></Require>} />
      <Route path={PATHS.client} element={<Require roles={['client']}><Shell><Portal /></Shell></Require>} />
      <Route path={`${PATHS.office}/subscription`} element={office(<OfficeSubscription />, ['admin'])} />
      <Route path={`${PATHS.platform}/support`} element={<Require platform><Shell><SupportInbox /></Shell></Require>} />
      <Route path={`${PATHS.platform}/subscriptions`} element={<Require platform><Shell><PlatformSubscriptions /></Shell></Require>} />
      <Route path={`${PATHS.platform}/offices/:officeId`} element={<Require platform><Shell><OfficeRequest /></Shell></Require>} />
      <Route path={PATHS.platform} element={<Require platform><Shell><Platform /></Shell></Require>} />
      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
    <SupportWidget />
  </BrowserRouter>
)
