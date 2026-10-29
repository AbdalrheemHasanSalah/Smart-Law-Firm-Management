export const ALL_STEPS = ['account', 'office', 'lawyer', 'review'] as const
export type WizardStep = (typeof ALL_STEPS)[number]

/** An already signed-in account (e.g. after a rejected office) skips the account step. */
export const stepsFor = (signedIn: boolean): readonly WizardStep[] =>
  signedIn ? ALL_STEPS.filter((step) => step !== 'account') : ALL_STEPS
