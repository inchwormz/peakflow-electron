/**
 * QuickBoard's way to connect ChatGPT or Claude: the launcher's Connect AI
 * screen, which installs and signs in to the person's own Codex or Claude Code.
 */

import { IPC_INVOKE } from '@shared/ipc-types'
import { invoke } from '../../hooks'
import { Btn } from '../../kit'

/** The AI errors that Connect fixes */
export const needsConnect = (error: string | undefined): boolean => error === 'no_provider' || error === 'not_signed_in'

export function ConnectAiBtn({ primary, block }: { primary?: boolean; block?: boolean }): React.JSX.Element {
  return (
    <Btn primary={primary} block={block} onClick={() => void invoke(IPC_INVOKE.LAUNCHER_AI_OPEN_SETUP).catch(() => {})}>
      Connect ChatGPT or Claude
    </Btn>
  )
}
