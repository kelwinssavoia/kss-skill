#!/usr/bin/env node
import {mkdirSync,appendFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export const teamEventTypes=['phase.started','phase.completed','phase.blocked','decision.recorded','artifact.published','task.started','task.progress','task.completed','task.blocked','task.failed'];
export function recordTeamEvent(cwd,value){
 if(!value||!teamEventTypes.includes(value.type)||typeof value.phase!=='string'||!value.phase.trim())throw new Error('An event requires a supported type and phase.');
 if(value.type.startsWith('task.')&&(typeof value.taskId!=='string'||!value.taskId.trim()))throw new Error('A task event requires taskId.');
 const event={...value,id:randomUUID(),at:new Date().toISOString(),channelId:process.env.KSS_TEAM_CHANNEL??null};
 const line=JSON.stringify(event);if(Buffer.byteLength(line)>64000)throw new Error('Put large reports in an artifact and reference its path.');
 mkdirSync(join(cwd,'.kss'),{recursive:true});appendFileSync(join(cwd,'.kss/team-events.jsonl'),line+'\n',{mode:0o600});return event;
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){try{console.log(JSON.stringify(recordTeamEvent(process.cwd(),JSON.parse(process.argv[2]??'{}'))));}catch(error){console.error(error.message);process.exitCode=1;}}
