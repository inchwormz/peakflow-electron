/**
 * OnboardingWizard — 4-step AI-powered setup wizard for QuickBoard.
 * Asks about role, apps, copy patterns, then generates personalized config.
 */

import { useState, useEffect } from 'react'
import { DS } from './shared'
import { IPC_INVOKE } from '@shared/ipc-types'

interface OnboardingWizardProps {
  onComplete: () => void
  onSkip: () => void
}

const ROLES = [
  'Software Developer',
  'Designer',
  'Writer / Content',
  'Project Manager',
  'Student / Researcher',
  'Marketing / Sales',
  'Support'
]

const APPS = [
  'VS Code / IDE',
  'Browser',
  'Slack / Teams',
  'Figma / Design tools',
  'Terminal',
  'Email',
  'Word processor',
  'Spreadsheets'
]

const COPY_PATTERNS = [
  'Code snippets',
  'URLs',
  'Error messages / logs',
  'Text passages',
  'Email addresses',
  'File paths'
]

const DEV_LANGUAGES = ['TypeScript', 'JavaScript', 'Python', 'Go', 'Rust', 'Java', 'C#', 'Ruby', 'PHP', 'Swift']
const DEV_AI_TOOLS = ['Claude Code', 'Cursor', 'GitHub Copilot', 'ChatGPT', 'Windsurf', 'Aider']
const DEV_FRAMEWORKS = ['React', 'Next.js', 'Node.js', 'Django', 'FastAPI', 'Rails', 'Spring', '.NET', 'Vue', 'Svelte']
const DEV_GIT_HOSTS = ['GitHub', 'GitLab', 'Bitbucket']

type StepId = 'role' | 'devtools' | 'apps' | 'patterns' | 'setup'

function getSteps(isDev: boolean): { id: StepId; label: string }[] {
  const steps: { id: StepId; label: string }[] = [{ id: 'role', label: 'Role' }]
  if (isDev) steps.push({ id: 'devtools', label: 'Stack' })
  steps.push({ id: 'apps', label: 'Apps' }, { id: 'patterns', label: 'Patterns' }, { id: 'setup', label: 'Setup' })
  return steps
}

/** Chip button with hover interaction */
function HoverChip({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '7px 14px',
        borderRadius: 20,
        border: `1px solid ${active ? DS.accent : hovered ? DS.textGhost : DS.border}`,
        background: active ? DS.accent + '18' : hovered ? DS.bgHover : DS.bgLight,
        color: active ? DS.accent : hovered ? DS.textPrimary : DS.textSecondary,
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'inherit',
        fontWeight: active ? 600 : 400,
        transition: 'all 0.2s',
        outline: 'none'
      }}
    >
      {label}
    </button>
  )
}

/** Animated loading dots */
function PulsingDots(): React.JSX.Element {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCount((c) => (c + 1) % 4), 400)
    return () => clearInterval(id)
  }, [])
  return <span>{'\u00B7'.repeat(count + 1)}</span>
}

