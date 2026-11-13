import { measure, scopes, type Project, type State } from './domain';
import { displaySheetName } from './sheet-labels';

export function planSetCsv(project:Project,state:State){
  const rows:(string|number)[][]=[['Sheet','PDF Page','Scope','Status','Quantity','Unit','Volume (CY)','Measurement ID','Source','Scale Source']];
  const items=[...state.items].sort((a,b)=>a.sheet-b.sheet||a.scope.localeCompare(b.scope));
  for(const item of items){
    const sheet=project.sheets[item.sheet];
    const scale=state.scales[item.sheet];
    const result=measure(item,scale);
    rows.push([displaySheetName(sheet?.name??`Sheet ${item.sheet+1}`),item.sheet+1,scopes[item.scope][0],
      item.status==='review'?'In review':item.status==='approved'?'Approved':'Rejected',
      result?Number(result.value.toFixed(6)):'',scopes[item.scope][1],
      result?.cy===undefined?'':Number(result.cy.toFixed(6)),item.id,item.source,scale?.source??'']);
  }
  return '\uFEFF'+rows.map(row=>row.map(value=>{
    const cell=String(value);
    const safe=typeof value==='string'&&/^[\s]*[=+@-]/.test(cell)?"'"+cell:cell;
    return /[",\r\n]/.test(safe)?'"'+safe.replaceAll('"','""')+'"':safe;
  }).join(',')).join('\r\n')+'\r\n';
}
