import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const expected='kagemizu <249926125+Penumbrill@users.noreply.github.com>';
if(git('config','core.hooksPath')!=='.githooks')throw Error('core.hooksPath must remain .githooks');
for(const name of ['GIT_AUTHOR_IDENT','GIT_COMMITTER_IDENT'])if(!git('var',name).startsWith(expected+' '))throw Error('Unexpected '+name);
let head;try{head=git('rev-parse','--verify','HEAD');}catch{}
if(head){for(const identity of git('log','--all','--format=%an <%ae>%n%cn <%ce>').split('\n'))if(identity!==expected)throw Error('Unexpected identity in history');if(/^\s*(co-authored-by|signed-off-by):/im.test(git('log','--all','--format=%B')))throw Error('Attribution trailer in history');}
console.log('Identity and hook checks passed: '+expected+'; '+(head?'history checked':'no existing commits'));