/** Footer button with hover state */
function FooterButton({
  label,
  onClick,
  primary = false,
  disabled = false,
  flex = false
}: {
  label: string
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  flex?: boolean
}): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const active = !disabled && hovered
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: flex ? 1 : undefined,
        padding: '9px 14px',
        borderRadius: 8,
        border: primary ? 'none' : `1px solid ${active ? DS.textGhost : DS.border}`,
        background: primary
          ? disabled ? DS.surface : DS.accent
          : active ? DS.bgHover : 'transparent',
        color: primary
          ? disabled ? DS.textDim : DS.bg
          : active ? DS.textPrimary : DS.textDim,
        fontSize: 10,
        fontWeight: primary ? 600 : 500,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'inherit',
        transition: 'all 0.2s',
        outline: 'none'
      }}
    >
      {label}
    </button>
  )
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingWizardProps): React.JSX.Element {
  const [step, setStep] = useState(0)
  const [role, setRole] = useState('')
  const [customRole, setCustomRole] = useState('')
  const [selectedApps, setSelectedApps] = useState<string[]>([])
  const [selectedPatterns, setSelectedPatterns] = useState<string[]>([])
  const [repetitiveText, setRepetitiveText] = useState('')
  const [devLanguages, setDevLanguages] = useState<string[]>([])
  const [devAiTools, setDevAiTools] = useState<string[]>([])
  const [devFrameworks, setDevFrameworks] = useState<string[]>([])
  const [devGitHost, setDevGitHost] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewConfig, setPreviewConfig] = useState<{
    tags?: string[]
    pinnedTemplates?: Array<{ text: string; label: string }>
    workflows?: Array<{ name: string; description: string; items: Array<{ label: string; text: string }> }>
    formProfiles?: Array<{ name: string; fields: Array<{ label: string; value: string; type: string }> }>
  } | null>(null)

  const effectiveRole = role === 'Other' ? customRole : role
  const isDev = effectiveRole === 'Software Developer'
  const steps = getSteps(isDev)
  const currentStepId = steps[step]?.id ?? 'role'
  const generateStepIndex = steps.findIndex((s) => s.id === 'patterns')
  const previewStepIndex = steps.findIndex((s) => s.id === 'setup')
  const previewTags = Array.isArray(previewConfig?.tags) ? previewConfig.tags : []
  const previewTemplates = Array.isArray(previewConfig?.pinnedTemplates) ? previewConfig.pinnedTemplates : []
  const previewWorkflows = Array.isArray(previewConfig?.workflows) ? previewConfig.workflows : []
  const previewProfiles = Array.isArray(previewConfig?.formProfiles) ? previewConfig.formProfiles : []

  const toggleMulti = (list: string[], item: string, setter: (v: string[]) => void): void => {
    setter(list.includes(item) ? list.filter((i) => i !== item) : [...list, item])
  }

  const generateConfig = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        role: effectiveRole,
        apps: selectedApps,
        copyPatterns: selectedPatterns,
        repetitiveText
      }
      if (isDev) {
        payload.devContext = {
          languages: devLanguages,
          frameworks: devFrameworks,
          infra: [],
          gitHost: devGitHost,
          packageManagers: [],
          terminal: [],
          deployment: [],
          commonCommands: ''
        }
        if (devAiTools.length) payload.aiTools = devAiTools
      }
      const res = await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_AI_ONBOARD, payload) as {
        ok: boolean; config?: typeof previewConfig; error?: string
      }

      if (res.ok && res.config) {
        setPreviewConfig(res.config)
        setStep(previewStepIndex)
      } else {
        setError(res.error || 'Failed to generate configuration')
      }
    } catch {
      setError('Network error. Check your connection.')
    } finally {
      setLoading(false)
    }
  }

  const applyConfig = async (): Promise<void> => {
    if (!previewConfig) return
    setLoading(true)
    try {
      await window.peakflow.invoke(IPC_INVOKE.CLIPBOARD_ONBOARDING_APPLY_CONFIG, previewConfig)
      onComplete()
    } catch {
      setError('Failed to apply configuration')
      setLoading(false)
    }
  }

  const canProceed = (): boolean => {
    if (currentStepId === 'role') return !!effectiveRole
    if (currentStepId === 'devtools') return devLanguages.length > 0
    if (currentStepId === 'apps') return selectedApps.length > 0
    return true
  }

  const categoryStyle = (color: string): React.CSSProperties => ({
    marginBottom: 12,
    paddingLeft: 10,
    borderLeft: `2px solid ${color}`
  })

  const categoryLabelStyle: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '1.5px',
    textTransform: 'uppercase',
    color: DS.textLabel,
    marginBottom: 6
  }

  const previewItemStyle: React.CSSProperties = {
    fontSize: 10,
    padding: '4px 8px',
    marginBottom: 2,
    borderRadius: 4,
    background: DS.bgLight,
    color: DS.textSecondary
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      padding: '20px 24px',
      animation: 'fadeIn 0.2s ease'
    }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontSize: 14,
          fontWeight: 400,
          color: DS.textPrimary,
          fontFamily: "'Silkscreen', cursive"
        }}>
          QuickBoard Setup
        </div>

        {/* Step indicator dots */}
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 0,
          marginTop: 16
        }}>
          {steps.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center' }}>
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 5
              }}>
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: i <= step ? DS.accent : 'transparent',
                  border: `1.5px solid ${i <= step ? DS.accent : DS.textGhost}`,
                  transition: 'all 0.3s ease',
                  boxShadow: i === step ? `0 0 8px ${DS.accent}44` : 'none'
                }} />
                <span style={{
                  fontSize: 8,
                  fontWeight: i === step ? 600 : 400,
                  color: i === step ? DS.accent : i < step ? DS.textDim : DS.textGhost,
                  letterSpacing: '0.5px',
                  transition: 'color 0.3s'
                }}>
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div style={{
                  width: isDev ? 20 : 28,
                  height: 1,
                  background: i < step ? DS.accent + '66' : DS.textGhost + '44',
                  marginBottom: 16,
                  transition: 'background 0.3s'
                }} />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step content */}
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {currentStepId === 'role' && (
          <div style={{ animation: 'fadeIn 0.2s ease' }}>
            <div style={{ fontSize: 12, color: DS.textSecondary, marginBottom: 12 }}>
              What do you do?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {ROLES.map((r) => (
                <HoverChip key={r} label={r} active={role === r} onClick={() => setRole(r)} />
              ))}
              <HoverChip label="Other" active={role === 'Other'} onClick={() => setRole('Other')} />
            </div>
            {role === 'Other' && (
              <input
                type="text"
                placeholder="Your role..."
                value={customRole}
                onChange={(e) => setCustomRole(e.target.value)}
                style={{
                  marginTop: 10,
                  width: '100%',
                  background: DS.bgLight,
                  border: `1px solid ${DS.border}`,
                  borderRadius: 8,
                  padding: '8px 12px',
                  fontSize: 11,
                  color: DS.textPrimary,
                  fontFamily: 'inherit',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
              />
            )}
          </div>
        )}

        {currentStepId === 'devtools' && (
          <div style={{ animation: 'fadeIn 0.2s ease' }}>
            <div style={{ fontSize: 12, color: DS.textSecondary, marginBottom: 10 }}>
              What's your stack?
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, color: DS.textLabel, marginBottom: 5 }}>Languages</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {DEV_LANGUAGES.map((l) => (
                <HoverChip key={l} label={l} active={devLanguages.includes(l)} onClick={() => toggleMulti(devLanguages, l, setDevLanguages)} />
              ))}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, color: DS.textLabel, marginBottom: 5 }}>AI Tools</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {DEV_AI_TOOLS.map((t) => (
                <HoverChip key={t} label={t} active={devAiTools.includes(t)} onClick={() => toggleMulti(devAiTools, t, setDevAiTools)} />
              ))}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, color: DS.textLabel, marginBottom: 5 }}>Frameworks</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
              {DEV_FRAMEWORKS.map((f) => (
                <HoverChip key={f} label={f} active={devFrameworks.includes(f)} onClick={() => toggleMulti(devFrameworks, f, setDevFrameworks)} />
              ))}
            </div>
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '1px', textTransform: 'uppercase' as const, color: DS.textLabel, marginBottom: 5 }}>Git Host</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {DEV_GIT_HOSTS.map((g) => (
                <HoverChip key={g} label={g} active={devGitHost.includes(g)} onClick={() => toggleMulti(devGitHost, g, setDevGitHost)} />
              ))}
            </div>
          </div>
        )}

        {currentStepId === 'apps' && (
          <div style={{ animation: 'fadeIn 0.2s ease' }}>
            <div style={{ fontSize: 12, color: DS.textSecondary, marginBottom: 12 }}>
              Which apps do you use daily?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {APPS.map((app) => (
                <HoverChip
                  key={app}
                  label={app}
                  active={selectedApps.includes(app)}
                  onClick={() => toggleMulti(selectedApps, app, setSelectedApps)}
                />
              ))}
            </div>
          </div>
        )}

        {currentStepId === 'patterns' && (
          <div style={{ animation: 'fadeIn 0.2s ease' }}>
            <div style={{ fontSize: 12, color: DS.textSecondary, marginBottom: 12 }}>
              What do you copy most?
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {COPY_PATTERNS.map((pat) => (
                <HoverChip
                  key={pat}
                  label={pat}
                  active={selectedPatterns.includes(pat)}
                  onClick={() => toggleMulti(selectedPatterns, pat, setSelectedPatterns)}
                />
              ))}
            </div>
            <div style={{ fontSize: 11, color: DS.textDim, marginBottom: 6 }}>
              Any text you type repeatedly?
            </div>
            <textarea
              placeholder="e.g. email sign-off, common response..."
              value={repetitiveText}
              onChange={(e) => setRepetitiveText(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                background: DS.bgLight,
                border: `1px solid ${DS.border}`,
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 11,
                color: DS.textPrimary,
                fontFamily: 'inherit',
                outline: 'none',
                resize: 'vertical',
                transition: 'border-color 0.2s'
              }}
            />
          </div>
        )}

        {currentStepId === 'setup' && previewConfig && (
          <div style={{ animation: 'fadeIn 0.25s ease' }}>
            <div style={{ fontSize: 12, color: DS.textSecondary, marginBottom: 14 }}>
              Your personalized setup:
            </div>

            {previewTags.length > 0 && (
              <div style={categoryStyle(DS.accent + '66')}>
                <div style={categoryLabelStyle}>Tags</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {previewTags.map((tag) => (
                    <span key={tag} style={{
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: DS.accent + '11',
                      border: `1px solid ${DS.accent}22`,
                      color: DS.accent
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {previewTemplates.length > 0 && (
              <div style={categoryStyle(DS.yellow + '66')}>
                <div style={categoryLabelStyle}>Pinned Templates</div>
                {previewTemplates.map((t, i) => (
                  <div key={i} style={previewItemStyle}>
                    <span style={{ color: DS.textDim, fontWeight: 600 }}>{t.label}</span>
                    {' '}{t.text.slice(0, 40)}{t.text.length > 40 ? '\u2026' : ''}
                  </div>
                ))}
              </div>
            )}

            {previewWorkflows.length > 0 && (
              <div style={categoryStyle(DS.textMuted + '66')}>
                <div style={categoryLabelStyle}>Workflows</div>
                {previewWorkflows.map((w, i) => (
                  <div key={i} style={previewItemStyle}>
                    {w.name} <span style={{ color: DS.textDim }}>({Array.isArray(w.items) ? w.items.length : 0} steps)</span>
                  </div>
                ))}
              </div>
            )}

            {previewProfiles.length > 0 && (
              <div style={categoryStyle(DS.red + '44')}>
                <div style={categoryLabelStyle}>Form Profiles</div>
                {previewProfiles.map((p, i) => (
                  <div key={i} style={previewItemStyle}>
                    {p.name} <span style={{ color: DS.textDim }}>({Array.isArray(p.fields) ? p.fields.length : 0} fields)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && (
          <div style={{
            textAlign: 'center',
            padding: 24,
            color: DS.accent,
            fontSize: 11,
            fontWeight: 500
          }}>
            Generating your setup <PulsingDots />
          </div>
        )}

        {error && (
          <div style={{
            padding: '6px 10px',
            fontSize: 10,
            color: DS.red,
            marginTop: 8,
            borderRadius: 6,
            background: DS.red + '11',
            border: `1px solid ${DS.red}22`
          }}>
            {error}
          </div>
        )}
      </div>

      {/* Footer buttons */}
      <div style={{ display: 'flex', gap: 8, paddingTop: 16 }}>
        <FooterButton label="Skip" onClick={onSkip} />

        {step > 0 && step < previewStepIndex && (
          <FooterButton label="Back" onClick={() => setStep(step - 1)} />
        )}

        {step < generateStepIndex && (
          <FooterButton
            label="Next"
            onClick={() => setStep(step + 1)}
            disabled={!canProceed()}
            primary
            flex
          />
        )}

        {step === generateStepIndex && (
          <FooterButton
            label={loading ? 'Generating\u2026' : 'Generate Setup'}
            onClick={generateConfig}
            disabled={loading}
            primary
            flex
          />
        )}

        {step === previewStepIndex && (
          <>
            <FooterButton
              label="Re-generate"
              onClick={() => { setStep(generateStepIndex); setPreviewConfig(null) }}
            />
            <FooterButton
              label="Apply & Start"
              onClick={applyConfig}
              disabled={loading}
              primary
              flex
            />
          </>
        )}
      </div>
    </div>
  )
}
