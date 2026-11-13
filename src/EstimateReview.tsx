import { useState } from 'react';
import type { Price, PriceQuestion } from './domain';

function Question({question:q,answer,setAnswer}:{question:PriceQuestion;answer?:string;setAnswer:(value?:string)=>void}){
  const p=q.picker;
  const crew=answer?.match(/^crew:(\d+)x(\d+)$/), haul=answer?.match(/^loads:(\d+)$/);
  const [workers,setWorkers]=useState(crew?.[1]??String(p?.workers??1));
  const [days,setDays]=useState(crew?.[2]??String(p?.days??1));
  const [loads,setLoads]=useState(haul?.[1]??String(p?.loads??1));
  const selected=answer??q.answer??'';
  const custom=selected&&!q.options.some(o=>o.id===selected);
  return <div className="review-question">
    <label>{q.title}
      <select value={selected} onChange={e=>setAnswer(e.target.value||undefined)}>
        <option value="">Choose an answer</option>
        {q.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
        {custom&&<option value={selected}>{selected}</option>}
      </select>
    </label>
    {q.detail&&<p>{q.detail}</p>}
    <small>{answer?'Your answer':q.autoAnswered?'Desk default':q.open?'Needs review':'Reviewed'}</small>
    {p&&<form className="review-picker" onSubmit={e=>{
      e.preventDefault();setAnswer(p.kind==='crew'?`crew:${workers}x${days}`:`loads:${loads}`);
    }}>
      {p.kind==='crew'?<>
        <label>Workers<input type="number" required min="1" max={p.max.workers} value={workers} onChange={e=>setWorkers(e.target.value)}/></label>
        <label>Days<input type="number" required min="1" max={p.max.days} value={days} onChange={e=>setDays(e.target.value)}/></label>
      </>:<label>Loads<input type="number" required min="1" max={p.max.loads} value={loads} onChange={e=>setLoads(e.target.value)}/></label>}
      <button type="submit">Apply</button>
    </form>}
    {answer&&<button type="button" onClick={()=>setAnswer()}>Reset answer</button>}
  </div>;
}

export function EstimateReview({price,answers,update,jump}:{price:Price;answers:Record<string,string>;
  update:(key:string,value?:string)=>void;jump:(key:string)=>void}){
  const [all,setAll]=useState(false);
  const questions=price.questions??[];
  const open=questions.filter(q=>q.open).length;
  return <>
    {!!questions.length&&<details open><summary>Estimate questions · {open} open</summary>
      <label className="inline"><input type="checkbox" checked={all} onChange={e=>setAll(e.target.checked)}/> Show all questions</label>
      {questions.filter(q=>all||q.open||answers[q.key]).map(q=>
        <Question key={q.key} question={q} answer={answers[q.key]} setAnswer={value=>update(q.key,value)}/>)}
    </details>}
    <details><summary>Draft scope</summary>
      {price.scopeLines.map(group=><section key={group.name}><h3>{group.name}</h3>
        {group.lines.map(line=><div className="scope-review-line" key={line.key}>
          <p>{line.text}</p>
          {line.key.startsWith('item:')&&<button type="button" onClick={()=>jump(line.key)}>Find on plan</button>}
          <button type="button" onClick={()=>update('drop:'+line.key,'1')}>Exclude from estimate</button>
        </div>)}
      </section>)}
      {price.removed?.map(line=><div className="scope-review-line" key={line.key}><p>{line.text}</p>
        <button type="button" onClick={()=>{
          const crewKey=Object.keys(answers).find(key=>key.startsWith('crew:')&&answers[key]==='none'&&
            line.key==='section:'+key.slice(5).toLowerCase());
          update(crewKey??'drop:'+line.key);
        }}>Restore to estimate</button>
      </div>)}
    </details>
  </>;
}
