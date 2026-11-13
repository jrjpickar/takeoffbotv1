import { planSetCsv } from './plan-export';
import { displaySheetName, normalizeSheetSearch } from './sheet-labels';
import { EstimateReview } from './EstimateReview';
import { ThemeToggle } from './ThemeToggle';
import { PasscodeGate } from './PasscodeGate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Viewer } from './Viewer';
import { type Calibration, type Item, type Mode, type Point, type Price, type Project,
  type Rule, type Scope, type State, type Tool, currency, deskNames, distance, factor, json, measure,
  quantity, request, scopeColor, scopeKeys, scopes, toolsFor } from './domain';
import './styles.css';

const names: Record<Mode,string> = {
  select:'Select', pan:'Pan', calibrate:'Calibrate', line:'Line', polyline:'Polyline',
  polygon:'Polygon', rect:'Rectangle', count:'Count',
};
const unitExample: Record<Tool,string> = {
  line:'Click both endpoints.', polyline:'Click each vertex, then press Enter.',
  polygon:'Click each corner, then press Enter.', rect:'Click two opposite corners.', count:'Click one point per item.',
};
const changeScale = (s: State, sheet: number, scale: Calibration): State => ({
  ...s, scales: {...s.scales,[sheet]:scale},
  items:s.items.map(i=>i.sheet===sheet && i.status==='approved' && i.tool!=='count' ? {...i,status:'review'} : i),
});
type Extraction = {scale?:Calibration;scopeHints?:Scope[];paths: {color: string | null; dashed: boolean;
  items: [string,Point[]][]}[]};
function sheetMatches(name:string, filter:Scope|'demo'|'all') {
  if(filter==='all')return true;
  const demo=/\b(?:demo(?:lition)?|removal|strip[- ]?out|tear[- ]?out)\b/i.test(name);
  if(filter==='demo')return demo;
  if(filter==='ceiling')return /\b(?:ceiling|rcp)\b/i.test(name);
  if(!demo)return false;
  const cues:Partial<Record<Scope,RegExp>>={
    wall:/\b(?:walls?|partitions?|floor plan|demolition plan)\b/i,
    floor:/\b(?:flooring|finishes|carpet)\b/i,
    slab:/\b(?:concrete|slab)\b/i,
    door:/\b(?:doors?|openings)\b/i,
    fixture:/\b(?:plumbing|fixtures?)\b/i,
    sawcut:/\bsaw[ -]?cut/i,millwork:/\b(?:millwork|casework)\b/i,
  };
  return cues[filter]?.test(name)??false;
}
const emptyState: State = {revision:0,items:[],scales:{},notes:{},rules:{},markup:null};

async function stream(url: string, body: unknown, handle: (kind: string, data: unknown) => void) {
  const response = await request(url,json(body));
  if (!response.body) throw new Error('Live response is unavailable.');
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '', complete = false;
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      pending += value;
      let end: number;
      while ((end=pending.indexOf('\n\n'))>=0) {
        const event=pending.slice(0,end);
        pending=pending.slice(end+2);
        const lines=event.split('\n');
        const kind=lines[0].slice(7);
        const data=JSON.parse(lines[1].slice(6));
        if (kind==='done') complete=true;
        if (kind==='failed') throw new Error(data.message);
        handle(kind,data);
      }
    }
    if (!complete) throw new Error('The takeoff stream ended early. Review any results received.');
  } finally {
    await reader.cancel();
  }
}

