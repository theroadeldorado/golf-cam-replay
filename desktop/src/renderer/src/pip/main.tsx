import React from 'react'
import ReactDOM from 'react-dom/client'

function Pip(): React.JSX.Element {
  return (
    <div
      style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#000',
        color: '#666',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13
      }}
    >
      PiP video sink — arrives with the program bus (M5)
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Pip />
  </React.StrictMode>
)
