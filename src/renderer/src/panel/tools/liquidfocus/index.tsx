/**
 * Liquid Focus in the v2 panel: timer, tasks, stats and settings, wired to the
 * existing Liquid Focus service (liquidfocus:* IPC) and Todoist (todoist:*).
 * Start hides the panel and opens the always-on-top mini timer
 * (src/renderer/src/tools/liquidfocus/LiquidFocusMini.tsx).
 * Prototype routes: liquidfocus, liquidfocus/tasks, liquidfocus/stats,
 * liquidfocus/settings(/durations, /behaviour, /sites, /todoist).
 */

import { ToolId, TODOIST_ENABLED } from '@shared/tool-ids'
import type { LiquidFocusConfig } from '@shared/config-schemas'
import type { PanelToolModule } from '../../types'
import { fmtClock, useToolConfig } from '../../hooks'
import { Ring } from '../../kit'
import { Icon } from '../../icons'
import { useNav } from '../../nav'
import { Background } from './Background'
import { Tasks, TasksRight } from './Tasks'
import { Stats } from './Stats'
import { Behaviour, Durations, MiniTimer, Settings, Sites, Todoist } from './Settings'
import {
  activeTask,
  cycleDots,
  detectorLabel,
  lfPause,
  lfRestart,
  lfSkip,
  lfStart,
  lfStop,
  modeLabel,
  phaseFrac,
  startAndMinimise,
  useDetector,
  useLF
} from './store'

function useStatus(): string {
  const lf = useLF()
  if (!lf) return ''
  const t = lf.timer
  if (t.status === 'running') return fmtClock(t.remaining)
  if (t.status === 'paused') return `Paused · ${fmtClock(t.remaining)}`
  return 'Ready'
}

function Main(): React.JSX.Element {
  const nav = useNav()
  const lf = useLF()
  const det = useDetector()
  const [cfg] = useToolConfig<LiquidFocusConfig>(ToolId.LiquidFocus)
  if (!lf) return <div style={{ height: 300 }} />
  const t = lf.timer
  const task = activeTask(lf)
  const running = t.status !== 'idle'
  const showDetector = !!cfg?.focus_detection_enabled && t.mode === 'work' && t.status === 'running' && det.status !== 'off'
  return (
    <div className="lf-main">
      <button className="task-pick" onClick={() => nav.go('liquidfocus/tasks')}>
        <span>{task?.name || 'Pick a task'}</span>
        <Icon name="chev" />
      </button>
      <div className="lf-ring">
        <Ring size={168} frac={phaseFrac(t)} />
        <div className="c">
          <span className="tm">{fmtClock(t.remaining)}</span>
          <span className="md">{modeLabel(t)}</span>
          <div className="dots" style={{ marginTop: 6 }}>
            {cycleDots(t).map((on, i) => (
              <i key={i} className={on ? 'on' : ''} />
            ))}
          </div>
        </div>
      </div>
      {showDetector ? (
        <span className="detector">
          <span className="pip" />
          {detectorLabel(det)}
        </span>
      ) : null}
      {running ? (
        <div className="btn-row" style={{ width: 220 }}>
          <button className="btn primary lg" onClick={() => (t.status === 'paused' ? lfStart() : lfPause())}>
            {t.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button className="btn lg" onClick={() => lfStop()}>
            Stop
          </button>
        </div>
      ) : (
        <button className="btn primary lg" style={{ width: 160 }} onClick={() => startAndMinimise(nav)}>
          {t.mode === 'work' ? 'Start' : 'Start break'}
        </button>
      )}
      <div className="lf-links">
        <button onClick={() => nav.go('liquidfocus/tasks')}>Tasks</button>
        <button onClick={() => nav.go('liquidfocus/stats')}>Stats</button>
        {running ? (
          <>
            <button onClick={() => lfSkip()}>{t.mode === 'work' ? 'Skip to break' : 'Skip break'}</button>
            <button onClick={() => lfRestart()}>Reset</button>
          </>
        ) : t.mode !== 'work' ? (
          <button onClick={() => lfSkip()}>Skip break</button>
        ) : null}
      </div>
    </div>
  )
}

export const liquidfocusTool: PanelToolModule = {
  id: 'liquidfocus',
  name: 'Liquid Focus',
  desc: 'Focus timer with tasks and site blocking',
  icon: 'liquidfocus',
  useStatus,
  Background,
  routes: {
    liquidfocus: { kind: 'tool', tool: 'liquidfocus', view: Main },
    'liquidfocus/tasks': { kind: 'sub', back: 'liquidfocus', title: 'Tasks', view: Tasks, right: TasksRight },
    'liquidfocus/stats': { kind: 'sub', back: 'liquidfocus', title: 'Stats', view: Stats },
    'liquidfocus/settings': { kind: 'sub', back: 'liquidfocus', title: 'Liquid Focus settings', view: Settings },
    'liquidfocus/settings/durations': { kind: 'sub', back: 'liquidfocus/settings', title: 'Durations', view: Durations },
    'liquidfocus/settings/behaviour': { kind: 'sub', back: 'liquidfocus/settings', title: 'Sounds and detection', view: Behaviour },
    'liquidfocus/settings/sites': { kind: 'sub', back: 'liquidfocus/settings', title: 'Blocked sites', view: Sites },
    'liquidfocus/settings/mini': { kind: 'sub', back: 'liquidfocus/settings', title: 'Mini timer', view: MiniTimer },
    ...(TODOIST_ENABLED
      ? { 'liquidfocus/settings/todoist': { kind: 'sub' as const, back: 'liquidfocus/settings', title: 'Todoist', view: Todoist } }
      : {})
  }
}
