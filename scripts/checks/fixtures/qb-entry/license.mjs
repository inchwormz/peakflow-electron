import { state } from './state.mjs'
export const isLicensed = async () => state.licensed
export const isToolLicensed = () => state.coversTool
export const isSuiteLicense = () => state.coversTool
