/**
 * Optional separate profile for trying a build next to an installed PeakFlow.
 * `PEAKFLOW_USER_DATA=/path npm run dev` keeps this run's settings, clips and
 * single-instance lock apart from the installed app. Must be imported first
 * in index.ts, before anything opens a store.
 */

import { app } from 'electron'

const dir = process.env['PEAKFLOW_USER_DATA']
if (dir) app.setPath('userData', dir)
