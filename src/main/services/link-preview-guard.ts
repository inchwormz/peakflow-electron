/**
 * Which addresses a QuickBoard link preview may contact: public internet
 * only. Private, local, link-local and reserved addresses are refused, so a
 * copied link can't make PeakFlow call a router, printer or other device on
 * the home or office network, or a service on this computer.
 *
 * No Electron import: the checks in scripts/checks load this file directly.
 */

import { BlockList, isIP } from 'node:net'

const blocked = new BlockList()
for (const [net, bits] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4] // reserved, broadcast
] as const) blocked.addSubnet(net, bits, 'ipv4')
for (const [net, bits] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::', 96], // IPv4-compatible (deprecated)
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments (Teredo and others)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4: wraps an IPv4 address
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // old site-local
  ['ff00::', 8] // multicast
] as const) blocked.addSubnet(net, bits, 'ipv6')

/** The 8 groups of an IPv6 address (dotted IPv4 tail allowed), or null. */
function v6Groups(addr: string): number[] | null {
  let a = addr
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (tail) {
    const p = tail[1].split('.').map(Number)
    a = a.slice(0, -tail[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`
  }
  const halves = a.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null
  const groups = rest === null ? head : [...head, ...new Array<string>(Math.max(0, 8 - head.length - rest.length)).fill('0'), ...rest]
  if (groups.length !== 8) return null
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/i.test(g) ? parseInt(g, 16) : NaN))
  return out.some(Number.isNaN) ? null : out
}

/** IPv4 address inside an IPv4-mapped (::ffff:0:0/96) or NAT64 (64:ff9b::/96) IPv6 address. */
function embeddedV4(addr: string): string | null {
  const g = v6Groups(addr)
  if (!g) return null
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)
  if (!mapped && !nat64) return null
  return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`
}

/** `true` when an IP address is on the public internet. Anything unparseable counts as not public. */
export function isPublicAddress(address: string): boolean {
  const addr = address.replace(/^\[|\]$/g, '').replace(/%.*$/, '')
  const kind = isIP(addr)
  if (kind === 4) return !blocked.check(addr, 'ipv4')
  if (kind !== 6) return false
  const v4 = embeddedV4(addr)
  if (v4) return isPublicAddress(v4)
  return !blocked.check(addr, 'ipv6')
}

/**
 * Parse a copied link and decide whether a preview may be fetched. Only
 * http(s) on the default ports, no user name or password in the link, and a
 * host that is a public IP address or a dotted name outside local-only
 * domains. Names are checked again after DNS lookup (linkPreviewLookup).
 */
export function previewableUrl(raw: string): URL | null {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (u.port && u.port !== '80' && u.port !== '443') return null
  const host = u.hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return null
  if (isIP(host.replace(/^\[|\]$/g, ''))) return isPublicAddress(host) ? u : null
  if (!host.includes('.')) return null // "localhost", "router", intranet names
  if (/\.(?:local|localhost|localdomain|home|lan|internal|intranet|corp|home\.arpa|test|invalid|example|onion)$/.test(host)) return null
  return u
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | Array<{ address: string; family: number }>, family?: number) => void

/**
 * A `lookup` for http.request: resolves the name, and fails if ANY address
 * is not public. Runs at connect time, so a name can't pass a check and then
 * resolve somewhere private for the real request.
 */
export function guardedLookup(
  resolve: (host: string, cb: (err: NodeJS.ErrnoException | null, addrs: Array<{ address: string; family: number }>) => void) => void
) {
  return (hostname: string, options: { all?: boolean } | number | undefined, cb: LookupCb): void => {
    resolve(hostname, (err, addrs) => {
      if (err) return cb(err, '', 0)
      if (!addrs.length || addrs.some((a) => !isPublicAddress(a.address))) {
        const e = new Error(`Link preview refused: ${hostname} is a private or local address`) as NodeJS.ErrnoException
        e.code = 'EPRIVATEADDR'
        return cb(e, '', 0)
      }
      if (typeof options === 'object' && options?.all) return cb(null, addrs)
      cb(null, addrs[0].address, addrs[0].family)
    })
  }
}
