import { useEffect, useState } from 'react'

export function App(): React.JSX.Element {
  const [version, setVersion] = useState<string>('')

  useEffect(() => {
    window.api.invoke('app:version').then(setVersion)
  }, [])

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8
      }}
    >
      <h1>ReplaySwing</h1>
      <p style={{ color: 'var(--muted)' }}>v{version} — capture core coming in M2</p>
    </div>
  )
}
