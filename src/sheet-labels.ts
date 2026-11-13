const keywords:[string,RegExp][]=[
  ['Demolition',/\b(?:demolition|demo|strip.out|tear.out)\b/i],
  ['Reflected ceiling',/\b(?:reflected ceiling|rcp)\b/i],
  ['Floor plan',/\bfloor plan\b/i],
  ['Mechanical',/\b(?:mechanical|hvac|ductwork)\b/i],
  ['Electrical',/\b(?:electrical|lighting plan|power plan)\b/i],
  ['Plumbing',/\b(?:plumbing|sanitary plan)\b/i],
  ['Structural',/\b(?:structural|foundation plan|framing plan)\b/i],
  ['Grading',/\b(?:grading plan|earthwork plan|excavation plan)\b/i],
  ['Site plan',/\b(?:site plan|civil plan)\b/i],
  ['Roof plan',/\broof plan\b/i],
  ['Elevations',/\belevations?\b/i],
  ['Details',/\b(?:details|sections)\b/i],
  ['Schedules',/\b(?:schedules?|panelboard)\b/i],
  ['Cover sheet',/\b(?:cover sheet|title sheet|sheet index)\b/i],
];

export function sheetIdentity(label:string, lines:string[]){
  const clean=(value:string)=>value.replace(/\\000|\0/g,'').replace(/\s+/g,' ').trim();
  const title=clean(label);
  const meaningful=title&&!/^(?:sheet|page)?\s*\d*$/i.test(title);
  const headings=lines.map(clean).filter(line=>line.length<=90);
  const terms=keywords.filter(([,pattern])=>pattern.test(title)||headings.some(line=>pattern.test(line))).map(([name])=>name);
  return {title:meaningful?title:terms.slice(0,2).join(' · '),keywords:terms};
}

export const normalizeSheetSearch=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'');

export function displaySheetName(name:string){
  return decodeSheetLabel(/^Sheet \d+ \((.+)\)$/.exec(name)?.[1]??name).replace(/\\000|\0/g,'').trim();
}

export function decodeSheetLabel(label:string){
  const encoded=/^<FEFF((?:[0-9a-f]{4})+)>$/i.exec(label.trim());
  const decoded=encoded?encoded[1].replace(/.{4}/g,part=>String.fromCharCode(parseInt(part,16))):label;
  return decoded.replace(/^\[\d+\]\s+(?=[A-Z]{1,5}[-.]?\d)/i,'').trim();
}
