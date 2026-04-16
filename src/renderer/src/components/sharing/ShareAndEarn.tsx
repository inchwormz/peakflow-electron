/**
 * ShareAndEarn — referral section for the Dashboard.
 *
 * Shows social share buttons + tool ownership status.
 * Opens external links via shell:open-external IPC.
 */

import { useCallback, type CSSProperties } from 'react'
import { ToolId, TOOL_DISPLAY_NAMES } from '@shared/tool-ids'
import { IPC_INVOKE } from '@shared/ipc-types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ShareAndEarnProps {
  ownedTools: ToolId[]
}

// ─── Social links ───────────────────────────────────────────────────────────

const SHARE_LINKS = [
  {
    platform: 'Twitter / X',
    url: 'https://twitter.com/intent/tweet?text=I%27ve%20been%20using%20FocusDim%20from%20%40PeakFlow%20to%20dim%20everything%20except%20my%20active%20window.%20Actually%20helps%20me%20focus.%20Free%20trial%2C%20no%20sign-up%3A%20getpeakflow.pro&url=https%3A%2F%2Fgetpeakflow.pro',
    icon: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'
  },
  {
    platform: 'LinkedIn',
    url: 'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fgetpeakflow.pro',
    icon: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z'
  },
  {
    platform: 'Reddit',
    url: 'https://reddit.com/submit?url=https%3A%2F%2Fgetpeakflow.pro&title=PeakFlow%20%E2%80%94%20Windows%20productivity%20suite%20with%20tools%20I%20haven%27t%20seen%20elsewhere',
    icon: 'M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z'
  }
]

const ALL_TOOLS = Object.values(ToolId)

// ─── Tool accent colors ─────────────────────────────────────────────────────

const TOOL_ACCENTS: Record<ToolId, string> = {
  [ToolId.LiquidFocus]: '#ffe17c',
  [ToolId.FocusDim]: '#ffe17c',
  [ToolId.QuickBoard]: '#ffe17c',
  [ToolId.ScreenSlap]: '#ffe17c',
  [ToolId.MeetReady]: '#ffe17c',
  [ToolId.SoundSplit]: '#ffe17c'
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ShareAndEarn({ ownedTools }: ShareAndEarnProps): React.JSX.Element {
  const allOwned = ownedTools.length >= ALL_TOOLS.length

  const openExternal = useCallback((url: string) => {
    window.peakflow.invoke(IPC_INVOKE.SHELL_OPEN_EXTERNAL, url).catch(() => {})
  }, [])

  const openMailto = useCallback(() => {
    // mailto: doesn't need https:// prefix — use shell directly
    window.peakflow.invoke(
      IPC_INVOKE.SHELL_OPEN_EXTERNAL,
      'https://getpeakflow.pro/share'
    ).catch(() => {})
  }, [])

  // ── Styles ──────────────────────────────────────────────────────────────

  const section: CSSProperties = {
    flexShrink: 0,
    marginTop: 12,
    padding: '14px 14px 16px',
    borderRadius: 10,
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-surface)'
  }

  const heading: CSSProperties = {
    fontSize: 12,
    fontFamily: "'Outfit', sans-serif",
    fontWeight: 600,
    color: '#ffe17c',
    marginBottom: 4
  }

  const subtext: CSSProperties = {
    fontSize: 11,
    color: 'var(--text-dim)',
    lineHeight: 1.5,
    marginBottom: 10
  }

  const btnRow: CSSProperties = {
    display: 'flex',
    gap: 6,
    marginBottom: 10,
    flexWrap: 'wrap'
  }

  const shareBtn: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: '7px 10px',
    borderRadius: 8,
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 600,
    fontFamily: "'Outfit', sans-serif",
    background: 'rgba(255,225,124,0.12)',
    color: '#ffe17c',
    transition: 'background 0.2s'
  }

  const submitBtn: CSSProperties = {
    width: '100%',
    padding: '8px 12px',
    borderRadius: 8,
    border: 'none',
    outline: 'none',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: "'Outfit', sans-serif",
    background: '#ffe17c',
    color: '#0a0a0a',
    transition: 'opacity 0.2s',
    marginBottom: 10
  }

  const toolRow: CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4
  }

  const successMsg: CSSProperties = {
    fontSize: 11,
    color: '#ffe17c',
    textAlign: 'center',
    padding: '6px 0'
  }

  return (
    <div style={section}>
      <div style={heading}>Share &amp; Earn Free Tools</div>

      {allOwned ? (
        <div style={successMsg}>You've got the full suite! Thanks for spreading the word.</div>
      ) : (
        <>
          <div style={subtext}>
            Post about PeakFlow on social media. Send us a screenshot. Pick any tool for free.
          </div>

          <div style={btnRow}>
            {SHARE_LINKS.map((link) => (
              <button
                key={link.platform}
                style={shareBtn}
                onClick={() => openExternal(link.url)}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,225,124,0.22)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,225,124,0.12)' }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d={link.icon} />
                </svg>
                {link.platform}
              </button>
            ))}
          </div>

          <button
            style={submitBtn}
            onClick={openMailto}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
          >
            Submit Screenshot &amp; Pick a Tool
          </button>

          <div style={toolRow}>
            {ALL_TOOLS.map((id) => {
              const owned = ownedTools.includes(id)
              const chipStyle: CSSProperties = {
                fontSize: 9,
                fontWeight: 600,
                padding: '3px 8px',
                borderRadius: 6,
                background: owned ? TOOL_ACCENTS[id] + '20' : 'transparent',
                color: owned ? TOOL_ACCENTS[id] : 'var(--text-dim)',
                border: owned ? 'none' : '1px dashed rgba(255,255,255,0.12)'
              }
              return (
                <span key={id} style={chipStyle}>
                  {owned ? '\u2713 ' : ''}{TOOL_DISPLAY_NAMES[id]}
                </span>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
