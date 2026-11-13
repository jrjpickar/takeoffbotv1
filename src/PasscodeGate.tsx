import { ThemeToggle } from './ThemeToggle';
import { useEffect, useState, type ReactNode } from 'react';
import { json, request } from './domain';

const endpoint='/.netlify/functions/session';
export function PasscodeGate({children}:{children:ReactNode}) {
  const [checking,setChecking]=useState(true);
  const [allowed,setAllowed]=useState(false);
  const [passcode,setPasscode]=useState('');
  const [error,setError]=useState('');
  useEffect(()=>{
    request(endpoint).then(r=>r.json()).then(r=>setAllowed(r.authenticated===true))
      .catch(e=>setError(e.message)).finally(()=>setChecking(false));
  },[]);
  if(allowed)return children;
  return <div className="app"><main className="empty"><div>
    <h1>A2Z Takeoff Sandbox</h1>
    <ThemeToggle/>
    <form onSubmit={async e=>{
      e.preventDefault();setChecking(true);setError('');
      try {
        const result=await (await request(endpoint,json({passcode}))).json();
        setAllowed(result.authenticated===true);setPasscode('');
      } catch(e){setError(e instanceof Error?e.message:'Sign-in failed.');}
      finally{setChecking(false);}
    }}>
      <label>Passcode <input type="password" autoComplete="current-password" value={passcode}
        onChange={e=>setPasscode(e.target.value)} required /></label>{' '}
      <button className="primary" disabled={checking || !passcode}>{checking?'Checking…':'Unlock'}</button>
      {error&&<p className="error" role="alert">{error}</p>}
    </form>
  </div></main></div>;
}
