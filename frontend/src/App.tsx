import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { GuestOnly, PATHS, Require } from './auth/auth'
import { Forgot, Invitation, Login, LoginChooser, Onboarding, Register, ResetPassword } from './pages/Auth'
import Landing from './pages/Landing'
import { Today } from './pages/Office'
import { CaseFile, Cases, Clients, Contracts, Documents, Tasks } from './pages/Workspace'
import { MyHr, TeamPage } from './pages/TeamHr'
import { PublicOffice } from './pages/PublicOffice'
import { Consultations, PublicPageSettings } from './pages/PublicPresence'
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
import { LawPage, LegalLibrary, RulingPage } from './pages/LegalLibrary'
import { LibraryImport } from './pages/LibraryImport'
import { LetterheadSettings, Templates, VerifyDocument } from './pages/PrintSettings'
import { ClientBriefcase } from './pages/Workflow'
import { Directory, PlatformCourts } from './pages/Directory'
import { PlatformBackups, SecurityPage } from './pages/Security'
import { Shell } from './ui/Shell'
import { STAFF_ROLES, type Permission } from './lib/permissions'
import type { OfficeRole } from './lib/types'
import { SupportWidget } from './ui/SupportWidget'

const office = (page: ReactNode, roles: readonly OfficeRole[] = STAFF_ROLES, permission?: Permission) => (
  <Require roles={roles} permission={permission}>
    <Shell>{page}</Shell>
  </Require>
)

export const App = () => (
  <BrowserRouter>
    <Routes>
      <Route path={PATHS.home} element={<Landing />} />
      <Route path="/o/:slug" element={<PublicOffice />} />
      <Route path="/v/:code" element={<VerifyDocument />} />
      <Route path={PATHS.login} element={<GuestOnly><LoginChooser /></GuestOnly>} />
      <Route path="/login/:portal" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path={PATHS.register} element={<Register />} />
      <Route path={PATHS.forgot} element={<GuestOnly><Forgot /></GuestOnly>} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:token" element={<Invitation />} />
      <Route path={PATHS.onboarding} element={<Require><Onboarding /></Require>} />

      <Route path={PATHS.office} element={<Require roles={STAFF_ROLES}><Shell plain><Today /></Shell></Require>} />
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
      <Route path={`${PATHS.office}/directory`} element={office(<Directory />)} />
      <Route path={`${PATHS.office}/library`} element={office(<LegalLibrary />)} />
      <Route path={`${PATHS.office}/templates`} element={office(<Templates />)} />
      <Route path={`${PATHS.office}/letterhead`} element={office(<LetterheadSettings />, ['admin'], 'office.manage')} />
      <Route path={`${PATHS.office}/library/laws/:lawId`} element={office(<LawPage />)} />
      <Route path={`${PATHS.office}/library/rulings/:rulingId`} element={office(<RulingPage />)} />
      <Route path={`${PATHS.office}/activity`} element={office(<Activity />, ['admin'], 'office.manage')} />
      <Route path={`${PATHS.office}/calendar`} element={office(<Calendar />)} />
      <Route path={`${PATHS.office}/finance`} element={office(<OfficeFinance />, ['admin'], 'finance.manage')} />
      <Route path={`${PATHS.office}/clients/:clientId/briefcase`} element={office(<ClientBriefcase />)} />
      <Route path={`${PATHS.office}/clients/:clientId/statement`} element={office(<ClientStatement />, ['admin'], 'finance.manage')} />
      <Route path={`${PATHS.client}/statement`} element={<Require roles={['client']}><Shell><PortalStatement /></Shell></Require>} />
      <Route path={`${PATHS.office}/security`} element={office(<SecurityPage />, ['admin'], 'office.manage')} />
      <Route path={`${PATHS.office}/team`} element={office(<TeamPage />, ['admin'], 'office.manage')} />
      <Route path={`${PATHS.office}/me`} element={office(<MyHr />)} />
      <Route path={`${PATHS.office}/consultations`} element={office(<Consultations />)} />
      <Route path={`${PATHS.office}/public-page`} element={office(<PublicPageSettings />, ['admin'], 'office.manage')} />

      <Route path={`${PATHS.office}/messages`} element={office(<Messages />)} />
      <Route path={`${PATHS.client}/messages`} element={<Require roles={['client']}><Shell><Messages /></Shell></Require>} />
      <Route path={PATHS.client} element={<Require roles={['client']}><Shell><Portal /></Shell></Require>} />
      <Route path={`${PATHS.office}/subscription`} element={office(<OfficeSubscription />, ['admin'], 'office.manage')} />
      <Route path={`${PATHS.platform}/support`} element={<Require platform><Shell><SupportInbox /></Shell></Require>} />
      <Route path={`${PATHS.platform}/backups`} element={<Require platform><Shell><PlatformBackups /></Shell></Require>} />
      <Route path={`${PATHS.platform}/courts`} element={<Require platform><Shell><PlatformCourts /></Shell></Require>} />
      <Route path={`${PATHS.platform}/library`} element={<Require platform><Shell><LibraryImport /></Shell></Require>} />
      <Route path={`${PATHS.platform}/subscriptions`} element={<Require platform><Shell><PlatformSubscriptions /></Shell></Require>} />
      <Route path={`${PATHS.platform}/offices/:officeId`} element={<Require platform><Shell><OfficeRequest /></Shell></Require>} />
      <Route path={PATHS.platform} element={<Require platform><Shell><Platform /></Shell></Require>} />
      <Route path="*" element={<Navigate to={PATHS.home} replace />} />
    </Routes>
    <SupportWidget />
  </BrowserRouter>
)
