const fs=require('fs');const s=fs.readFileSync(process.argv[2],'utf8');
const seen={};let i=0;
while((i=s.indexOf('Object.assign(ACTIONS,{',i))>0){
  let d=0,j=s.indexOf('{',i+21),k=j;
  for(;k<s.length;k++){ if(s[k]==='{')d++; else if(s[k]==='}'){d--; if(d===0)break;} }
  const block=s.slice(j+1,k); let depth=0;
  for(let p=0;p<block.length;p++){const c=block[p]; if(c==='{')depth++; else if(c==='}')depth--;
    if(depth===0){const mm=/^([A-Za-z_$][\w$]*)\s*\(/.exec(block.slice(p)); if(mm){(seen[mm[1]]=seen[mm[1]]||[]).push(s.slice(0,j).split('\n').length);} }}
  i=k;
}
Object.entries(seen).filter(([k,v])=>v.length>1).forEach(([k,v])=>console.log('  '+k+' -> lines '+v.join(', ')));
