import type { Scope } from './domain';

const labels: [Scope, string][] = [
  ['wall','(?:interior |partition )?walls?|partitions?'],
  ['floor','(?:floor(?:ing)?|carpet|vct|lvt|floor finishes)'],
  ['ceiling','(?:ceilings?|ceiling grid|acoustic ceiling tiles?)'],
  ['slab','(?:concrete )?(?:slabs?|slab on grade)'],
  ['door','doors?(?: and frames)?'],
  ['fixture','(?:plumbing )?fixtures?|sinks?|toilets?|urinals?'],
  ['millwork','millwork|casework|cabinetry'],
];
const action='(?:remove|demo(?:lish)?)';
const suffix='(?:demo(?:lish(?:ed)?)?|remov(?:e|ed|al)|demolition)';
const patterns=labels.map(([scope,words])=>[scope,new RegExp(
  `^(?:${action} (?:existing )?(?:${words})|(?:existing )?(?:${words}) (?:to be )?${suffix})$`,'i',
)] as const);

export function demolitionLegend(text:string):Scope|undefined {
  const label=text.trim().replace(/\s+/g,' ').replace(/[.:]$/,'');
  if(/^(?:(?:grading|excavation|over[- ]excavation|cut|fill|earthwork) (?:area|limits|boundary)|limits of (?:grading|excavation))$/i.test(label))return 'grading';
  if(/^(?:saw[ -]?cut(?:ting)?(?: (?:lines?|concrete))?|concrete saw[ -]?cut)$/i.test(label))return 'sawcut';
  return patterns.find(([,pattern])=>pattern.test(label))?.[0];
}
