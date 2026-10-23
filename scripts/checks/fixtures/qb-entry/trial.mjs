import { state } from './state.mjs'
export const isToolInstalled = () => state.installed
export const getToolTrialDaysRemaining = () => state.trialDays
export const getTrialDaysRemaining = () => state.trialDays
