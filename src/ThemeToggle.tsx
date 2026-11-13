import { useState } from 'react';

export function ThemeToggle(){
  const [light,setLight]=useState(document.documentElement.dataset.theme==='light');
  return <button type="button" onClick={()=>{
    const theme=light?'dark':'light';
    document.documentElement.dataset.theme=theme;
    try{localStorage.setItem('a2z-theme',theme);}catch{}
    setLight(!light);
  }}>{light?'Dark mode':'Light mode'}</button>;
}
