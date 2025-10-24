import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Editor from '@monaco-editor/react'
import './App.css'

type Screen = 'gate' | 'playground'

function App() {
  const [screen, setScreen] = useState<Screen>('gate')
  const [roomId, setRoomId] = useState<string>("")
  const [displayName, setDisplayName] = useState<string>("")

  return (
    <div className="app-root">
      <AnimatePresence mode="wait">
        {screen === 'gate' ? (
          <motion.div
            key="gate"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.3 }}
          >
            <RoomGate
              onEnter={(id, name) => {
                setRoomId(id)
                setDisplayName(name)
                setScreen('playground')
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="play"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <CodingPlayground roomId={roomId} name={displayName} onBack={() => setScreen('gate')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function RoomGate({ onEnter }: { onEnter: (roomId: string, name: string) => void }) {
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const createRoom = async () => {
    if (!id || !name) {
      setError('Enter a room ID and your name')
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Optional: inform backend. Our server lazily creates rooms, so this is cosmetic.
      await fetch('http://localhost:8080/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: id }),
      })
    } catch (e) {
      // ignore network errors; joining still works
    } finally {
      setBusy(false)
      onEnter(id, name)
    }
  }

  return (
    <div className="gate">
      <motion.h1 initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ type: 'spring' }}>
        Code Rooms
      </motion.h1>
      <p className="subtitle">Create or join a collaborative coding room</p>

      <div className="gate-card">
        <div className="input-row">
          <input
            className="text-input"
            placeholder="Enter room ID (e.g., 1)"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
        </div>
        <div className="input-row" style={{marginTop:12}}>
          <input
            className="text-input"
            placeholder="Enter your display name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="buttons">
          <button className="btn primary" disabled={busy || !id || !name} onClick={createRoom}>
            {creating ? 'Creating…' : 'Create Room'}
          </button>
          <button className="btn secondary" disabled={!id || !name} onClick={() => onEnter(id, name)}>
            Join Room
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

type Op = { pos: number; del: number; ins: string }
type Envelope = { type: 'presence'|'code'|'op'|'snapshot'; id: string; name: string; ts: number; action?: 'join'|'ping'|'leave'; payload?: string; op?: Op; text?: string }

function CodingPlayground({ roomId, name, onBack }: { roomId: string; name: string; onBack: () => void }) {
  const [wsState, setWsState] = useState<'closed' | 'open' | 'connecting'>('connecting')
  const [code, setCode] = useState<string>(`// Implement the function below\nfunction solve(input) {\n  // TODO\n  return input;\n}`)
  const [activeTab, setActiveTab] = useState<'testcases'|'result'|'console'>('testcases')
  const [testCases, setTestCases] = useState<Array<{id:number; input:string; expected:string; status?:'pass'|'fail'|'error'; output?:string; error?:string; durationMs?:number}>>([
    { id: 1, input: '1', expected: '1' },
    { id: 2, input: '"a"', expected: '"a"' },
  ])
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const [peers, setPeers] = useState<Record<string, { name: string; lastSeen: number }>>({})
  const [peerCode, setPeerCode] = useState<Record<string, string>>({}) // latest live text
  const [peerEvents, setPeerEvents] = useState<Record<string, Array<{ type:'op'|'snapshot'; ts:number; op?:Op; text?:string }>>>({})
  const [playbackIndex, setPlaybackIndex] = useState<number>(-1) // -1 means live tail
  const [playing, setPlaying] = useState<boolean>(false)

  const wsRef = useRef<WebSocket | null>(null)
  const idRef = useRef<string>(Math.random().toString(36).slice(2))
  const lastSentRef = useRef<string>("")
  const lastKeyframeRef = useRef<number>(0)
  // Derive viewing state before any effects use it
  const isViewingPeer = selectedPeer !== null && selectedPeer !== idRef.current
  const events = isViewingPeer ? (peerEvents[selectedPeer!] || []) : []
  const effectiveIndex = isViewingPeer ? (playbackIndex < 0 ? events.length : Math.min(events.length, playbackIndex)) : -1
  const displayedCode = isViewingPeer ? rebuildFromEvents(events, effectiveIndex) : code
  useEffect(() => {
    if (!isViewingPeer) return
    if (!playing) return
    const events = peerEvents[selectedPeer!] || []
    if (events.length === 0) return
    const tick = () => {
      setPlaybackIndex((idx) => {
        const cur = idx < 0 ? events.length : idx
        const next = Math.min(events.length, cur + 1)
        if (next >= events.length) {
          // reached live; stop playing and snap to live
          setPlaying(false)
          return -1
        }
        return next
      })
    }
    const handle = setInterval(tick, 80)
    return () => clearInterval(handle)
  }, [playing, isViewingPeer, selectedPeer, peerEvents])

  // If at live tail (-1), follow new events automatically
  useEffect(() => {
    if (!isViewingPeer) return
    if (playbackIndex >= 0) return
    // snap to new tail when events append
    // dependency on peerEvents ensures recompute
  }, [peerEvents, isViewingPeer, playbackIndex])

  useEffect(() => {
    const ws = new WebSocket(`ws://localhost:8080/rooms/${roomId}/join`)
    wsRef.current = ws
    setWsState('connecting')
    ws.onopen = () => {
      setWsState('open')
      const env: Envelope = { type: 'presence', id: idRef.current, name, ts: Date.now(), action: 'join' }
      ws.send(JSON.stringify(env))
    }
    ws.onclose = () => setWsState('closed')
    ws.onerror = () => setWsState('closed')
    ws.onmessage = (e) => {
      const text = String(e.data)
      let env: Envelope | null = null
      try { env = JSON.parse(text) as Envelope } catch { /* ignore */ }
      if (env && env.type === 'presence') {
        setPeers((prev) => ({ ...prev, [env!.id]: { name: env!.name, lastSeen: Date.now() } }))
      } else if (env && (env.type === 'code' || env.type === 'snapshot')) {
        setPeers((prev) => ({ ...prev, [env!.id]: { name: env!.name, lastSeen: Date.now() } }))
        const textVal = env.type === 'code' ? (env.payload || '') : (env.text || '')
        setPeerCode((prev) => ({ ...prev, [env!.id]: textVal }))
        setPeerEvents((prev) => {
          const arr = (prev[env!.id] || []).slice()
          arr.push({ type: 'snapshot', ts: env!.ts, text: textVal })
          return { ...prev, [env!.id]: arr }
        })
      } else if (env && env.type === 'op' && env.op) {
        setPeers((prev) => ({ ...prev, [env!.id]: { name: env!.name, lastSeen: Date.now() } }))
        setPeerEvents((prev) => {
          const arr = (prev[env!.id] || []).slice()
          arr.push({ type: 'op', ts: env!.ts, op: env!.op })
          return { ...prev, [env!.id]: arr }
        })
        setPeerCode((prev) => ({
          ...prev,
          [env!.id]: applyOp(prev[env!.id] || '', env!.op as Op),
        }))
      }
    }
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        const env: Envelope = { type: 'presence', id: idRef.current, name, ts: Date.now(), action: 'ping' }
        ws.send(JSON.stringify(env))
      }
    }, 10000)
    const prune = setInterval(() => {
      const now = Date.now()
      setPeers((prev) => {
        const next: typeof prev = {}
        for (const [k, v] of Object.entries(prev)) {
          if (now - v.lastSeen < 30000) next[k] = v
        }
        return next
      })
    }, 5000)
    const onUnload = () => {
      try {
        const env: Envelope = { type: 'presence', id: idRef.current, name, ts: Date.now(), action: 'leave' }
        ws.send(JSON.stringify(env))
      } catch {}
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      clearInterval(ping)
      clearInterval(prune)
      window.removeEventListener('beforeunload', onUnload)
      ws.close()
    }
  }, [roomId])

  // Lazy auto-broadcast edits every 300ms if changed; send as op diffs with periodic snapshots
  useEffect(() => {
    const t = setTimeout(() => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        if (code !== lastSentRef.current) {
          const now = Date.now()
          const op = computeOp(lastSentRef.current, code)
          if (op) {
            const env: Envelope = { type: 'op', id: idRef.current, name, ts: now, op }
            wsRef.current.send(JSON.stringify(env))
          }
          // send snapshot every 5s to help new viewers seek efficiently
          if (now - lastKeyframeRef.current > 5000) {
            const snap: Envelope = { type: 'snapshot', id: idRef.current, name, ts: now, text: code }
            wsRef.current.send(JSON.stringify(snap))
            lastKeyframeRef.current = now
          }
          lastSentRef.current = code
        }
      }
    }, 300)
    return () => clearTimeout(t)
  }, [code, name])

  const send = (payload: string) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const env: Envelope = { type: 'code', id: idRef.current, name, ts: Date.now(), payload }
      wsRef.current.send(JSON.stringify(env))
    }
  }

  // Panels sizes
  const [leftW, setLeftW] = useState(40) // %
  const [topH, setTopH] = useState(60) // % of right column

  // derived state moved earlier so effects can use it safely

  return (
    <div className="playground-root">
      <div className="topbar">
        <button className="btn ghost" onClick={onBack}>← Rooms</button>
        <div className="room-pill">Room: {roomId}</div>
        <div className="room-pill you">You: {name}</div>
        <div className={`status ${wsState}`}>{wsState}</div>
      </div>
      <PeersBar peers={peers} selected={selectedPeer} onSelect={(id)=>{ setSelectedPeer(id); setPlaybackIndex(-1); setPlaying(false); }} />

      <div className="panes" style={{ gridTemplateColumns: `${leftW}% 12px ${100 - leftW}%` }}>
        {/* Left: Problem */}
        <div className="pane problem">
          <FancyAccordion title="Two Sum (Sample)">
            <p>
              Given an array of integers nums and an integer target, return indices of the
              two numbers such that they add up to target. You may assume that each input
              would have exactly one solution, and you may not use the same element twice.
            </p>
            <ul>
              <li>Example: nums = [2,7,11,15], target = 9 → [0,1]</li>
              <li>Try to achieve O(n) time.</li>
            </ul>
          </FancyAccordion>
          <FancyAccordion title="Constraints">
            <ul>
              <li>2 ≤ nums.length ≤ 10^4</li>
              <li>-10^9 ≤ nums[i] ≤ 10^9</li>
            </ul>
          </FancyAccordion>
        </div>

        {/* Vertical handle */}
        <DragHandle onDrag={(dx) => setLeftW((w) => Math.min(70, Math.max(20, w + (dx / window.innerWidth) * 100)))} />

        {/* Right: Code (top) + Tests (bottom) */}
        <div className="pane right">
          <div className="right-grid" style={{ gridTemplateRows: `${topH}% 12px ${100 - topH}%` }}>
            <div className="pane code">
              <div className="pane-header">
                Function & Code {isViewingPeer && peers[selectedPeer!] ? `— Viewing ${peers[selectedPeer!].name} (read-only)` : ''}
              </div>
              {isViewingPeer && (
                <div className="playback">
                  <button className="btn ghost" onClick={()=>setPlaying(p=>!p)}>{playing? 'Pause':'Play'}</button>
                  <input type="range" min={0} max={events.length} step={1} value={effectiveIndex}
                    onChange={(e)=>{ setPlaybackIndex(parseInt(e.target.value,10)); setPlaying(false); }} />
                  <button className="btn ghost" onClick={()=>{ setPlaybackIndex(-1); setPlaying(false); }}>Live</button>
                  <div className="muted small">{effectiveIndex}/{events.length} events</div>
                </div>
              )}
              <div className="editor-container">
                <Editor
                  height="100%"
                  defaultLanguage="javascript"
                  theme="vs-dark"
                  value={displayedCode}
                  onChange={(val) => { if (!isViewingPeer) setCode(val ?? '') }}
                  options={{
                    readOnly: isViewingPeer,
                    fontSize: 14,
                    minimap: { enabled: true },
                    smoothScrolling: true,
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                  }}
                />
              </div>
              <div className="actions">
                {isViewingPeer ? (
                  <span className="muted">Live view; you can't edit others' code</span>
                ) : (
                  <span className="muted">Auto-broadcast every 300ms on changes</span>
                )}
              </div>
            </div>

            <DragHandle horizontal onDrag={(dy) => setTopH((h) => Math.min(80, Math.max(30, h + (dy / window.innerHeight) * 100)))} />

            <div className="pane tests">
              <div className="pane-header tests-header">
                <div className="tabs">
                  <button className={`tab ${activeTab==='testcases'?'active':''}`} onClick={()=>setActiveTab('testcases')}>Testcases</button>
                  <button className={`tab ${activeTab==='result'?'active':''}`} onClick={()=>setActiveTab('result')}>Result</button>
                  <button className={`tab ${activeTab==='console'?'active':''}`} onClick={()=>setActiveTab('console')}>Console</button>
                </div>
                <div className="tests-actions">
                  <button className="btn secondary" onClick={()=>addTestCase(setTestCases)}>Add Testcase</button>
                  <button className="btn primary" onClick={()=>runAllTests(displayedCode, testCases, setTestCases)}>Run</button>
                </div>
              </div>
              <div className="tests-body">
                {activeTab === 'testcases' && (
                  <div className="cases">
                    {testCases.map((tc, idx) => (
                      <div key={tc.id} className="case-card">
                        <div className="case-head">
                          <div className="case-title">Case {idx+1}</div>
                          <div className="case-badges">
                            {tc.status && <span className={`badge ${tc.status}`}>{tc.status.toUpperCase()}</span>}
                          </div>
                        </div>
                        <div className="case-grid">
                          <div className="case-field">
                            <div className="label">Input</div>
                            <textarea className="case-editor" value={tc.input} onChange={(e)=>updateCase(setTestCases, tc.id, {input:e.target.value})} />
                          </div>
                          <div className="case-field">
                            <div className="label">Expected</div>
                            <textarea className="case-editor" value={tc.expected} onChange={(e)=>updateCase(setTestCases, tc.id, {expected:e.target.value})} />
                          </div>
                        </div>
                        <div className="case-actions">
                          <button className="btn ghost" onClick={()=>removeCase(setTestCases, tc.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === 'result' && (
                  <div className="results">
                    <div className="results-head">
                      <div>Case</div>
                      <div>Status</div>
                      <div>Output</div>
                      <div>Time</div>
                    </div>
                    {testCases.map((tc, i)=>(
                      <div key={tc.id} className="results-row">
                        <div>#{i+1}</div>
                        <div><span className={`badge ${tc.status||'pending'}`}>{(tc.status||'pending').toUpperCase()}</span></div>
                        <div className="mono">{tc.error ? tc.error : (tc.output ?? '')}</div>
                        <div className="mono">{tc.durationMs ? `${tc.durationMs} ms` : '-'}</div>
                      </div>
                    ))}
                  </div>
                )}
                {activeTab === 'console' && (
                  <div className="console">Open the browser console for logs during Run.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* Peer floating view removed in favor of inline read-only code view */}
    </div>
  )
}

function PeersBar({ peers, selected, onSelect }: { peers: Record<string, { name: string; lastSeen: number }>; selected: string | null; onSelect: (id: string | null) => void }) {
  const ids = Object.keys(peers)
  return (
    <div className="peers-bar">
      <div className="peers-title">People</div>
      <div className="peers-list">
        {ids.length === 0 && <div className="muted">No one yet</div>}
        <AnimatePresence>
          {ids.map((id) => (
            <motion.button
              key={id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className={`peer-chip ${selected === id ? 'selected' : ''}`}
              onClick={() => onSelect(selected === id ? null : id)}
            >
              <div className="avatar">{peers[id].name.slice(0,1).toUpperCase()}</div>
              <div className="name">{peers[id].name}</div>
            </motion.button>
          ))}
        </AnimatePresence>
      </div>
    </div>
  )
}

function DragHandle({ onDrag, horizontal }: { onDrag: (delta: number) => void; horizontal?: boolean }) {
  const dragging = useRef(false)
  const last = useRef(0)
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      const value = horizontal ? e.clientY : e.clientX
      onDrag(value - last.current)
      last.current = value
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [onDrag, horizontal])
  return (
    <div
      className={`drag-handle ${horizontal ? 'horizontal' : 'vertical'}`}
      onMouseDown={(e) => {
        dragging.current = true
        last.current = horizontal ? e.clientY : e.clientX
      }}
    />
  )
}

function FancyAccordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  const icon = useMemo(() => (open ? '−' : '+'), [open])
  return (
    <div className="accordion">
      <button className="accordion-trigger" onClick={() => setOpen((o) => !o)}>
        <span>{title}</span>
        <span className="icon">{icon}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="accordion-content"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="accordion-inner">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App

// ---- helpers for tests pane ----
function addTestCase(setter: React.Dispatch<React.SetStateAction<any>>) {
  setter((prev: any[]) => {
    const nextId = prev.length ? Math.max(...prev.map((p:any)=>p.id))+1 : 1
    return [...prev, { id: nextId, input: '"sample"', expected: '"sample"' }]
  })
}
function removeCase(setter: React.Dispatch<React.SetStateAction<any>>, id: number) {
  setter((prev: any[]) => prev.filter(p => p.id !== id))
}
function updateCase(setter: React.Dispatch<React.SetStateAction<any>>, id: number, patch: any) {
  setter((prev: any[]) => prev.map(p => p.id===id ? { ...p, ...patch } : p))
}
function runAllTests(code: string, tests: any[], setter: React.Dispatch<React.SetStateAction<any>>) {
  // naive eval runner - run user's solve(input) and compare JSON.stringify outputs
  let solveFn: any = null
  try {
    // capture console
    const logs: any[] = []
    const originalConsoleLog = console.log
    ;(console as any).log = (...args:any[]) => { logs.push(args.join(' ')); originalConsoleLog.apply(console, args) }
    try {
      // eslint-disable-next-line no-new-func
      const fn = new Function(`${code}; return typeof solve==='function'? solve : null;`)
      solveFn = fn()
    } finally {
      ;(console as any).log = originalConsoleLog
    }
  } catch (e) {
    // ignore, handled per-case
  }
  setter(tests.map(tc => {
    const start = performance.now()
    try {
      if (!solveFn) throw new Error('No solve(input) function found')
      const input = safeParse(tc.input)
      const out = solveFn(input)
      const outputStr = JSON.stringify(out)
      const ok = outputStr === tc.expected
      return { ...tc, status: ok ? 'pass' : 'fail', output: outputStr, error: undefined, durationMs: Math.max(1, Math.round(performance.now()-start)) }
    } catch (err:any) {
      return { ...tc, status: 'error', error: String(err?.message||err), output: undefined, durationMs: Math.max(1, Math.round(performance.now()-start)) }
    }
  }))
}
function safeParse(text: string){
  try { return JSON.parse(text) } catch { return text }
}

// ---- diff + apply helpers for op streaming ----
function computeOp(prev: string, next: string): Op | null {
  if (prev === next) return null
  let start = 0
  const prevLen = prev.length, nextLen = next.length
  while (start < prevLen && start < nextLen && prev[start] === next[start]) start++
  let endPrev = prevLen - 1, endNext = nextLen - 1
  while (endPrev >= start && endNext >= start && prev[endPrev] === next[endNext]) { endPrev--; endNext--; }
  const del = endPrev - start + 1
  const ins = next.slice(start, endNext + 1)
  return { pos: start, del, ins }
}
function applyOp(text: string, op: Op): string {
  const before = text.slice(0, op.pos)
  const after = text.slice(op.pos + op.del)
  return before + op.ins + after
}
function rebuildFromEvents(events: Array<{type:'op'|'snapshot'; ts:number; op?:Op; text?:string}>, count: number): string {
  let text = ''
  let i = 0
  // find the latest snapshot <= count and start from there
  for (let idx = count - 1; idx >= 0; idx--) {
    const ev = events[idx]
    if (ev && ev.type === 'snapshot' && typeof ev.text === 'string') {
      text = ev.text
      i = idx + 1
      break
    }
  }
  for (; i < count; i++) {
    const ev = events[i]
    if (!ev) continue
    if (ev.type === 'op' && ev.op) text = applyOp(text, ev.op)
    else if (ev.type === 'snapshot' && typeof ev.text === 'string') text = ev.text
  }
  return text
}
