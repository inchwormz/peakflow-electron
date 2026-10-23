/** Liquid Focus stats: totals, streak, today, 7-day average and bars, from the service's real stats. */

import { Note } from '../../kit'
import { useLF } from './store'

function fmtFocus(mins: number): string {
  if (mins < 60) return `${Math.round(mins)} min`
  return `${(Math.round((mins / 60) * 10) / 10).toString()} h`
}

export function Stats(): React.JSX.Element {
  const lf = useLF()
  if (!lf) return <div style={{ height: 200 }} />
  const s = lf.stats
  const days = s.dailyBreakdown ?? []
  const week = days.reduce((a, d) => a + d.count, 0)
  const avg = Math.round((week / 7) * 10) / 10
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <>
      <div className="statgrid">
        <div>
          <b>{fmtFocus(s.allTime * lf.workDurationMinutes)}</b>
          <span>Focus time</span>
        </div>
        <div>
          <b>{s.allTime}</b>
          <span>Sessions</span>
        </div>
        <div>
          <b>{s.interruptions}</b>
          <span>Interruptions</span>
        </div>
      </div>
      <div className="statgrid" style={{ marginTop: 8, borderTop: '0.5px solid var(--line)' }}>
        <div>
          <b>
            {s.streak} {s.streak === 1 ? 'day' : 'days'}
          </b>
          <span>Streak</span>
        </div>
        <div>
          <b>{s.today}</b>
          <span>Today</span>
        </div>
        <div>
          <b>{avg}</b>
          <span>Average a day</span>
        </div>
      </div>
      <div className="cap" style={{ marginTop: 16 }}>
        Last 7 days
      </div>
      <div className="bars7">
        {days.map((d, i) => (
          <div key={d.date}>
            <em>{d.count}</em>
            <i className={i === days.length - 1 ? 'today' : ''} style={{ height: Math.round((d.count / max) * 52) + 2 }} />
            <span>{Number(d.date.slice(8, 10))}</span>
          </div>
        ))}
      </div>
      <Note style={{ marginTop: 12 }}>Interruptions are counted when focus detection sees you look away.</Note>
    </>
  )
}
