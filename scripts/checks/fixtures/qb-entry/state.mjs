// Shared state for quickboard-paste.check.mts fakes
export const state = globalThis.__qb ??= { licensed: false, coversTool: false, installed: true, trialDays: 0, calls: [], workflow: false, form: false }