function App() {
  const [projects,setProjects]=useState<{id:string;name:string}[]>([]);
  const [project,setProject]=useState<Project>();
  const [state,setState]=useState<State>(emptyState);
  const [saved,setSaved]=useState<State>(emptyState);
  const [sheet,setSheet]=useState(0);
  const [sheetSearch,setSheetSearch]=useState('');
  const [sheetFilter,setSheetFilter]=useState<Scope|'demo'|'all'>('all');
  const [sheetHints,setSheetHints]=useState<Record<number,Scope[]>>({});
  const [dragging,setDragging]=useState(false);
  const dragDepth=useRef(0);
  const [scope,setScope]=useState<Scope>('wall');
  const [mode,setMode]=useState<Mode>('select');
  const [zoom,setZoom]=useState(1);
  const [snap,setSnap]=useState(true);
  const [hidden,setHidden]=useState<Scope[]>([]);
  const [pending,setPending]=useState<Point[]>([]);
  const [feet,setFeet]=useState('');
  const [colorPrompt,setColorPrompt]=useState(false);
  const [runColors,setRunColors]=useState<State['colors']>({});
  const [reviewOnly,setReviewOnly]=useState(false);
  const [selected,setSelected]=useState<string>();
  const [undo,setUndo]=useState<State[]>([]);
  const [redo,setRedo]=useState<State[]>([]);
  const [busy,setBusy]=useState('');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  const rules=state.rules?.[sheet] ?? [];
  const setRules=(next:Rule[])=>commit({...state,rules:{...state.rules,[sheet]:next}});
  const [color,setColor]=useState('#c53344');
  const [dash,setDash]=useState(false);
  const [extraction,setExtraction]=useState<Extraction>();
  const [price,setPrice]=useState<Price|null>(null);
  const [pricing,setPricing]=useState('');
  const [savedRevision,setSavedRevision]=useState('');
  const upload=useRef<HTMLInputElement>(null);
  const dirty=state!==saved;
  const root=project ? `/api/projects/${project.id}` : '';
  const cal=state.scales[sheet];
  const localItems=state.items.filter(i=>i.sheet===sheet);
  const visible=localItems.filter(i=>!hidden.includes(i.scope));
  const item=localItems.find(i=>i.id===selected);
  const vectors=useMemo(()=>extraction?.paths.flatMap(p=>p.items.flatMap(([kind,pts]) =>
    kind==='c' ? [pts[0],pts.at(-1)!] : pts)).slice(0,30000) ?? [],[extraction]);
  const styles=Array.from(new Map(extraction?.paths.filter(p=>p.color)
    .map(p=>[`${p.color}/${p.dashed}`,p] as const)).values());

  const report=(e:unknown)=>setError(e instanceof Error ? e.message : String(e));
  useEffect(()=>{
    request('/api/projects').then(r=>r.json()).then(setProjects).catch(report);
  },[]);
  useEffect(()=>{
    if (!dirty) return;
    const guard=(e:BeforeUnloadEvent)=>e.preventDefault();
    window.addEventListener('beforeunload',guard);
    return ()=>window.removeEventListener('beforeunload',guard);
  },[dirty]);
  useEffect(()=>{
    setExtraction(undefined);
    if (!root) return;
    const ctl=new AbortController();
    request(`${root}/sheets/${sheet}/vectors`,{signal:ctl.signal}).then(r=>r.json())
      .then((result:Extraction)=>{
        if(ctl.signal.aborted)return;
        setExtraction(result);
        if(result.scopeHints?.length)setSheetHints(prev=>({...prev,[sheet]:result.scopeHints!}));
        if(result.scale)setState(prev=>prev.scales[sheet]?prev:changeScale(prev,sheet,result.scale!));
      }).catch(e=>{if(!ctl.signal.aborted) report(e);});
    return ()=>ctl.abort();
  },[root,sheet]);
  const pricingInput=JSON.stringify({
    items:state.items.filter(i=>i.status==='approved').map(({color,...item})=>item),
    scales:state.scales,markup:state.markup,answers:state.answers,revision:0,notes:{},rules:{},
  });
  useEffect(()=>{
    if(!root || !JSON.parse(pricingInput).items.length)setPrice(null);
    if (!root || !JSON.parse(pricingInput).items.length) { setPricing(''); return; }
    const ctl=new AbortController();
    setPricing('Calculating approved scope…');
    const timer=window.setTimeout(()=>{
      request(root+'/price',{...json(null),body:pricingInput,signal:ctl.signal}).then(r=>r.json()).then(result=>{
        if(!ctl.signal.aborted){setPrice(result);setPricing('');}
      }).catch(e=>{if(!ctl.signal.aborted) setPricing(e.message);});
    },220);
    return ()=>{clearTimeout(timer);ctl.abort();};
  },[root,pricingInput]);

  function commit(update: State) {
    setUndo(prev=>[...prev.slice(-49),state]);
    setRedo([]);
    setState(update);
  }
  function undoAction() {
    if (!undo.length || busy) return;
    setRedo(prev=>[state,...prev]); setState(undo.at(-1)!); setUndo(undo.slice(0,-1));
    setPending([]); setSelected(undefined);
  }
  function redoAction() {
    if (!redo.length || busy) return;
    setUndo(prev=>[...prev,state]); setState(redo[0]); setRedo(redo.slice(1));
    setPending([]); setSelected(undefined);
  }
  function edit(next: Item) {
    commit({...state,items:state.items.map(i=>i.id===next.id ? next : i)});
  }
  function remove(id: string) {
    commit({...state,items:state.items.filter(i=>i.id!==id)});
    setSelected(undefined);
  }
  function changeMode(m: Mode) {
    setMode(m);setPending([]);setFeet('');setError('');
  }
  function changeScope(s: Scope) {
    if(s===scope&&toolsFor(s).includes(mode as Tool))return;
    setScope(s);setSelected(undefined);
    setHidden(prev=>prev.filter(key=>key!==s));
    changeMode(toolsFor(s).includes(mode as Tool)?mode:toolsFor(s)[0]);
  }
  function changeSheet(index: number) {
    setSheet(index);setPending([]);setSelected(undefined);setFeet('');
  }
  async function open(endpoint: string, init?: RequestInit) {
    if (dirty && !window.confirm('Discard unsaved takeoff changes?')) return;
    setBusy('Opening plans…');setError('');setNotice('');
    try {
      let p=await (await request(endpoint,init)).json() as Project;
      if (!p.state) p=await (await request(`/api/projects/${p.id}`)).json();
      setSheetSearch('');setSheetFilter('all');setSheetHints({});setProject(p);setState(p.state);setSaved(p.state);changeSheet(0);
      setUndo([]);setRedo([]);setZoom(1);setHidden([]);setSavedRevision('');changeMode('select');
      setProjects(await (await request('/api/projects')).json());
    } catch(e) { report(e); }
    finally { setBusy(''); }
  }
  function uploadPlan(file?:File) {
    if(!file||busy)return;
    const zip=import.meta.env.MODE==='netlify'&&/\.zip$/i.test(file.name);
    if(!zip&&!/\.pdf$/i.test(file.name)){setError('Choose a supported PDF or ZIP plan file.');return;}
    const data=new FormData();data.set('file',file);
    void open('/api/projects',{method:'POST',body:data});
  }
  function finish(tool: Tool, pts: Point[]) {
    if ((tool==='polygon' && pts.length<3) || (tool==='polyline' && pts.length<2)) {
      setError('Add more points before finishing.');return;
    }
    const candidate:Item={id:crypto.randomUUID(),sheet,scope,tool,points:pts,status:'review',
      source:'Manual trace',thickness:null,edited:false};
    const dummy:Calibration={feet:1,points:[[0,0],[1,0]],source:'geometry check'};
    if (!measure(candidate,dummy)) {setError('Trace valid, non-zero geometry.');return;}
    commit({...state,items:[...state.items,candidate]});
    setPending([]);setSelected(candidate.id);setError('');
  }
  function addPoint(p: Point) {
    if (busy) return;
    if (mode==='select' || mode==='pan') return;
    if (mode==='count') { finish(mode,[p]);return; }
    if (mode==='calibrate' && pending.length>=2) return;
    const next=[...pending,p];
    if (mode==='calibrate' && next.length===2 && distance(...next as [Point,Point])===0) {
      setError('Choose two distinct calibration points.');return;
    }
    if (mode!=='calibrate' && (mode==='line' || mode==='rect') && next.length===2) {
      finish(mode,next);return;
    }
    setPending(next);setError('');
  }
  function calibrate() {
    if (pending.length!==2 || !(Number(feet)>0) || !Number.isFinite(Number(feet))) {
      setError('Enter a positive distance in decimal feet.');return;
    }
    const scale: Calibration={points:pending as [Point,Point],feet:Number(feet),source:'Manual calibration'};
    if (!Number.isFinite(factor(scale))) {setError('Scale exceeds the supported range.');return;}
    commit(changeScale(state,sheet,scale));changeMode('select');setNotice('Sheet calibrated.');
  }
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if (busy || (e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA|BUTTON/.test(e.target.tagName))) return;
      if (e.key==='Escape') {setPending([]);setSelected(undefined);}
      if (e.key==='Enter' && (mode==='polygon'||mode==='polyline')) finish(mode,pending);
      if (e.key==='Delete' && item) remove(item.id);
      if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z') {e.preventDefault();if(e.shiftKey)redoAction();else undoAction();}
    };
    window.addEventListener('keydown',key);
    return ()=>window.removeEventListener('keydown',key);
  });

  async function save() {
    setBusy('Saving…');setError('');
    try {
      const result:State=await (await request(root,json(state,'PUT'))).json();
      setState(result);setSaved(result);
      setUndo(prev=>prev.map(s=>({...s,revision:result.revision})));
      setRedo(prev=>prev.map(s=>({...s,revision:result.revision})));
      setNotice(`Saved revision ${result.revision}.`);
    } catch(e) {report(e);}
    finally {setBusy('');}
  }
  async function run(applyColors=false, allSheets=false) {
    setColorPrompt(false);
    setBusy('Processing sheet…');setError('');setNotice('');setPending([]);setMode('select');
    setUndo(prev=>[...prev.slice(-49),state]);setRedo([]);
    if(applyColors)setState(prev=>({...prev,colors:{...prev.colors,...runColors}}));
    const ids=new Set(state.items.map(i=>i.id));
    const geometryKey=(i:Item)=>JSON.stringify([i.sheet,i.scope,i.points.map(p=>p.map(v=>Math.round(v*10000))).sort()]);
    const existingGeometry=new Set(state.items.map(geometryKey));
    let added=0, skipped=0, matched=0;
    const failed:number[]=[];
    let batch:Item[]=[];
    let frame:number|undefined;
    const flush=()=>{
      if(frame!==undefined)cancelAnimationFrame(frame);
      frame=undefined;
      if(!batch.length)return;
      const ready=batch;batch=[];
      const visibleScopes=new Set(ready.map(i=>i.scope));
      setState(prev=>({...prev,items:[...prev.items,...ready]}));
      setHidden(prev=>prev.filter(scope=>!visibleScopes.has(scope)));
    };
    try {
      const targets=allSheets ? project!.sheets.map((_,index)=>index) : [sheet];
      for(const index of targets){
        if(allSheets)setBusy(`Scanning sheet ${index+1} of ${targets.length}…`);
        let found=false;
        try {
          await stream(`${root}/sheets/${index}/run`,{calibration:state.scales[index],rules:state.rules?.[index]??[]},(kind,data)=>{
            if(kind==='scopeHints'&&(data as Scope[]).length)setSheetHints(prev=>({...prev,[index]:data as Scope[]}));
            if (kind==='scale') setState(prev=>changeScale(prev,index,data as Calibration));
            if(kind==='measurement'||kind==='measurements'){
              const candidates=kind==='measurements'?data as Item[]:[data as Item];
              found ||= candidates.length>0;
              for(const candidate of candidates){
                const key=geometryKey(candidate);
                if(ids.has(candidate.id)||existingGeometry.has(key)){skipped++;continue;}
                ids.add(candidate.id);existingGeometry.add(key);added++;
                batch.push(candidate);
              }
              if(batch.length&&frame===undefined)frame=requestAnimationFrame(flush);
            }
            if (kind==='warnings') setState(prev=>({...prev,notes:{...prev.notes,[index]:data as string[]}}));
          });
        } catch(e) {
          if(!allSheets)throw e;
          failed.push(index+1);
          setState(prev=>({...prev,notes:{...prev.notes,[index]:[e instanceof Error?e.message:'Extraction failed.']}}));
        }
        if(found)matched++;
      }
      flush();
      setNotice(allSheets
        ? `Scanned ${targets.length} sheets: ${matched} matched, ${added} added for review, ${skipped} already present${failed.length?`; failed sheets ${failed.join(', ')}`:''}.`
        : `${added} added for review${skipped ? `, ${skipped} already present` : ''}.`);
    } catch(e) {report(e);}
    finally {flush();setBusy('');}
  }
  function download(blob:Blob,name:string) {
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;link.download=name;link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportCsv() {
    try {
      download(await (await request(root+'/csv',json(state))).blob(),'A2Z-STACK-takeoff.csv');
    } catch(e) {report(e);}
  }
  function exportPlanSet(){
    if(!project)return;
    const name=project.name.replace(/\.pdf$/i,'').replace(/[^a-z0-9._-]+/gi,'-');
    download(new Blob([planSetCsv(project,state)],{type:'text/csv;charset=utf-8'}),
      `${name||'A2Z'}-all-takeoffs.csv`);
  }
  async function restore() {
    const revision=Number(savedRevision);
    if (revision>=state.revision) {setError('Enter an earlier saved revision.');return;}
    setBusy('Loading revision…');setError('');
    try {
      const previous:Project=await (await request(root+'?revision='+revision)).json();
      commit({...previous.state,revision:state.revision});
      setSelected(undefined);setNotice(`Loaded revision ${revision} for review. Save to create a new revision.`);
    } catch(e) {report(e);}
    finally {setBusy('');}
  }
  const linkedScope=item && price?.scopeLines.flatMap(s=>s.lines)
    .find(l=>l.key===`item:${deskNames[item.scope].toLowerCase()}|${scopes[item.scope][1]}`);
  const approved=state.items.filter(i=>i.status==='approved').length;
  const review=state.items.filter(i=>i.status==='review').length;
  const instruction=mode==='calibrate' ? 'Click two points on a known dimension.' :
    mode==='select' ? 'Select a measurement to move it or drag a vertex to resize.' :
    mode==='pan' ? 'Drag to pan the sheet.' : unitExample[mode];

  const sheetScopes=useMemo(()=>{
    const result=new Map<number,Set<Scope>>();
    for(const item of state.items){
      if(item.status==='rejected')continue;
      const set=result.get(item.sheet)??new Set<Scope>();
      set.add(item.scope);result.set(item.sheet,set);
    }
    return result;
  },[state.items]);
  const searchTokens=sheetSearch.trim().split(/\s+/).map(normalizeSheetSearch).filter(Boolean);
  const filteredSheets=project?.sheets.map((view,index)=>({view,index})).filter(({view,index})=>{
    const relatedScopes=new Set([...(sheetScopes.get(index)??[]),...(sheetHints[index]??[])]);
    const scopeNames=[...relatedScopes].map(key=>scopes[key][0]);
    const searchable=normalizeSheetSearch([displaySheetName(view.name),view.name,view.planName,...(view.keywords??[]),...scopeNames].join(' '));
    if(!searchTokens.every(token=>searchable.includes(token)))return false;
    return sheetMatches(displaySheetName(view.name),sheetFilter)||
      (sheetFilter==='demo'?relatedScopes.size>0:sheetFilter!=='all'&&relatedScopes.has(sheetFilter));
  })??[];
  return <div className="app" onDragEnter={e=>{
    if(!e.dataTransfer.types.includes('Files'))return;
    e.preventDefault();dragDepth.current++;if(!busy)setDragging(true);
  }} onDragOver={e=>{
    if(!e.dataTransfer.types.includes('Files'))return;
    e.preventDefault();e.dataTransfer.dropEffect=busy?'none':'copy';
  }} onDragLeave={()=>{
    dragDepth.current=Math.max(0,dragDepth.current-1);
    if(!dragDepth.current)setDragging(false);
  }} onDrop={e=>{
    if(!e.dataTransfer.files.length)return;
    e.preventDefault();dragDepth.current=0;setDragging(false);
    if(busy)return;
    if(e.dataTransfer.files.length>1){setError('Drop one PDF or ZIP at a time.');return;}
    uploadPlan(e.dataTransfer.files[0]);
  }}>
    {dragging&&<div className="file-drop-overlay">Drop a {import.meta.env.MODE==='netlify'?'PDF or ZIP':'PDF'} to open plans</div>}
    <header>
      <div className="brand"><strong>A2Z</strong><span>Takeoff Desk</span></div>
      <span className="sandbox-label">LOCAL SANDBOX</span>
      <ThemeToggle/>
      <div className="project-picker">
        {projects.length>0 && <select aria-label="Open saved project" disabled={!!busy}
          value={project?.id ?? ''} onChange={e=>void open('/api/projects/'+e.target.value)}>
          <option value="" disabled>Open saved project</option>
          {projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
        </select>}
        <input ref={upload} data-testid="upload" type="file" accept={import.meta.env.MODE==='netlify' ? ".pdf,.zip,application/pdf,application/zip" : ".pdf,application/pdf"} hidden onChange={e=>{
          const file=e.target.files?.[0];e.target.value='';
          uploadPlan(file);
        }}/>
        <button onClick={()=>upload.current?.click()} disabled={!!busy}>{import.meta.env.MODE==='netlify'?'Upload PDF / ZIP':'Upload PDF'}</button>
        <button onClick={()=>void open('/api/sample',{method:'POST'})} disabled={!!busy}>Open sample</button>
      </div>
    </header>
    {project ? <>
      <fieldset className="toolbar" disabled={!!busy}>
        {(['select','pan','calibrate',...toolsFor(scope)] as Mode[]).map(m=><button key={m}
          className={mode===m?'active':''} aria-pressed={mode===m} onClick={()=>changeMode(m)}>{names[m]}</button>)}
        <span className="divider"/>
        <button onClick={undoAction} disabled={!undo.length}>Undo</button>
        <button onClick={redoAction} disabled={!redo.length}>Redo</button>
        <label className="inline"><input type="checkbox" checked={snap} onChange={e=>setSnap(e.target.checked)}/> Snap</label>
        <div className="toolbar-end">
          <button onClick={()=>void run()}>Run sheet takeoff</button>
          <button onClick={()=>void run(false,true)}>Run all sheets</button>
          <button aria-expanded={colorPrompt} onClick={()=>{setRunColors({...state.colors});setColorPrompt(!colorPrompt);}}>Run colors…</button>
          <button disabled={!localItems.length} onClick={()=>{
            if(!window.confirm(`Clear ${localItems.length} takeoffs from this sheet? You can undo this.`))return;
            commit({...state,items:state.items.filter(item=>item.sheet!==sheet),notes:{...state.notes,[sheet]:[]}});
            setSelected(undefined);setPending([]);setNotice('Sheet takeoffs cleared. Calibration kept.');
          }}>Clear sheet takeoffs</button>
          <button disabled={!state.items.length} onClick={exportPlanSet}>Export all takeoffs</button>
          <button className="primary" onClick={()=>void save()}>Save</button>
        </div>
      </fieldset>
      {colorPrompt&&<div className="run-colors" role="group" aria-label="Optional takeoff colors">
        {scopeKeys.map(key=><label className="inline" key={key}>{scopes[key][0]} <input type="color"
          aria-label={`Run color for ${scopes[key][0]}`} value={scopeColor(key,runColors)}
          onChange={e=>setRunColors(prev=>({...prev,[key]:e.target.value}))}/></label>)}
        <button onClick={()=>void run(true)}>Apply colors and run</button>
        <button onClick={()=>setColorPrompt(false)}>Cancel</button>
      </div>}
      <main className="workspace">
        <fieldset className="panel sidebar" disabled={!!busy}>
          <h2>Sheets</h2>
          <label className="sheet-filter">Search sheets
            <input type="search" value={sheetSearch} placeholder="Sheet number, title, keyword"
              onChange={e=>setSheetSearch(e.target.value)} onKeyDown={e=>{
                if(e.key==='Enter'&&filteredSheets.length)changeSheet(filteredSheets[0].index);
                if(e.key==='Escape')setSheetSearch('');
              }}/>
          </label>
          <label className="sheet-filter">Filter sheets
            <select value={sheetFilter} onChange={e=>setSheetFilter(e.target.value as typeof sheetFilter)}>
              <option value="all">All sheets</option><option value="demo">Demolition</option>
              {scopeKeys.map(key=><option key={key} value={key}>{scopes[key][0]}</option>)}
            </select>
          </label>
          <nav className="sheet-list" aria-label="Sheets">
            {filteredSheets.map(({view:s,index:i})=><button key={i} className={`${i===sheet?'active':''} ${sheetMatches(displaySheetName(s.name),'demo')?'demo-sheet':''}`} onClick={()=>changeSheet(i)}>
              <span>{displaySheetName(s.name)}</span><small>{state.scales[i]?'Calibrated':'Uncalibrated'}{state.notes[i]?' · Scanned':''}{sheetMatches(displaySheetName(s.name),'demo')?' · Demo':''}</small>
            </button>)}
            {!filteredSheets.length&&<p>No matching sheets.</p>}
          </nav>
          <h2>Scope layers</h2>
          {scopeKeys.map(key=><div className={`layer-row ${scope===key?'chosen':''}`} key={key}>
            <input type="checkbox" aria-label={`Show ${scopes[key][0]}`} checked={!hidden.includes(key)}
              onChange={()=>setHidden(hidden.includes(key)?hidden.filter(s=>s!==key):[...hidden,key])}/>
            <button onClick={()=>changeScope(key)} aria-pressed={scope===key}>
              <i style={{background:scopeColor(key,state.colors)}}/>{scopes[key][0]} <small>{scopes[key][1]}</small>
            </button>
            <input className="layer-color" type="color" aria-label={`${scopes[key][0]} takeoff color`}
              value={scopeColor(key,state.colors)} onChange={e=>commit({...state,
                colors:{...state.colors,[key]:e.target.value}})}/>
          </div>)}
          <details className="rules">
            <summary>Vector style rules</summary>
            <p>Map a verified demolition stroke color and dash type for this sheet.</p>
            <div className="swatches">
              {styles.slice(0,24).map(p=><button key={p.color+String(p.dashed)} title={`${p.color} ${p.dashed?'dashed':'solid'}`}
                aria-label={`Use ${p.color} ${p.dashed?'dashed':'solid'}`}
                style={{background:p.color!}} onClick={()=>{setColor(p.color!);setDash(p.dashed);}}/>)}
            </div>
            <div className="inline">
              <input aria-label="Stroke color" type="color" value={color} onChange={e=>setColor(e.target.value)}/>
              <label className="inline"><input type="checkbox" checked={dash} onChange={e=>setDash(e.target.checked)}/>Dashed</label>
            </div>
            <button onClick={()=>setRules([...rules,{scope,color,dashed:dash}])}
              disabled={rules.length>=30 || rules.some(r=>r.scope===scope && r.color===color && r.dashed===dash)}>
              Map to {scopes[scope][0]}
            </button>
            {rules.map((r,i)=><div className="rule-row" key={i}><span>{r.color} {r.dashed?'dash':'solid'} · {scopes[r.scope][0]}</span>
              <button aria-label={`Remove rule ${i+1}`} onClick={()=>setRules(rules.filter((_,j)=>i!==j))}>×</button></div>)}
          </details>
        </fieldset>
        <section className="drawing-panel">
          <div className="sheet-bar">
            <div><strong>{displaySheetName(project.sheets[sheet].name)}</strong><small>{instruction} · Scroll to zoom · Space + drag to pan</small></div>
            <div className="inline">
              <button aria-label="Zoom out" onClick={()=>setZoom(v=>Math.max(.35,v/1.25))}>−</button>
              <button onClick={()=>setZoom(1)} title="Fit width">{Math.round(zoom*100)}%</button>
              <button aria-label="Zoom in" onClick={()=>setZoom(v=>Math.min(12,v*1.25))}>+</button>
            </div>
          </div>
          {mode==='calibrate' && pending.length===2 && <form className="calibrate-bar" onSubmit={e=>{e.preventDefault();calibrate();}}>
            <label>Known distance (ft) <input autoFocus type="number" step="any" min="0" value={feet}
              onChange={e=>setFeet(e.target.value)} required /></label>
            <button className="primary">Apply scale</button>
          </form>}
          {(mode==='polygon'||mode==='polyline') && pending.length>0 && <div className="calibrate-bar">
            <button onClick={()=>finish(mode,pending)}>Finish trace</button><button onClick={()=>setPending(pending.slice(0,-1))}>Remove last point</button>
          </div>}
          <Viewer colors={state.colors} key={project.id} url={root+'/pdf'} index={sheet} sheet={project.sheets[sheet]} items={visible}
            calibration={cal} mode={busy ? 'select' : mode} activeScope={scope} selected={busy ? undefined : selected} snap={snap}
            zoom={zoom} setZoom={setZoom} vertices={vectors} pending={pending} setPending={setPending} addPoint={addPoint}
            select={id=>{if(!busy)setSelected(id);}} changePoints={(id,points)=>{
              const target=state.items.find(i=>i.id===id);
              if (target && !busy) edit({...target,points,status:'review',edited:true});
            }}/>
        </section>
        <fieldset className="panel inspector" disabled={!!busy}>
          <h2>Takeoff review</h2>
          <div className="review-counts"><span>{approved} approved</span><span>{review} in review</span></div>
          <div className="scale-status">{cal ? cal.source.startsWith('Printed scale:')?cal.source:`${quantity(cal.feet)} ft calibration · ${cal.source}` : 'Sheet scale required for lengths and areas'}</div>
          <div className="takeoff-review-controls">
            <label className="inline"><input type="checkbox" checked={reviewOnly} onChange={e=>setReviewOnly(e.target.checked)}/> Needs review only</label>
            <button disabled={!localItems.some(i=>i.status==='review'&&measure(i,cal))} onClick={()=>{
              const queue=localItems.filter(i=>i.status==='review'&&measure(i,cal));
              const next=queue[(queue.findIndex(i=>i.id===selected)+1)%queue.length];
              if(next){setSelected(next.id);setHidden(hidden.filter(s=>s!==next.scope));changeMode('select');}
            }}>Next review</button>
          </div>
          <div className="measurements">
            {localItems.length===0 && <p>Trace a scope or run sheet takeoff.</p>}
            {scopeKeys.map(key=>{
              const items=localItems.filter(i=>i.scope===key&&(!reviewOnly||i.status==='review'));
              if(!items.length)return null;
              const values=items.map(i=>({item:i,measurement:measure(i,cal)}));
              const total=values.reduce((sum,{item,measurement})=>
                sum+(item.status==='rejected'?0:measurement?.value??0),0);
              return <details key={key} open className="measurement-group">
                <summary><i style={{background:scopeColor(key,state.colors)}}/> {scopes[key][0]} · {items.length}
                  {total>0&&<b>{quantity(total)} {scopes[key][1]}</b>}</summary>
                <div className="measurement-group-items">{values.map(({item:i,measurement:m})=>
                  <button key={i.id} className={i.id===selected?'active':''} onClick={()=>{
                setSelected(i.id);setHidden(hidden.filter(s=>s!==i.scope));changeMode('select');
              }}><i style={{background:scopeColor(i.scope,state.colors)}}/><span>{scopes[i.scope][0]}
                <small>{i.status} · {i.edited?'edited':i.source.startsWith('Manual')?'manual':'rule match'}</small>
              </span><b>{m?`${quantity(m.value)} ${m.unit}`:'—'}</b></button>
                )}</div>
              </details>;
            })}
          </div>
          {item && <section className="selection">
            <h3>Selected measurement</h3>
            <small>{displaySheetName(project.sheets[sheet].name)} · {item.source}{item.edited?' · Edited':''}</small>
            {linkedScope && item.status==='approved' && <p>Desk scope · {linkedScope.text}</p>}
            <label>{scopes[item.scope][0]} color <input type="color" value={scopeColor(item.scope,state.colors)}
              onChange={e=>commit({...state,colors:{...state.colors,[item.scope]:e.target.value}})}/></label>
            <label>Assigned scope <select value={item.scope} onChange={e=>{
              const target=e.target.value as Scope;
              setScope(target);
              edit({...item,scope:target,status:'review',edited:true,thickness:target==='slab'?item.thickness:null});
              setHidden(hidden.filter(s=>s!==target));
            }}>{scopeKeys.filter(key=>toolsFor(key).includes(item.tool)).map(key=><option key={key} value={key}>{scopes[key][0]}</option>)}</select></label>
            {item.scope==='slab' && <label>Slab thickness (in) <input type="number" step="any" min="0"
              value={item.thickness ?? ''} onChange={e=>edit({...item,thickness:Number(e.target.value)>0?Number(e.target.value):null,
                status:'review',edited:true})}/></label>}
            {item.scope==='slab' && <p>{item.thickness ? `${quantity(measure(item,cal)?.cy ?? 0)} CY` : 'Enter verified thickness to calculate volume.'}</p>}
            {!measure(item,cal) && <p>Check geometry and sheet scale before approval.</p>}
            <div className="inline wrap">
              <button className="primary" disabled={!measure(item,cal)||item.status==='approved'}
                onClick={()=>edit({...item,status:'approved'})}>Approve</button>
              <button disabled={item.status==='rejected'} onClick={()=>edit({...item,status:'rejected'})}>Reject</button>
              <button onClick={()=>remove(item.id)}>Delete</button>
            </div>
          </section>}
          <details open className="totals"><summary>Approved quantities · all sheets</summary>
            {scopeKeys.map(k=>{
              const values=state.items.filter(i=>i.scope===k && i.status==='approved')
                .map(i=>measure(i,state.scales[i.sheet]));
              const total=values.reduce((a,b)=>a+(b?.value??0),0);
              const cy=values.reduce((a,b)=>a+(b?.cy??0),0);
              return total>0 && <div key={k}><span>{scopes[k][0]}</span><b>{quantity(total)} {scopes[k][1]}{cy>0?` · ${quantity(cy)} CY`:''}</b></div>;
            })}
            {!approved && <p>Approve measurements to include them.</p>}
          </details>
          <details className="warnings"><summary>Sheet warnings ({state.notes[sheet]?.length??0})</summary>
            {state.notes[sheet]?.map((note,i)=><p key={i}>{note}</p>)}
            {!state.notes[sheet]?.length && <p>{state.notes[sheet]?'No extraction warnings.':'Run takeoff to check this sheet.'}</p>}
          </details>
          <section className="cost">
            <h2>Draft estimate</h2>
            <label>Markup on cost (%) <input type="number" min="0" step="any" placeholder="Desk default"
              value={state.markup===null?'':Number((state.markup*100).toFixed(8))}
              onChange={e=>commit({...state,markup:e.target.value===''?null:Math.max(0,Number(e.target.value))/100})}/></label>
            {price ? <>
              {pricing&&<p aria-live="polite">{pricing}</p>}
              <EstimateReview price={price} answers={state.answers??{}} update={(key,value)=>{
                const answers={...state.answers};
                if(value)answers[key]=value;else delete answers[key];
                commit({...state,answers});
              }} jump={key=>{
                const target=state.items.find(i=>i.status==='approved'&&key===`item:${deskNames[i.scope].toLowerCase()}|${scopes[i.scope][1]}`);
                if(target){changeSheet(target.sheet);setSelected(target.id);setHidden(hidden.filter(s=>s!==target.scope));changeMode('select');}
              }}/>
              <div className="cost-line"><span>Direct cost</span><b>{currency(price.cost)}</b></div>
              <div className="cost-line bid"><span>Draft bid</span><strong>{currency(price.bid)}</strong></div>
              <details><summary>Labor, hauling and equipment</summary>
                {price.sections.map(s=><section key={s.name}><h3>{s.name} · {currency(s.subtotal)}</h3>
                  {s.lines.map((line,i)=><p key={i}>{line.category} · {line.description} · {quantity(line.qty)} × {currency(line.rate)} = {currency(line.extended)}
                    {line.basis && <small className="basis">{line.basis}</small>}</p>)}
                </section>)}
                {price.warnings.map(w=><p key={w}>{w}</p>)}
              </details>
            </> : <p>{pricing || 'Pricing uses approved quantities and Desk production rates.'}</p>}
            <button disabled={!approved} onClick={()=>void exportCsv()}>Download STACK CSV</button>
          </section>
          {state.revision>0 && <details><summary>Saved revisions</summary>
            <label>Revision <input type="number" min="0" max={state.revision-1} step="1"
              value={savedRevision} onChange={e=>setSavedRevision(e.target.value)}/></label>
            <button disabled={savedRevision===''} onClick={()=>void restore()}>Load earlier revision</button>
          </details>}
        </fieldset>
      </main>
    </> : <main className="empty"><div>
      <h1>Construction takeoff</h1>
      <p>Drop a {import.meta.env.MODE==='netlify'?'PDF or ZIP':'PDF'} here, or choose a local file.</p>
      <button className="primary" disabled={!!busy} onClick={()=>upload.current?.click()}>Choose local PDF</button>
    </div></main>}
    <footer><span>{project ? `Revision ${state.revision}${dirty?' · Unsaved changes':''}` : 'Local project storage'}</span>
      <span role={error?'alert':'status'} className={error?'error':''}>{error || busy || notice}</span></footer>
  </div>;
}

try{if(localStorage.getItem('a2z-theme')==='light')document.documentElement.dataset.theme='light';}catch{}
if(import.meta.env.MODE==='netlify')document.documentElement.dataset.hosted='true';
createRoot(document.getElementById('root')!).render(import.meta.env.MODE==='netlify' ? <PasscodeGate><App/></PasscodeGate> : <App/>);
