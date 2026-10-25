import { readFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
const source = readFileSync(new URL('../../src/main/dictation/index.ts', import.meta.url), 'utf8')
const part = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)))
const js = transformSync(part('function commandDown()', 'function onDown()') + part('function clearShowTimer()', 'async function onAudio('), {loader:'ts'}).code
export const tick = async () => { for (let n=0;n<8;n++) await Promise.resolve() }
/** Execute the actual command orchestration with deferred native/network boundaries. */
export function commandHarness() {
  return new Function(`
    let now=1000,sessionId=0,commandSession=null,recording=false,busy=false,downAt=0,releasedAt=0,audioReceived=false,uploadStarted=false,maxTimer=null,stopTimer=null,showTimer=null
    let captureDone,sttDone,rewriteDone,pasteDone,pasteStarted,credential='owner',auth=null,starts=0,ends=0,refreshes=0
    const phases=[],requests=[],timers=new Map();let timerId=0
    const setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,at:now+ms});return timerId},clearTimeout=id=>timers.delete(id)
    const advance=async ms=>{now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn()}for(let i=0;i<8;i++)await Promise.resolve()}
    const Date={now:()=>now},isMac=true,MIN_HOLD_MS=300,COMMAND_MAX_MS=30000,RELEASE_PAD_MS=150,PILL_W=220,PILL_ERROR_W=380,IPC_SEND={DICTATION_STOP:'stop'}
    const data={enabled:true,commandMode:true,commandKey:{platform:'darwin',code:105,kind:'key',label:'F13'},microphone:''}
    const settings=()=>data,store={get:k=>data[k]},clipOwner=()=>credential,getCredential=()=>credential,CRED_TOOL='',CRED_TYPE=''
    const setMayRecord=()=>{},setRecordingEscape=()=>{},acceptCommandKey=()=>{},endCommandKey=()=>ends++,getPill=()=>{},showPill=()=>{},hidePill=()=>{},state=s=>phases.push(s),sendPill=()=>{}
    const recordingStart={isReady:true,start:()=>starts++,cancel:()=>{}},gesture={reset:()=>{}},model='gpt-transcribe'
    const captureCommandSelection=signal=>{requests.push({stage:'capture',signal});return new Promise(r=>captureDone=r)}
    const selection={text:'Original 42 — do not change names.',cancel:()=>{}}
    const transcribe=(audio,opts)=>{requests.push({stage:'stt',opts});return new Promise(r=>sttDone=r)}
    const transcribeViaAddon=(audio,a,opts)=>{requests.push({stage:'addon-stt',auth:a,opts});return new Promise(r=>sttDone=r)}
    const rewriteCommand=(instruction,text,opts)=>{requests.push({stage:'rewrite',instruction,text,opts});return new Promise(r=>rewriteDone=r)}
    const replaceCommandSelection=(selection,text,key,current,started)=>{requests.push({stage:'paste',text,key,current});pasteStarted=started;return new Promise(r=>pasteDone=r)}
    const addonTidyFetch=a=>a,viaAddon=()=>!!auth,addonAuth=()=>auth,sameAddonAuth=(a,b)=>JSON.stringify(a)===JSON.stringify(b),refreshAddon=()=>{refreshes++;return Promise.resolve()}
    const transcribeTimeoutMs=()=>45000,ERROR_TEXT={failed:'Failed',network:'No connection',addon_empty:'Top up',no_speech:'Didn’t hear anything'}
    ${js}
    return {start:commandDown,up:commandUp,cancel:cancelCommand,fail:commandFailure,advance,phases,requests,data,
      capture:(r={ok:true,selection})=>captureDone(r),stt:r=>sttDone(r),rewrite:r=>rewriteDone(r),
      paste:ok=>pasteDone(ok),pasteStart:()=>pasteStarted(),audio:()=>runCommandAudio(new ArrayBuffer(2000),'audio/webm',commandSession),
      owner:v=>credential=v,addon:v=>auth=v,snapshot:()=>({recording,busy,sessionId,command:!!commandSession,starts,ends,refreshes})}
  `)()
}
