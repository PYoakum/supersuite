import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";

// ─── Constants & Theme ───
const DCOL_W = 100, DROW_H = 28, HDR_H = 28, RH_W = 46, INIT_R = 200, INIT_C = 26;
const STOR_PFX = "ss-wb:", STOR_IDX = "ss-index";
const C = { bg:"#fff",sf:"#f0f2f5",bd:"#d4d8dd",bl:"#e8eaed",tx:"#1a1a1a",tm:"#5f6368",ac:"#1a73e8",al:"#e8f0fe",ab:"#4285f4",hb:"#f0f2f5",ht:"#5f6368",sb:"#e8f0fe",tb:"#fff",ta:"#fff",er:"#d93025",gn:"#188038",wr:"#f9ab00",fr:"#e3f2fd" };
const F = "'IBM Plex Sans','Segoe UI',-apple-system,sans-serif";
const M = "'IBM Plex Mono','SF Mono',Consolas,monospace";
const bs = { border:"1px solid #e8eaed",background:"#fff",borderRadius:4,padding:"3px 10px",fontSize:12,fontFamily:F,cursor:"pointer",color:"#1a1a1a" };

// ─── Cell Utils ───
function c2l(i){let l="",n=i;while(n>=0){l=String.fromCharCode(65+(n%26))+l;n=Math.floor(n/26)-1;}return l;}
function l2c(l){let i=0;for(let c=0;c<l.length;c++)i=i*26+(l.charCodeAt(c)-64);return i-1;}
function pRef(r){const m=r.match(/^([A-Z]+)(\d+)$/);if(!m)return null;return{col:l2c(m[1]),row:parseInt(m[2])-1};}
function ck(r,c){return`${c2l(c)}${r+1}`;}

// ─── Formula Engine ───
const FNS={
  SUM:a=>a.flat().filter(v=>typeof v==="number").reduce((s,n)=>s+n,0),
  AVERAGE:a=>{const n=a.flat().filter(v=>typeof v==="number");return n.length?n.reduce((s,x)=>s+x,0)/n.length:0;},
  MIN:a=>{const n=a.flat().filter(v=>typeof v==="number");return n.length?Math.min(...n):0;},
  MAX:a=>{const n=a.flat().filter(v=>typeof v==="number");return n.length?Math.max(...n):0;},
  COUNT:a=>a.flat().filter(v=>typeof v==="number").length,
  COUNTA:a=>a.flat().filter(v=>v!==""&&v!=null).length,
  IF:a=>(a[0]?a[1]:a[2]), AND:a=>a.flat().every(Boolean), OR:a=>a.flat().some(Boolean), NOT:a=>!a[0],
  CONCAT:a=>a.flat().map(String).join(""),
  ROUND:a=>{const n=Number(a[0]),d=a[1]!=null?Number(a[1]):0;return Math.round(n*10**d)/10**d;},
  ABS:a=>Math.abs(Number(a[0])),SQRT:a=>{const n=Number(a[0]);return n<0?"#ERROR!":Math.sqrt(n);},
  POWER:a=>Math.pow(Number(a[0]),Number(a[1])),MOD:a=>Number(a[0])%Number(a[1]),INT:a=>Math.floor(Number(a[0])),
  UPPER:a=>String(a[0]??"").toUpperCase(),LOWER:a=>String(a[0]??"").toLowerCase(),TRIM:a=>String(a[0]??"").trim(),
  LEFT:a=>String(a[0]??"").slice(0,Number(a[1])||1),
  RIGHT:a=>{const s=String(a[0]??"");return s.slice(-(Number(a[1])||1));},
  MID:a=>String(a[0]??"").slice(Number(a[1])-1,Number(a[1])-1+Number(a[2])),
  LEN:a=>String(a[0]??"").length,
  MEDIAN:a=>{const n=a.flat().filter(v=>typeof v==="number").sort((x,y)=>x-y);if(!n.length)return 0;const m=Math.floor(n.length/2);return n.length%2?n[m]:(n[m-1]+n[m])/2;},
  STDEV:a=>{const n=a.flat().filter(v=>typeof v==="number");if(n.length<2)return 0;const av=n.reduce((s,x)=>s+x,0)/n.length;return Math.sqrt(n.reduce((s,x)=>s+(x-av)**2,0)/(n.length-1));},
  TODAY:()=>new Date().toISOString().slice(0,10),NOW:()=>new Date().toISOString().slice(0,19).replace("T"," "),
  PI:()=>Math.PI,
};
const FN_NAMES=Object.keys(FNS);

function tokenize(f){const t=[];let i=0;const s=f;while(i<s.length){if(s[i]===" "){i++;continue;}if("+-*/^(),:<>=&".includes(s[i])){if(s[i]==="<"&&s[i+1]===">"){t.push({type:"op",value:"<>"});i+=2;}else if(s[i]==="<"&&s[i+1]==="="){t.push({type:"op",value:"<="});i+=2;}else if(s[i]===">"&&s[i+1]==="="){t.push({type:"op",value:">="});i+=2;}else{t.push({type:"op",value:s[i]});i++;}continue;}if(s[i]==='"'){let str="";i++;while(i<s.length&&s[i]!=='"'){str+=s[i];i++;}i++;t.push({type:"string",value:str});continue;}if(/[0-9.]/.test(s[i])){let n="";while(i<s.length&&/[0-9.]/.test(s[i])){n+=s[i];i++;}t.push({type:"number",value:parseFloat(n)});continue;}if(/[A-Z]/i.test(s[i])){let id="";while(i<s.length&&/[A-Z0-9_]/i.test(s[i])){id+=s[i];i++;}t.push({type:"id",value:id.toUpperCase()});continue;}i++;}return t;}
function pE(t,p){return pCmp(t,p);}
function pCmp(t,p){let[l,i]=pAS(t,p);while(i<t.length&&t[i].type==="op"&&["<",">","<=",">=","=","<>"].includes(t[i].value)){const o=t[i].value;i++;const[r,n]=pAS(t,i);l={type:"binop",op:o,left:l,right:r};i=n;}return[l,i];}
function pAS(t,p){let[l,i]=pMD(t,p);while(i<t.length&&t[i].type==="op"&&"+-&".includes(t[i].value)){const o=t[i].value;i++;const[r,n]=pMD(t,i);l={type:"binop",op:o,left:l,right:r};i=n;}return[l,i];}
function pMD(t,p){let[l,i]=pPow(t,p);while(i<t.length&&t[i].type==="op"&&"*/".includes(t[i].value)){const o=t[i].value;i++;const[r,n]=pPow(t,i);l={type:"binop",op:o,left:l,right:r};i=n;}return[l,i];}
function pPow(t,p){let[l,i]=pUn(t,p);if(i<t.length&&t[i].type==="op"&&t[i].value==="^"){i++;const[r,n]=pPow(t,i);l={type:"binop",op:"^",left:l,right:r};i=n;}return[l,i];}
function pUn(t,p){if(p<t.length&&t[p].type==="op"&&t[p].value==="-"){const[n,i]=pAt(t,p+1);return[{type:"unary",op:"-",node:n},i];}return pAt(t,p);}
function pAt(t,p){if(p>=t.length)return[{type:"number",value:0},p];const tk=t[p];if(tk.type==="number")return[tk,p+1];if(tk.type==="string")return[tk,p+1];if(tk.type==="op"&&tk.value==="("){const[n,i]=pE(t,p+1);return[n,i<t.length&&t[i].value===")"?i+1:i];}if(tk.type==="id"){if(p+1<t.length&&t[p+1].value==="("){let i=p+2;const args=[];while(i<t.length&&t[i].value!==")"){if(t[i].value===","){i++;continue;}const[a,n]=pE(t,i);args.push(a);i=n;}if(i<t.length)i++;return[{type:"func",name:tk.value,args},i];}if(p+1<t.length&&t[p+1].value===":")return[{type:"range",from:tk.value,to:t[p+2]?.value||tk.value},p+3];if(pRef(tk.value))return[{type:"ref",value:tk.value},p+1];if(tk.value==="TRUE")return[{type:"number",value:true},p+1];if(tk.value==="FALSE")return[{type:"number",value:false},p+1];return[{type:"ref",value:tk.value},p+1];}return[{type:"number",value:0},p+1];}
function xRange(f,t){const a=pRef(f),b=pRef(t);if(!a||!b)return[];const c=[];for(let r=Math.min(a.row,b.row);r<=Math.max(a.row,b.row);r++)for(let cc=Math.min(a.col,b.col);cc<=Math.max(a.col,b.col);cc++)c.push(ck(r,cc));return c;}
function gDeps(ast){const d=new Set();(function w(n){if(!n)return;if(n.type==="ref")d.add(n.value);if(n.type==="range")xRange(n.from,n.to).forEach(c=>d.add(c));if(n.type==="func")n.args.forEach(w);if(n.type==="binop"){w(n.left);w(n.right);}if(n.type==="unary")w(n.node);})(ast);return d;}
function ev(ast,g){if(!ast)return"#ERROR!";switch(ast.type){case"number":case"string":return ast.value;case"ref":{const v=g(ast.value);return v==null||v===""?0:v;}case"range":return xRange(ast.from,ast.to).map(k=>{const v=g(k);return v==null||v===""?0:v;});case"unary":return-ev(ast.node,g);case"binop":{const l=ev(ast.left,g),r=ev(ast.right,g);switch(ast.op){case"+":return Number(l)+Number(r);case"-":return Number(l)-Number(r);case"*":return Number(l)*Number(r);case"/":return Number(r)===0?"#DIV/0!":Number(l)/Number(r);case"^":return Math.pow(Number(l),Number(r));case"&":return String(l)+String(r);case"<":return l<r;case">":return l>r;case"<=":return l<=r;case">=":return l>=r;case"=":return l==r;case"<>":return l!=r;default:return"#ERROR!";}}case"func":{const fn=FNS[ast.name];if(!fn)return"#NAME?";try{return fn(ast.args.map(a=>ev(a,g)));}catch{return"#ERROR!";}}default:return"#ERROR!";}}
function evalF(f,g){try{const t=tokenize(f);const[a]=pE(t,0);return ev(a,g);}catch{return"#ERROR!";}}
function gFDeps(f){try{const t=tokenize(f);const[a]=pE(t,0);return gDeps(a);}catch{return new Set();}}
function recalc(cells){const g={};const ks=Object.keys(cells);for(const k of ks){const c=cells[k];if(c?.raw&&String(c.raw).startsWith("="))g[k]=gFDeps(c.raw.slice(1));}const vis=new Set(),tmp=new Set(),ord=[];function visit(k){if(tmp.has(k))return;if(vis.has(k))return;tmp.add(k);g[k]?.forEach(d=>visit(d));tmp.delete(k);vis.add(k);ord.push(k);}ks.forEach(k=>visit(k));const nc={...cells};const get=k=>{const c=nc[k];return c?(c.value!=null?c.value:0):0;};for(const k of ord){const c=nc[k];if(c?.raw&&String(c.raw).startsWith("=")){const r=evalF(c.raw.slice(1),get);nc[k]={...c,value:r,type:typeof r==="string"&&String(r).startsWith("#")?"error":typeof r==="number"?"number":typeof r==="boolean"?"boolean":"text"};}}return nc;}
function fmtVal(v,fmt){if(v==null||v==="")return"";if(typeof v==="string"&&v.startsWith("#"))return v;if(typeof v==="boolean")return v?"TRUE":"FALSE";if(typeof v==="number"){switch(fmt?.numberFormat||"general"){case"integer":return Math.round(v).toLocaleString();case"decimal2":return v.toFixed(2);case"currency":return"$"+v.toFixed(2);case"percent":return(v*100).toFixed(1)+"%";default:return Number.isInteger(v)?String(v):parseFloat(v.toPrecision(10)).toString();}}return String(v);}

// ─── Workbook / Sheet / Cell ───
function mkWb(n){return{id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:n||"Untitled Spreadsheet",sheets:[mkSh("Sheet 1")],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};}
function mkSh(n){return{id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),name:n,rowCount:INIT_R,colCount:INIT_C,cells:{},colWidths:{},rowHeights:{},filters:{},frozenRow:0,frozenCol:0};}
function pCell(raw){if(raw===""||raw==null)return{raw:"",value:"",type:"empty"};const s=String(raw);if(s.startsWith("="))return{raw:s,value:null,type:"formula"};if(s==="TRUE"||s==="FALSE")return{raw:s,value:s==="TRUE",type:"boolean"};const n=Number(s);if(!isNaN(n)&&s.trim()!=="")return{raw:s,value:n,type:"number"};return{raw:s,value:s,type:"text"};}

// ─── Storage ───
async function sIdx(i){try{await window.storage.set(STOR_IDX,JSON.stringify(i));}catch(e){console.error(e);}}
async function lIdx(){try{const r=await window.storage.get(STOR_IDX);return r?.value?JSON.parse(r.value):[];}catch{return[];}}
async function sWb(wb){try{await window.storage.set(STOR_PFX+wb.id,JSON.stringify({...wb,updatedAt:new Date().toISOString()}));}catch(e){console.error(e);}}
async function lWb(id){try{const r=await window.storage.get(STOR_PFX+id);return r?.value?JSON.parse(r.value):null;}catch{return null;}}
async function dWb(id){try{await window.storage.delete(STOR_PFX+id);}catch(e){console.error(e);}}

// ─── CSV ───
function csvParse(t){const rs=[];let row=[],cell="",inQ=false;for(let i=0;i<t.length;i++){const ch=t[i];if(inQ){if(ch==='"'&&t[i+1]==='"'){cell+='"';i++;}else if(ch==='"')inQ=false;else cell+=ch;}else{if(ch==='"')inQ=true;else if(ch===","){row.push(cell);cell="";}else if(ch==="\n"||(ch==="\r"&&t[i+1]==="\n")){row.push(cell);rs.push(row);row=[];cell="";if(ch==="\r")i++;}else if(ch==="\r"){row.push(cell);rs.push(row);row=[];cell="";}else cell+=ch;}}if(cell||row.length){row.push(cell);rs.push(row);}return rs;}
function csvExport(cells){let mR=0,mC=0;for(const k of Object.keys(cells)){const r=pRef(k);if(r){mR=Math.max(mR,r.row);mC=Math.max(mC,r.col);}}const rs=[];for(let r=0;r<=mR;r++){const row=[];for(let c=0;c<=mC;c++){const cd=cells[ck(r,c)];const v=cd?(cd.value!=null?String(cd.value):cd.raw||""):"";row.push(v.includes(",")||v.includes('"')||v.includes("\n")?'"'+v.replace(/"/g,'""')+'"':v);}rs.push(row.join(","));}return rs.join("\n");}

// ─── Memoized Cell ───
const Cell=memo(function Cell({r,c,x,y,w,h,cd,isEd,isSel,inR,ev,onEC,onCm,onCn,onMD,onDC,onCM}){
  const fmt=cd.format||{};const dv=fmtVal(cd.value,fmt);const isErr=typeof cd.value==="string"&&String(cd.value).startsWith?.("#");
  return(<div style={{position:"absolute",left:x,top:y,width:w,height:h,borderRight:`1px solid ${C.bl}`,borderBottom:`1px solid ${C.bl}`,background:fmt.fillColor||(inR&&!isSel?C.sb:C.bg),boxSizing:"border-box",overflow:"hidden"}} onMouseDown={onMD} onDoubleClick={onDC} onContextMenu={onCM}>
    {isEd?(<input autoFocus value={ev} onChange={e=>onEC(e.target.value)} onBlur={()=>onCm(ev)} onKeyDown={e=>{if(e.key==="Enter")onCm(ev);if(e.key==="Escape")onCn();if(e.key==="Tab"){e.preventDefault();onCm(ev);}e.stopPropagation();}} style={{width:"100%",height:"100%",border:"none",outline:"none",padding:"0 4px",fontFamily:M,fontSize:13,background:"#fff",boxSizing:"border-box",color:C.tx}} />
    ):(<div style={{padding:"0 5px",lineHeight:`${h}px`,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontWeight:fmt.bold?600:400,fontStyle:fmt.italic?"italic":"normal",color:isErr?C.er:(fmt.textColor||C.tx),textAlign:fmt.align||(cd.type==="number"?"right":"left"),fontSize:13}}>{dv}</div>)}
  </div>);
});

// ─── Small UI ───
function TB({children,onClick,title,disabled,active}){const[h,sH]=useState(false);return<button onClick={onClick} title={title} disabled={disabled} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{border:"none",background:active?C.al:h?C.sf:"transparent",cursor:disabled?"default":"pointer",padding:"4px 6px",borderRadius:4,display:"flex",alignItems:"center",justifyContent:"center",color:disabled?"#c0c0c0":active?C.ac:"#444",opacity:disabled?.5:1,minWidth:28,height:28,transition:"background .1s"}}>{children}</button>;}
function Dv(){return<div style={{width:1,height:20,background:"#e0e0e0",margin:"0 4px"}} />;}
function MI({children,onClick,danger,shortcut}){const[h,sH]=useState(false);return<div onClick={onClick} onMouseEnter={()=>sH(true)} onMouseLeave={()=>sH(false)} style={{padding:"6px 16px",cursor:"pointer",background:h?C.sf:"transparent",color:danger?C.er:C.tx,fontSize:13,transition:"background .1s",display:"flex",justifyContent:"space-between",alignItems:"center",gap:16}}><span>{children}</span>{shortcut&&<span style={{fontSize:11,color:C.tm,fontFamily:M}}>{shortcut}</span>}</div>;}

// ═══ MAIN APP ═══
export default function SpreadsheetApp(){
  const[view,setView]=useState("loading");
  const[wbIdx,setWbIdx]=useState([]);
  const[wb,setWb]=useState(null);
  const[asi,setAsi]=useState(0);
  const[sel,setSel]=useState({row:0,col:0});
  const[rEnd,setREnd]=useState(null);
  const[ed,setEd]=useState(null);
  const[edV,setEdV]=useState("");
  const[fbFoc,setFbFoc]=useState(false);
  const[uStk,setUStk]=useState([]);
  const[rStk,setRStk]=useState([]);
  const[resz,setResz]=useState(null);
  const[selng,setSelng]=useState(false);
  const[ctx,setCtx]=useState(null);
  const[edSN,setEdSN]=useState(null);
  const[snV,setSnV]=useState("");
  const[sT,setST]=useState(0);
  const[sL,setSL]=useState(0);
  const[vpW,setVpW]=useState(800);
  const[vpH,setVpH]=useState(500);
  const[fOpen,setFOpen]=useState(false);
  const[fTxt,setFTxt]=useState("");
  const[rTxt,setRTxt]=useState("");
  const[fRes,setFRes]=useState([]);
  const[fIdx,setFIdx]=useState(-1);
  const[filtOn,setFiltOn]=useState(false);
  const[filling,setFilling]=useState(false);
  const[fillEnd,setFillEnd]=useState(null);
  const[showKB,setShowKB]=useState(false);
  const[acList,setAcList]=useState([]);
  const[acIdx,setAcIdx]=useState(0);
  const gRef=useRef(null);
  const fbRef=useRef(null);
  const fiRef=useRef(null);

  // ── Boot ──
  useEffect(()=>{(async()=>{setWbIdx(await lIdx());setView("home");})();},[]);
  const openWb=useCallback(async id=>{const w=await lWb(id);if(w){setWb(w);setAsi(0);setSel({row:0,col:0});setREnd(null);setUStk([]);setRStk([]);setView("editor");}},[]);
  const createNew=useCallback(async n=>{const w=mkWb(n);await sWb(w);const i=[...wbIdx,{id:w.id,name:w.name,updatedAt:w.updatedAt}];setWbIdx(i);await sIdx(i);setWb(w);setAsi(0);setSel({row:0,col:0});setREnd(null);setUStk([]);setRStk([]);setView("editor");},[wbIdx]);
  const delWb=useCallback(async id=>{await dWb(id);const i=wbIdx.filter(w=>w.id!==id);setWbIdx(i);await sIdx(i);},[wbIdx]);
  const goHome=useCallback(async()=>{if(wb){await sWb(wb);const i=wbIdx.map(w=>w.id===wb.id?{...w,name:wb.name,updatedAt:new Date().toISOString()}:w);setWbIdx(i);await sIdx(i);}setWb(null);setView("home");},[wb,wbIdx]);

  useEffect(()=>{if(!wb||view!=="editor")return;const t=setTimeout(()=>sWb(wb),1200);return()=>clearTimeout(t);},[wb,view]);

  const sh=wb?.sheets[asi];
  const gCW=useCallback(c=>sh?.colWidths?.[c]||DCOL_W,[sh]);
  const gRH=useCallback(r=>sh?.rowHeights?.[r]||DROW_H,[sh]);

  const cells=useMemo(()=>{if(!sh)return{};const p={};for(const[k,v]of Object.entries(sh.cells)){if(typeof v==="object"&&v!==null)p[k]=v;else p[k]=pCell(v);}return recalc(p);},[sh?.cells]);
  const gCD=useCallback(k=>cells[k]||{raw:"",value:"",type:"empty"},[cells]);
  const pU=useCallback(()=>{if(!sh)return;setUStk(p=>[...p.slice(-50),JSON.stringify(sh.cells)]);setRStk([]);},[sh]);
  const uC=useCallback(nc=>{setWb(w=>{const s=[...w.sheets];s[asi]={...s[asi],cells:nc};return{...w,sheets:s};});},[asi]);
  const uS=useCallback(u=>{setWb(w=>{const s=[...w.sheets];s[asi]={...s[asi],...u};return{...w,sheets:s};});},[asi]);

  const commit=useCallback(v=>{if(ed===null&&!fbFoc)return;const key=ck(sel.row,sel.col);pU();const ex=sh.cells[key];const p=pCell(v);uC({...sh.cells,[key]:{...p,format:typeof ex==="object"?ex?.format:undefined}});setEd(null);setFbFoc(false);setAcList([]);},[ed,fbFoc,sel,sh,pU,uC]);

  const undo=useCallback(()=>{if(!uStk.length)return;setRStk(r=>[...r,JSON.stringify(sh.cells)]);uC(JSON.parse(uStk[uStk.length-1]));setUStk(u=>u.slice(0,-1));},[uStk,sh,uC]);
  const redo=useCallback(()=>{if(!rStk.length)return;setUStk(u=>[...u,JSON.stringify(sh.cells)]);uC(JSON.parse(rStk[rStk.length-1]));setRStk(r=>r.slice(0,-1));},[rStk,sh,uC]);

  const sR=useMemo(()=>{if(!rEnd)return{r1:sel.row,c1:sel.col,r2:sel.row,c2:sel.col};return{r1:Math.min(sel.row,rEnd.row),c1:Math.min(sel.col,rEnd.col),r2:Math.max(sel.row,rEnd.row),c2:Math.max(sel.col,rEnd.col)};},[sel,rEnd]);
  const inR=useCallback((r,c)=>r>=sR.r1&&r<=sR.r2&&c>=sR.c1&&c<=sR.c2,[sR]);

  const aFmt=useCallback(fu=>{pU();const nc={...sh.cells};for(let r=sR.r1;r<=sR.r2;r++)for(let c=sR.c1;c<=sR.c2;c++){const k=ck(r,c);const e=nc[k]||pCell("");nc[k]={...e,format:{...e.format,...fu}};}uC(nc);},[sh,sR,pU,uC]);

  const insRow=useCallback(at=>{pU();const nc={};for(const[k,v]of Object.entries(sh.cells)){const r=pRef(k);if(!r)continue;nc[r.row>=at?ck(r.row+1,r.col):k]=v;}uC(nc);uS({rowCount:sh.rowCount+1});},[sh,pU,uC,uS]);
  const delRow=useCallback(at=>{pU();const nc={};for(const[k,v]of Object.entries(sh.cells)){const r=pRef(k);if(!r||r.row===at)continue;nc[r.row>at?ck(r.row-1,r.col):k]=v;}uC(nc);uS({rowCount:Math.max(1,sh.rowCount-1)});},[sh,pU,uC,uS]);
  const insCol=useCallback(at=>{pU();const nc={};for(const[k,v]of Object.entries(sh.cells)){const r=pRef(k);if(!r)continue;nc[r.col>=at?ck(r.row,r.col+1):k]=v;}uC(nc);uS({colCount:sh.colCount+1});},[sh,pU,uC,uS]);
  const delCol=useCallback(at=>{pU();const nc={};for(const[k,v]of Object.entries(sh.cells)){const r=pRef(k);if(!r||r.col===at)continue;nc[r.col>at?ck(r.row,r.col-1):k]=v;}uC(nc);uS({colCount:Math.max(1,sh.colCount-1)});},[sh,pU,uC,uS]);

  const sortR=useCallback((ci,asc)=>{pU();const rows=[];for(let r=sR.r1;r<=sR.r2;r++){const row={};for(let c=sR.c1;c<=sR.c2;c++)row[c]=gCD(ck(r,c));rows.push(row);}rows.sort((a,b)=>{const va=a[ci]?.value??"",vb=b[ci]?.value??"";if(typeof va==="number"&&typeof vb==="number")return asc?va-vb:vb-va;return asc?String(va).localeCompare(String(vb)):String(vb).localeCompare(String(va));});const nc={...sh.cells};rows.forEach((row,i)=>{const tr=sR.r1+i;for(let c=sR.c1;c<=sR.c2;c++){const k=ck(tr,c);if(row[c]?.type!=="empty")nc[k]=row[c];else delete nc[k];}});uC(nc);setCtx(null);},[sh,sR,gCD,pU,uC]);

  // ── Autofill ──
  const doFill=useCallback(()=>{if(!fillEnd)return;pU();const nc={...sh.cells};const dr=fillEnd.row>sR.r2?1:fillEnd.row<sR.r1?-1:0;const dc=fillEnd.col>sR.c2?1:fillEnd.col<sR.c1?-1:0;if(dr!==0){const srcRows=sR.r2-sR.r1+1;const startR=dr>0?sR.r2+1:fillEnd.row;const endR=dr>0?fillEnd.row:sR.r1-1;for(let r=startR;dr>0?r<=endR:r>=endR;r+=dr){for(let c=sR.c1;c<=sR.c2;c++){const srcR=sR.r1+((dr>0?r-sR.r2-1:sR.r1-r-1)%srcRows);const src=gCD(ck(srcR,c));if(src.type==="number"&&srcRows===1){const v=src.value+(dr>0?r-sR.r2:sR.r1-r);nc[ck(r,c)]={...src,raw:String(v),value:v};}else{nc[ck(r,c)]={...src};}}}}else if(dc!==0){const srcCols=sR.c2-sR.c1+1;const startC=dc>0?sR.c2+1:fillEnd.col;const endC=dc>0?fillEnd.col:sR.c1-1;for(let c=startC;dc>0?c<=endC:c>=endC;c+=dc){for(let r=sR.r1;r<=sR.r2;r++){const srcC=sR.c1+((dc>0?c-sR.c2-1:sR.c1-c-1)%srcCols);const src=gCD(ck(r,srcC));nc[ck(r,c)]={...src};}}}uC(nc);},[fillEnd,sR,sh,gCD,pU,uC]);

  useEffect(()=>{if(!filling)return;const onM=e=>{if(!gRef.current)return;const rect=gRef.current.getBoundingClientRect();const x=e.clientX-rect.left+gRef.current.scrollLeft-RH_W;const y=e.clientY-rect.top+gRef.current.scrollTop-HDR_H;let col=0,row=0;for(let c=0;c<cPos.length;c++)if(cPos[c].x+cPos[c].w>x){col=c;break;}for(let r=0;r<rPos.length;r++)if(rPos[r].y+rPos[r].h>y){row=r;break;}setFillEnd({row,col});};const onU=()=>{setFilling(false);doFill();setFillEnd(null);};window.addEventListener("mousemove",onM);window.addEventListener("mouseup",onU);return()=>{window.removeEventListener("mousemove",onM);window.removeEventListener("mouseup",onU);};},[filling,doFill]);

  // ── Auto-fit column ──
  const autoFitCol=useCallback(c=>{let maxW=40;for(let r=0;r<Math.min(sh.rowCount,200);r++){const cd=gCD(ck(r,c));const v=fmtVal(cd.value,cd.format);if(v)maxW=Math.max(maxW,v.length*8+16);}uS({colWidths:{...sh.colWidths,[c]:Math.min(300,maxW)}});},[sh,gCD,uS]);

  // ── Filters ──
  const hidR=useMemo(()=>{if(!filtOn||!sh?.filters)return new Set();const h=new Set();const fc=Object.keys(sh.filters).filter(k=>sh.filters[k]).map(Number);if(!fc.length)return h;for(let r=1;r<sh.rowCount;r++)for(const c of fc){const cd=gCD(ck(r,c));const v=cd.value!=null?String(cd.value).toLowerCase():"";if(!v.includes(sh.filters[c].toLowerCase())){h.add(r);break;}}return h;},[filtOn,sh?.filters,sh?.rowCount,gCD]);

  // ── Find ──
  const doFind=useCallback(()=>{if(!fTxt){setFRes([]);setFIdx(-1);return;}const res=[];const s=fTxt.toLowerCase();for(const[k,cd]of Object.entries(cells)){const raw=(cd.raw||"").toLowerCase();const val=String(cd.value??"").toLowerCase();if(raw.includes(s)||val.includes(s)){const ref=pRef(k);if(ref)res.push({key:k,row:ref.row,col:ref.col});}}res.sort((a,b)=>a.row-b.row||a.col-b.col);setFRes(res);setFIdx(res.length?0:-1);if(res.length){setSel({row:res[0].row,col:res[0].col});setREnd(null);}},[fTxt,cells]);
  const fNext=useCallback(()=>{if(!fRes.length)return;const i=(fIdx+1)%fRes.length;setFIdx(i);setSel({row:fRes[i].row,col:fRes[i].col});setREnd(null);},[fRes,fIdx]);
  const fPrev=useCallback(()=>{if(!fRes.length)return;const i=(fIdx-1+fRes.length)%fRes.length;setFIdx(i);setSel({row:fRes[i].row,col:fRes[i].col});setREnd(null);},[fRes,fIdx]);
  const repOne=useCallback(()=>{if(fIdx<0||!fRes.length)return;const{key}=fRes[fIdx];const cd=cells[key];if(!cd)return;pU();const nr=cd.raw.replace(new RegExp(fTxt.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"),rTxt);uC({...sh.cells,[key]:{...pCell(nr),format:cd.format}});setTimeout(doFind,50);},[fIdx,fRes,cells,fTxt,rTxt,sh,pU,uC,doFind]);
  const repAll=useCallback(()=>{if(!fRes.length)return;pU();const nc={...sh.cells};const re=new RegExp(fTxt.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"gi");for(const{key}of fRes){const cd=cells[key];if(!cd)continue;nc[key]={...pCell(cd.raw.replace(re,rTxt)),format:cd.format};}uC(nc);setTimeout(doFind,50);},[fRes,cells,fTxt,rTxt,sh,pU,uC,doFind]);

  const expCSV=useCallback(()=>{if(!sh)return;const csv=csvExport(cells);const b=new Blob([csv],{type:"text/csv"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=(wb.name||"spreadsheet")+".csv";a.click();URL.revokeObjectURL(u);},[sh,cells,wb]);

  // ── Formula autocomplete ──
  useEffect(()=>{if(!edV||!edV.startsWith("=")){setAcList([]);return;}const parts=edV.toUpperCase().split(/[^A-Z]/);const last=parts[parts.length-1];if(last&&last.length>=1){const matches=FN_NAMES.filter(n=>n.startsWith(last)&&n!==last);setAcList(matches.slice(0,6));setAcIdx(0);}else setAcList([]);},[edV]);

  const insertAC=useCallback(fn=>{const parts=edV.split(/([^A-Za-z])/);let found=false;for(let i=parts.length-1;i>=0;i--){if(/^[A-Za-z]+$/.test(parts[i])){parts[i]=fn+"(";found=true;break;}}setEdV(found?parts.join(""):edV+fn+"(");setAcList([]);},[edV]);

  // ── Status bar ──
  const statusInfo=useMemo(()=>{const nums=[];let cnt=0;for(let r=sR.r1;r<=sR.r2;r++)for(let c=sR.c1;c<=sR.c2;c++){const cd=gCD(ck(r,c));if(cd.type!=="empty")cnt++;if(typeof cd.value==="number")nums.push(cd.value);}const n=(sR.r2-sR.r1+1)*(sR.c2-sR.c1+1);if(nums.length>=2){const sum=nums.reduce((a,b)=>a+b,0);return`Count: ${cnt}  Sum: ${parseFloat(sum.toPrecision(10))}  Avg: ${parseFloat((sum/nums.length).toPrecision(8))}  Min: ${Math.min(...nums)}  Max: ${Math.max(...nums)}`;}if(n>1)return`${n} cells  Count: ${cnt}`;return"";},[sR,gCD]);

  // ── Keyboard ──
  const hKD=useCallback(e=>{
    if(edSN!==null)return;
    if(e.key==="Escape"){if(ed!==null){setEd(null);setAcList([]);return;}if(fOpen){setFOpen(false);return;}if(ctx){setCtx(null);return;}if(showKB){setShowKB(false);return;}}
    if((e.ctrlKey||e.metaKey)&&e.key==="f"){e.preventDefault();setFOpen(o=>!o);return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="h"){e.preventDefault();setFOpen(true);return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="z"){e.preventDefault();e.shiftKey?redo():undo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="y"){e.preventDefault();redo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="b"){e.preventDefault();aFmt({bold:!gCD(ck(sel.row,sel.col)).format?.bold});return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="i"&&!e.shiftKey){e.preventDefault();aFmt({italic:!gCD(ck(sel.row,sel.col)).format?.italic});return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="a"){e.preventDefault();setSel({row:0,col:0});setREnd({row:(sh?.rowCount||1)-1,col:(sh?.colCount||1)-1});return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="/"){e.preventDefault();setShowKB(o=>!o);return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="c"){const t=[];for(let r=sR.r1;r<=sR.r2;r++){const row=[];for(let c=sR.c1;c<=sR.c2;c++){const cd=gCD(ck(r,c));row.push(cd.value!=null?String(cd.value):"");}t.push(row.join("\t"));}navigator.clipboard?.writeText(t.join("\n"));e.preventDefault();return;}
    if((e.ctrlKey||e.metaKey)&&e.key==="v"){navigator.clipboard?.readText().then(text=>{if(!text)return;pU();const rows=text.split("\n").map(r=>r.split("\t"));const nc={...sh.cells};rows.forEach((row,ri)=>{row.forEach((val,ci)=>{const k=ck(sel.row+ri,sel.col+ci);const ex=nc[k];nc[k]={...pCell(val),format:typeof ex==="object"?ex?.format:undefined};});});uC(nc);});e.preventDefault();return;}
    // AC nav
    if(acList.length&&(ed!==null||fbFoc)){if(e.key==="ArrowDown"){e.preventDefault();setAcIdx(i=>(i+1)%acList.length);return;}if(e.key==="ArrowUp"){e.preventDefault();setAcIdx(i=>(i-1+acList.length)%acList.length);return;}if(e.key==="Tab"||e.key==="Enter"){if(acList.length){e.preventDefault();insertAC(acList[acIdx]);return;}}}
    if(ed!==null||fbFoc){if(e.key==="Enter"&&!acList.length){commit(edV);setSel(s=>({row:Math.min(s.row+1,(sh?.rowCount||1)-1),col:s.col}));setREnd(null);return;}if(e.key==="Tab"&&!acList.length){e.preventDefault();commit(edV);setSel(s=>({row:s.row,col:Math.min(s.col+1,(sh?.colCount||1)-1)}));setREnd(null);return;}return;}
    if(e.key==="Delete"||e.key==="Backspace"){pU();const nc={...sh.cells};for(let r=sR.r1;r<=sR.r2;r++)for(let c=sR.c1;c<=sR.c2;c++){const k=ck(r,c);const ex=nc[k];if(ex)nc[k]={raw:"",value:"",type:"empty",format:ex.format};else delete nc[k];}uC(nc);return;}
    if(e.key==="Home"){e.preventDefault();if(e.ctrlKey||e.metaKey)setSel({row:0,col:0});else setSel(s=>({...s,col:0}));setREnd(null);return;}
    if(e.key==="End"){e.preventDefault();if(e.ctrlKey||e.metaKey)setSel({row:(sh?.rowCount||1)-1,col:(sh?.colCount||1)-1});else setSel(s=>({...s,col:(sh?.colCount||1)-1}));setREnd(null);return;}
    const mv=(dr,dc)=>{e.preventDefault();if(e.shiftKey){setREnd(p=>{const b=p||sel;return{row:Math.max(0,Math.min((sh?.rowCount||1)-1,b.row+dr)),col:Math.max(0,Math.min((sh?.colCount||1)-1,b.col+dc))};});}else{setSel(s=>({row:Math.max(0,Math.min((sh?.rowCount||1)-1,s.row+dr)),col:Math.max(0,Math.min((sh?.colCount||1)-1,s.col+dc))}));setREnd(null);}};
    switch(e.key){case"ArrowUp":mv(-1,0);break;case"ArrowDown":mv(1,0);break;case"ArrowLeft":mv(0,-1);break;case"ArrowRight":mv(0,1);break;case"Enter":case"F2":setEd(sel);setEdV(gCD(ck(sel.row,sel.col)).raw||"");break;case"Tab":e.preventDefault();setSel(s=>({row:s.row,col:Math.min(s.col+1,(sh?.colCount||1)-1)}));setREnd(null);break;default:if(e.key.length===1&&!e.ctrlKey&&!e.metaKey){setEd(sel);setEdV(e.key);e.preventDefault();}}
  },[ed,edV,sel,sh,sR,fbFoc,commit,undo,redo,pU,uC,gCD,aFmt,ctx,edSN,fOpen,showKB,acList,acIdx,insertAC]);

  useEffect(()=>{window.addEventListener("keydown",hKD);return()=>window.removeEventListener("keydown",hKD);},[hKD]);
  useEffect(()=>{if(!ctx)return;const h=()=>setCtx(null);window.addEventListener("click",h);return()=>window.removeEventListener("click",h);},[ctx]);

  // ── Positions ──
  const cPos=useMemo(()=>{if(!sh)return[];const p=[];let x=0;for(let c=0;c<sh.colCount;c++){const w=gCW(c);p.push({x,w});x+=w;}return p;},[sh,gCW]);
  const tW=useMemo(()=>cPos.length?cPos[cPos.length-1].x+cPos[cPos.length-1].w:0,[cPos]);
  const rPos=useMemo(()=>{if(!sh)return[];const p=[];let y=0;for(let r=0;r<sh.rowCount;r++){const h=gRH(r);p.push({y,h});y+=h;}return p;},[sh,gRH]);
  const tH=useMemo(()=>rPos.length?rPos[rPos.length-1].y+rPos[rPos.length-1].h:0,[rPos]);

  useEffect(()=>{if(!gRef.current)return;const o=new ResizeObserver(en=>{for(const e of en){setVpW(e.contentRect.width);setVpH(e.contentRect.height);}});o.observe(gRef.current);return()=>o.disconnect();},[]);

  const frozenRow=sh?.frozenRow||0;
  const frozenCol=sh?.frozenCol||0;
  const visR=useMemo(()=>{const rows=[];for(let r=0;r<rPos.length;r++){if(hidR.has(r))continue;const rp=rPos[r];if(r>=frozenRow&&(rp.y+rp.h<sT-100))continue;if(r>=frozenRow&&rp.y>sT+vpH+100)break;rows.push(r);}return rows;},[rPos,sT,vpH,hidR,frozenRow]);
  const visC=useMemo(()=>{const cols=[];for(let c=0;c<cPos.length;c++){const cp=cPos[c];if(c>=frozenCol&&cp.x+cp.w<sL-100)continue;if(c>=frozenCol&&cp.x>sL+vpW+100)break;cols.push(c);}return cols;},[cPos,sL,vpW,frozenCol]);

  useEffect(()=>{if(!gRef.current||!cPos.length||!rPos.length)return;const rp=rPos[sel.row],cp=cPos[sel.col];if(!rp||!cp)return;const el=gRef.current;if(rp.y<el.scrollTop)el.scrollTop=rp.y;if(rp.y+rp.h>el.scrollTop+el.clientHeight-HDR_H)el.scrollTop=rp.y+rp.h-el.clientHeight+HDR_H;if(cp.x<el.scrollLeft)el.scrollLeft=cp.x;if(cp.x+cp.w>el.scrollLeft+el.clientWidth-RH_W)el.scrollLeft=cp.x+cp.w-el.clientWidth+RH_W;},[sel,cPos,rPos]);

  useEffect(()=>{if(!resz)return;const onM=e=>{if(resz.type==="col")uS({colWidths:{...sh.colWidths,[resz.index]:Math.max(30,resz.startW+e.clientX-resz.startX)}});else uS({rowHeights:{...sh.rowHeights,[resz.index]:Math.max(16,resz.startH+e.clientY-resz.startY)}});};const onU=()=>setResz(null);window.addEventListener("mousemove",onM);window.addEventListener("mouseup",onU);return()=>{window.removeEventListener("mousemove",onM);window.removeEventListener("mouseup",onU);};},[resz,sh,uS]);
  useEffect(()=>{if(!selng)return;const onM=e=>{if(!gRef.current)return;const rect=gRef.current.getBoundingClientRect();const x=e.clientX-rect.left+gRef.current.scrollLeft-RH_W;const y=e.clientY-rect.top+gRef.current.scrollTop-HDR_H;let col=0,row=0;for(let c=0;c<cPos.length;c++)if(cPos[c].x+cPos[c].w>x){col=c;break;}for(let r=0;r<rPos.length;r++)if(rPos[r].y+rPos[r].h>y){row=r;break;}setREnd({row,col});};const onU=()=>setSelng(false);window.addEventListener("mousemove",onM);window.addEventListener("mouseup",onU);return()=>{window.removeEventListener("mousemove",onM);window.removeEventListener("mouseup",onU);};},[selng,cPos,rPos]);

  // ═══ RENDER ═══
  if(view==="loading")return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#f8f9fa",fontFamily:F}}><span style={{color:"#555"}}>Loading...</span></div>;

  // ═══ HOME ═══
  if(view==="home"){return(
    <div style={{height:"100vh",background:"#f8f9fa",fontFamily:F,display:"flex",flexDirection:"column"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{padding:"20px 32px",borderBottom:`1px solid ${C.bl}`,background:"#fff",display:"flex",alignItems:"center",gap:10}}>
        <svg width="28" height="28" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" fill={C.ac}/><path d="M5 6h10M5 10h10M5 14h10" stroke="#fff" strokeWidth="1.5"/></svg>
        <span style={{fontSize:20,fontWeight:600,color:C.tx}}>Spreadsheets</span>
      </div>
      <div style={{flex:1,overflow:"auto",padding:"24px 32px",maxWidth:900}}>
        <div style={{display:"flex",gap:12,marginBottom:28,flexWrap:"wrap"}}>
          <button onClick={()=>createNew()} style={{padding:"10px 20px",background:C.ac,color:"#fff",border:"none",borderRadius:8,fontFamily:F,fontSize:14,fontWeight:500,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}><span style={{fontSize:18,lineHeight:1}}>+</span> New Spreadsheet</button>
          <button onClick={()=>fiRef.current?.click()} style={{padding:"10px 20px",background:"#fff",color:C.tx,border:`1px solid ${C.bd}`,borderRadius:8,fontFamily:F,fontSize:14,fontWeight:500,cursor:"pointer"}}>Import CSV</button>
          <input ref={fiRef} type="file" accept=".csv,.tsv,.txt" style={{display:"none"}} onChange={e=>{const file=e.target.files?.[0];if(!file)return;const reader=new FileReader();reader.onload=async()=>{const w=mkWb(file.name.replace(/\.\w+$/,""));const rows=csvParse(reader.result);const nc={};let mC=0;rows.forEach((row,r)=>{row.forEach((val,c)=>{if(val)nc[ck(r,c)]=pCell(val);mC=Math.max(mC,c);});});w.sheets[0].cells=nc;w.sheets[0].rowCount=Math.max(INIT_R,rows.length+50);w.sheets[0].colCount=Math.max(INIT_C,mC+5);await sWb(w);const idx=[...wbIdx,{id:w.id,name:w.name,updatedAt:w.updatedAt}];setWbIdx(idx);await sIdx(idx);setWb(w);setAsi(0);setView("editor");};reader.readAsText(file);e.target.value="";}} />
        </div>
        {!wbIdx.length?<div style={{padding:40,textAlign:"center",color:C.tm,fontSize:15}}>No spreadsheets yet. Create one to get started.</div>:(
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 180px 60px",padding:"8px 16px",fontSize:11,fontWeight:600,color:C.tm,textTransform:"uppercase",letterSpacing:"0.05em"}}><span>Name</span><span>Last Modified</span><span></span></div>
            {[...wbIdx].sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt)).map(w=>(
              <div key={w.id} onClick={()=>openWb(w.id)} style={{display:"grid",gridTemplateColumns:"1fr 180px 60px",padding:"12px 16px",background:"#fff",borderRadius:8,cursor:"pointer",alignItems:"center",border:`1px solid ${C.bl}`,transition:"box-shadow .15s"}} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.08)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
                <div style={{display:"flex",alignItems:"center",gap:10}}><svg width="18" height="18" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" fill={C.gn}/><path d="M5 6h10M5 10h10M5 14h10" stroke="#fff" strokeWidth="1.2"/></svg><span style={{fontWeight:500,color:C.tx}}>{w.name}</span></div>
                <span style={{fontSize:12,color:C.tm}}>{new Date(w.updatedAt).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric",hour:"2-digit",minute:"2-digit"})}</span>
                <button onClick={e=>{e.stopPropagation();if(confirm("Delete this spreadsheet?"))delWb(w.id);}} style={{border:"none",background:"none",color:C.tm,cursor:"pointer",padding:4,borderRadius:4,fontSize:16,lineHeight:1}} title="Delete">×</button>
              </div>))}
          </div>)}
      </div>
    </div>);}

  // ═══ EDITOR ═══
  if(!wb||!sh)return null;
  const cKey=ck(sel.row,sel.col);const cCell=gCD(cKey);
  const fillHandlePos=cPos[sR.c2]&&rPos[sR.r2]?{x:cPos[sR.c2].x+cPos[sR.c2].w-3,y:rPos[sR.r2].y+rPos[sR.r2].h-3}:null;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"100vh",background:C.bg,fontFamily:F,fontSize:13,color:C.tx,userSelect:"none",overflow:"hidden"}}>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Title */}
      <div style={{display:"flex",alignItems:"center",padding:"4px 10px",borderBottom:`1px solid ${C.bl}`,background:C.bg,gap:8,minHeight:36}}>
        <button onClick={goHome} style={{border:"none",background:"none",cursor:"pointer",padding:"4px 8px",borderRadius:4,display:"flex",alignItems:"center",color:C.tm,fontFamily:F}} title="Back"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></button>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="2" width="16" height="16" rx="2" fill={C.ac}/><path d="M5 6h10M5 10h10M5 14h10" stroke="#fff" strokeWidth="1.5"/></svg>
        <input value={wb.name} onChange={e=>setWb({...wb,name:e.target.value})} onFocus={e=>e.target.select()} style={{border:"none",background:"transparent",fontSize:14,fontWeight:500,fontFamily:F,color:C.tx,padding:"2px 4px",borderRadius:4,outline:"none",width:240}} />
        <div style={{flex:1}} />
        <button onClick={expCSV} style={bs} title="Export CSV">Export CSV</button>
        <button onClick={()=>setShowKB(o=>!o)} style={{...bs,fontSize:11,padding:"3px 8px"}} title="Keyboard shortcuts (Ctrl+/)">⌨</button>
        <span style={{fontSize:11,color:C.tm,marginLeft:4}}>autosaved</span>
      </div>

      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",padding:"3px 8px",borderBottom:`1px solid ${C.bl}`,background:C.tb,gap:2,flexWrap:"wrap",minHeight:34}}>
        <TB title="Undo" onClick={undo} disabled={!uStk.length}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M4 8l4-4v3h4a3 3 0 010 6H8" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></TB>
        <TB title="Redo" onClick={redo} disabled={!rStk.length}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M12 8l-4-4v3H4a3 3 0 000 6h4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/></svg></TB>
        <Dv />
        <TB title="Bold" onClick={()=>aFmt({bold:!cCell.format?.bold})} active={cCell.format?.bold}><span style={{fontWeight:700,fontSize:14}}>B</span></TB>
        <TB title="Italic" onClick={()=>aFmt({italic:!cCell.format?.italic})} active={cCell.format?.italic}><span style={{fontStyle:"italic",fontSize:14,fontFamily:"Georgia,serif"}}>I</span></TB>
        <Dv />
        {["left","center","right"].map(a=><TB key={a} title={`Align ${a}`} onClick={()=>aFmt({align:a})} active={cCell.format?.align===a}><svg width="16" height="16" viewBox="0 0 16 16"><path d={a==="left"?"M3 4h10M3 7h6M3 10h8M3 13h5":a==="center"?"M3 4h10M5 7h6M4 10h8M5 13h6":"M3 4h10M7 7h6M5 10h8M8 13h5"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></TB>)}
        <Dv />
        <label title="Text Color" style={{display:"flex",alignItems:"center",cursor:"pointer",position:"relative"}}><div style={{padding:"3px 5px",borderRadius:4}}><span style={{fontSize:14,fontWeight:600,color:cCell.format?.textColor||C.tx,borderBottom:`3px solid ${cCell.format?.textColor||C.tx}`,lineHeight:1}}>A</span></div><input type="color" value={cCell.format?.textColor||"#000000"} onChange={e=>aFmt({textColor:e.target.value})} style={{position:"absolute",opacity:0,width:0,height:0}} /></label>
        <label title="Fill Color" style={{display:"flex",alignItems:"center",cursor:"pointer",position:"relative"}}><div style={{padding:"3px 5px",borderRadius:4}}><div style={{width:16,height:16,background:cCell.format?.fillColor||"#fff",border:`1px solid ${C.bd}`,borderRadius:3}} /></div><input type="color" value={cCell.format?.fillColor||"#ffffff"} onChange={e=>aFmt({fillColor:e.target.value})} style={{position:"absolute",opacity:0,width:0,height:0}} /></label>
        <Dv />
        <select value={cCell.format?.numberFormat||"general"} onChange={e=>aFmt({numberFormat:e.target.value})} title="Format" style={{border:`1px solid ${C.bl}`,borderRadius:4,padding:"2px 4px",fontSize:12,fontFamily:F,background:C.bg,color:C.tx,cursor:"pointer",outline:"none"}}><option value="general">General</option><option value="integer">Integer</option><option value="decimal2">Decimal</option><option value="currency">Currency</option><option value="percent">Percent</option></select>
        <Dv />
        <TB title="Toggle Filters" onClick={()=>setFiltOn(f=>!f)} active={filtOn}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M2 4h12L9 9v4l-2-1V9L2 4z" stroke="currentColor" strokeWidth="1.3" fill={filtOn?C.al:"none"} strokeLinejoin="round"/></svg></TB>
        <TB title="Freeze Row 1" onClick={()=>uS({frozenRow:sh.frozenRow?0:1})} active={sh.frozenRow>0}><svg width="16" height="16" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/><path d="M2 6h12" stroke="currentColor" strokeWidth="1.5"/>{sh.frozenRow>0&&<path d="M7 9l2 2 4-4" stroke={C.ac} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>}</svg></TB>
        <TB title="Find (Ctrl+F)" onClick={()=>setFOpen(o=>!o)} active={fOpen}><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4" stroke="currentColor" strokeWidth="1.5" fill="none"/><path d="M10 10l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></TB>
        <TB title="Clear Formatting" onClick={()=>aFmt({bold:false,italic:false,textColor:undefined,fillColor:undefined,align:undefined,numberFormat:"general"})}><svg width="16" height="16" viewBox="0 0 16 16"><path d="M3 13h10M6 3l-2 7h1.5L6 8h4l.5 2H12L10 3H6z" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round"/><path d="M11 3l2 10" stroke={C.er} strokeWidth="1.5" strokeLinecap="round"/></svg></TB>
      </div>

      {/* Find bar */}
      {fOpen&&<div style={{display:"flex",alignItems:"center",padding:"4px 12px",gap:8,borderBottom:`1px solid ${C.bl}`,background:"#fafbfc",flexWrap:"wrap"}}>
        <input value={fTxt} onChange={e=>setFTxt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();doFind();}e.stopPropagation();}} placeholder="Find..." style={{border:`1px solid ${C.bl}`,borderRadius:4,padding:"4px 8px",fontSize:13,fontFamily:F,outline:"none",width:170,background:"#fff"}} autoFocus />
        <input value={rTxt} onChange={e=>setRTxt(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();repOne();}e.stopPropagation();}} placeholder="Replace..." style={{border:`1px solid ${C.bl}`,borderRadius:4,padding:"4px 8px",fontSize:13,fontFamily:F,outline:"none",width:170,background:"#fff"}} />
        <button onClick={doFind} style={bs}>Find</button><button onClick={fPrev} disabled={!fRes.length} style={bs}>‹</button><button onClick={fNext} disabled={!fRes.length} style={bs}>›</button>
        <button onClick={repOne} disabled={fIdx<0} style={bs}>Replace</button><button onClick={repAll} disabled={!fRes.length} style={bs}>All</button>
        <span style={{fontSize:12,color:C.tm}}>{fRes.length?`${fIdx+1} / ${fRes.length}`:fTxt?"No results":""}</span>
        <button onClick={()=>setFOpen(false)} style={{...bs,marginLeft:"auto"}}>×</button>
      </div>}

      {/* Formula bar */}
      <div style={{display:"flex",alignItems:"center",borderBottom:`1px solid ${C.bl}`,background:C.bg,minHeight:28,position:"relative"}}>
        <div style={{width:RH_W+56,padding:"0 8px",fontFamily:M,fontSize:12,color:C.ac,fontWeight:500,textAlign:"center",borderRight:`1px solid ${C.bl}`,lineHeight:"28px"}}>{cKey}</div>
        <div style={{padding:"0 6px",color:C.tm,fontSize:13}}><i>f</i><sub>x</sub></div>
        <input ref={fbRef} value={fbFoc?edV:(cCell.raw||"")} onChange={e=>{setEdV(e.target.value);}} onFocus={()=>{setFbFoc(true);setEdV(cCell.raw||"");}} onBlur={()=>{if(fbFoc)commit(edV);}} onKeyDown={e=>{if(e.key==="Enter"&&!acList.length){e.preventDefault();commit(edV);fbRef.current?.blur();}if(e.key==="Escape"){setFbFoc(false);setEd(null);setAcList([]);}}} style={{flex:1,border:"none",outline:"none",fontFamily:M,fontSize:13,padding:"0 4px",height:28,background:"transparent",color:C.tx}} />
        {/* Autocomplete */}
        {acList.length>0&&(ed||fbFoc)&&<div style={{position:"absolute",top:28,left:RH_W+80,background:"#fff",border:`1px solid ${C.bd}`,borderRadius:6,boxShadow:"0 4px 12px rgba(0,0,0,0.1)",zIndex:100,minWidth:180,padding:"4px 0"}}>
          {acList.map((fn,i)=><div key={fn} onClick={()=>insertAC(fn)} style={{padding:"5px 12px",fontSize:12,fontFamily:M,cursor:"pointer",background:i===acIdx?C.al:"transparent",color:i===acIdx?C.ac:C.tx}}>{fn}()</div>)}
        </div>}
      </div>

      {/* Filter inputs */}
      {filtOn&&<div style={{display:"flex",borderBottom:`1px solid ${C.bd}`,background:"#f5f7fa",minHeight:26,overflow:"hidden"}}>
        <div style={{width:RH_W,minWidth:RH_W,borderRight:`1px solid ${C.bd}`,display:"flex",alignItems:"center",justifyContent:"center"}}><svg width="12" height="12" viewBox="0 0 16 16"><path d="M2 4h12L9 9v4l-2-1V9L2 4z" stroke={C.tm} strokeWidth="1.3" fill="none"/></svg></div>
        <div style={{display:"flex",overflow:"hidden",transform:`translateX(${-sL}px)`}}>{Array.from({length:sh.colCount},(_,c)=><input key={c} value={sh.filters?.[c]||""} onChange={e=>uS({filters:{...sh.filters,[c]:e.target.value}})} onKeyDown={e=>e.stopPropagation()} placeholder={`Filter ${c2l(c)}`} style={{width:gCW(c),minWidth:gCW(c),border:"none",borderRight:`1px solid ${C.bl}`,outline:"none",padding:"0 4px",fontSize:11,fontFamily:F,background:"transparent",height:26,color:C.tx,boxSizing:"border-box"}} />)}</div>
      </div>}

      {/* Grid */}
      <div ref={gRef} style={{flex:1,overflow:"auto",position:"relative",background:C.bg}} onScroll={e=>{setST(e.target.scrollTop);setSL(e.target.scrollLeft);}}>
        {/* Col headers */}
        <div style={{position:"sticky",top:0,zIndex:20,display:"flex",background:C.hb,borderBottom:`1px solid ${C.bd}`}}>
          <div onClick={()=>{setSel({row:0,col:0});setREnd({row:(sh?.rowCount||1)-1,col:(sh?.colCount||1)-1});}} style={{width:RH_W,minWidth:RH_W,height:HDR_H,borderRight:`1px solid ${C.bd}`,position:"sticky",left:0,zIndex:30,background:C.hb,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}} title="Select All"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1h8v8H1z" stroke={C.ht} strokeWidth="1" fill="none"/><path d="M1 1l8 8M9 1l-8 8" stroke={C.ht} strokeWidth=".7"/></svg></div>
          <div style={{position:"relative",width:tW,height:HDR_H}}>{visC.map(c=>(
            <div key={c} style={{position:"absolute",left:cPos[c].x,width:cPos[c].w,height:HDR_H,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,color:c>=sR.c1&&c<=sR.c2?C.ac:C.ht,background:c>=sR.c1&&c<=sR.c2?C.al:C.hb,borderRight:`1px solid ${C.bd}`,cursor:"default"}}
              onClick={()=>{setSel({row:0,col:c});setREnd({row:sh.rowCount-1,col:c});}}
              onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,type:"col",index:c});}}>
              {c2l(c)}
              <div style={{position:"absolute",right:-2,top:0,bottom:0,width:5,cursor:"col-resize",zIndex:5}} onMouseDown={e=>{e.preventDefault();e.stopPropagation();setResz({type:"col",index:c,startX:e.clientX,startW:gCW(c)});}} onDoubleClick={e=>{e.stopPropagation();autoFitCol(c);}} />
            </div>))}
          </div>
        </div>
        {/* Frozen row indicator */}
        {frozenRow>0&&<div style={{position:"sticky",top:HDR_H,zIndex:19,display:"flex",background:C.fr,borderBottom:`2px solid ${C.ac}`}}>
          <div style={{width:RH_W,minWidth:RH_W,height:rPos[0]?.h||DROW_H,borderRight:`1px solid ${C.bd}`,position:"sticky",left:0,zIndex:30,background:C.fr,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,color:C.ac}}>1</div>
          <div style={{position:"relative",width:tW,height:rPos[0]?.h||DROW_H}}>{visC.map(c=>{const key=ck(0,c);const cd=gCD(key);const fmt=cd.format||{};return<div key={key} style={{position:"absolute",left:cPos[c].x,width:cPos[c].w,height:rPos[0]?.h||DROW_H,borderRight:`1px solid ${C.bl}`,background:fmt.fillColor||C.fr,overflow:"hidden"}}><div style={{padding:"0 5px",lineHeight:`${rPos[0]?.h||DROW_H}px`,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontWeight:fmt.bold?600:400,fontStyle:fmt.italic?"italic":"normal",color:fmt.textColor||C.tx,textAlign:fmt.align||(cd.type==="number"?"right":"left"),fontSize:13}}>{fmtVal(cd.value,fmt)}</div></div>;})}</div>
        </div>}

        <div style={{display:"flex"}}>
          {/* Row headers */}
          <div style={{position:"sticky",left:0,zIndex:15,width:RH_W,minWidth:RH_W,background:C.hb}}>
            <div style={{position:"relative",height:tH}}>{visR.filter(r=>!(frozenRow>0&&r<frozenRow)).map(r=>(
              <div key={r} style={{position:"absolute",top:rPos[r].y,height:rPos[r].h,width:RH_W,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:500,color:r>=sR.r1&&r<=sR.r2?C.ac:C.ht,background:r>=sR.r1&&r<=sR.r2?C.al:C.hb,borderRight:`1px solid ${C.bd}`,borderBottom:`1px solid ${C.bl}`,cursor:"default"}}
                onClick={()=>{setSel({row:r,col:0});setREnd({row:r,col:sh.colCount-1});}}
                onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,type:"row",index:r});}}>
                {r+1}
                <div style={{position:"absolute",left:0,right:0,bottom:-2,height:5,cursor:"row-resize",zIndex:5}} onMouseDown={e=>{e.preventDefault();setResz({type:"row",index:r,startY:e.clientY,startH:gRH(r)});}} />
              </div>))}</div>
          </div>
          {/* Cells */}
          <div style={{position:"relative",width:tW,height:tH}}>
            {visR.filter(r=>!(frozenRow>0&&r<frozenRow)).map(r=>visC.map(c=>{const key=ck(r,c);const cd=gCD(key);return<Cell key={key} r={r} c={c} x={cPos[c].x} y={rPos[r].y} w={cPos[c].w} h={rPos[r].h} cd={cd} isEd={ed?.row===r&&ed?.col===c} isSel={r===sel.row&&c===sel.col} inR={inR(r,c)} ev={edV} onEC={setEdV} onCm={v=>{commit(v);setSel(s=>({row:s.row+1,col:s.col}));}} onCn={()=>{setEd(null);setAcList([]);}} onMD={e=>{if(ed)commit(edV);if(e.shiftKey)setREnd({row:r,col:c});else{setSel({row:r,col:c});setREnd(null);setSelng(true);}}} onDC={()=>{setEd({row:r,col:c});setEdV(cd.raw||"");}} onCM={e=>{e.preventDefault();setSel({row:r,col:c});setCtx({x:e.clientX,y:e.clientY,type:"cell",row:r,col:c});}}/>;}))}
            {/* Selection */}
            {cPos[sel.col]&&rPos[sel.row]&&<div style={{position:"absolute",left:cPos[sel.col].x-1,top:rPos[sel.row].y-1,width:cPos[sel.col].w+1,height:rPos[sel.row].h+1,border:`2px solid ${C.ab}`,pointerEvents:"none",zIndex:10,boxSizing:"border-box"}} />}
            {rEnd&&<div style={{position:"absolute",left:cPos[sR.c1]?.x||0,top:rPos[sR.r1]?.y||0,width:(cPos[sR.c2]?cPos[sR.c2].x+cPos[sR.c2].w:0)-(cPos[sR.c1]?.x||0),height:(rPos[sR.r2]?rPos[sR.r2].y+rPos[sR.r2].h:0)-(rPos[sR.r1]?.y||0),border:`2px solid ${C.ab}`,background:`${C.ac}10`,pointerEvents:"none",zIndex:10,boxSizing:"border-box"}} />}
            {/* Fill handle */}
            {fillHandlePos&&!ed&&<div style={{position:"absolute",left:fillHandlePos.x,top:fillHandlePos.y,width:7,height:7,background:C.ab,border:"1px solid #fff",cursor:"crosshair",zIndex:12,borderRadius:1}} onMouseDown={e=>{e.preventDefault();e.stopPropagation();setFilling(true);setFillEnd(null);}} />}
            {/* Fill preview */}
            {filling&&fillEnd&&<div style={{position:"absolute",left:cPos[Math.min(sR.c1,fillEnd.col)]?.x||0,top:rPos[Math.min(sR.r1,fillEnd.row)]?.y||0,width:(cPos[Math.max(sR.c2,fillEnd.col)]?cPos[Math.max(sR.c2,fillEnd.col)].x+cPos[Math.max(sR.c2,fillEnd.col)].w:0)-(cPos[Math.min(sR.c1,fillEnd.col)]?.x||0),height:(rPos[Math.max(sR.r2,fillEnd.row)]?rPos[Math.max(sR.r2,fillEnd.row)].y+rPos[Math.max(sR.r2,fillEnd.row)].h:0)-(rPos[Math.min(sR.r1,fillEnd.row)]?.y||0),border:`2px dashed ${C.ac}`,pointerEvents:"none",zIndex:11,boxSizing:"border-box",background:`${C.ac}08`}} />}
            {/* Find highlights */}
            {fRes.map((fr,i)=>cPos[fr.col]&&rPos[fr.row]&&<div key={fr.key+i} style={{position:"absolute",left:cPos[fr.col].x,top:rPos[fr.row].y,width:cPos[fr.col].w,height:rPos[fr.row].h,background:i===fIdx?"rgba(249,171,0,0.35)":"rgba(249,171,0,0.15)",border:i===fIdx?`2px solid ${C.wr}`:"none",pointerEvents:"none",zIndex:9,boxSizing:"border-box"}} />)}
          </div>
        </div>
      </div>

      {/* Sheet tabs + Status */}
      <div style={{display:"flex",alignItems:"center",borderTop:`1px solid ${C.bd}`,background:C.sf,minHeight:30}}>
        <div style={{display:"flex",alignItems:"center",padding:"0 4px",gap:2,flex:"0 0 auto"}}>
          <button onClick={()=>{const ns=mkSh(`Sheet ${wb.sheets.length+1}`);setWb({...wb,sheets:[...wb.sheets,ns]});setAsi(wb.sheets.length);}} style={{border:"none",background:"none",cursor:"pointer",padding:"4px 8px",borderRadius:4,color:C.tm,fontSize:16,lineHeight:1}} title="Add Sheet">+</button>
          {wb.sheets.map((s,i)=>(
            <div key={s.id} onClick={()=>{setAsi(i);setSel({row:0,col:0});setREnd(null);}} onDoubleClick={()=>{setEdSN(i);setSnV(s.name);}} onContextMenu={e=>{e.preventDefault();setCtx({x:e.clientX,y:e.clientY,type:"sheet",index:i});}}
              style={{padding:"4px 14px",fontSize:12,fontWeight:i===asi?500:400,background:i===asi?C.ta:"transparent",color:i===asi?C.tx:C.tm,border:i===asi?`1px solid ${C.bd}`:"1px solid transparent",borderBottom:i===asi?`1px solid ${C.ta}`:"1px solid transparent",borderRadius:"6px 6px 0 0",cursor:"pointer",marginTop:2,position:"relative",top:1}}>
              {edSN===i?<input autoFocus value={snV} onChange={e=>setSnV(e.target.value)} onBlur={()=>{const sh=[...wb.sheets];sh[i]={...sh[i],name:snV||sh[i].name};setWb({...wb,sheets:sh});setEdSN(null);}} onKeyDown={e=>{if(e.key==="Enter")e.target.blur();if(e.key==="Escape")setEdSN(null);e.stopPropagation();}} style={{border:"none",outline:"none",background:"transparent",fontSize:12,fontFamily:F,width:80,textAlign:"center",color:C.tx}} />:s.name}
            </div>))}
        </div>
        <div style={{flex:1}} />
        <div style={{padding:"0 12px",fontSize:11,color:C.tm,fontFamily:M,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{statusInfo}</div>
      </div>

      {/* Context menu */}
      {ctx&&<div style={{position:"fixed",left:ctx.x,top:ctx.y,background:C.bg,border:`1px solid ${C.bd}`,borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:1000,padding:"4px 0",minWidth:200,fontFamily:F,fontSize:13}} onClick={e=>e.stopPropagation()}>
        {ctx.type==="cell"&&<><MI onClick={()=>{insRow(ctx.row);setCtx(null);}}>Insert row above</MI><MI onClick={()=>{insRow(ctx.row+1);setCtx(null);}}>Insert row below</MI><MI onClick={()=>{insCol(ctx.col);setCtx(null);}}>Insert column left</MI><MI onClick={()=>{insCol(ctx.col+1);setCtx(null);}}>Insert column right</MI><div style={{height:1,background:C.bl,margin:"4px 8px"}} /><MI onClick={()=>{delRow(ctx.row);setCtx(null);}}>Delete row</MI><MI onClick={()=>{delCol(ctx.col);setCtx(null);}}>Delete column</MI><div style={{height:1,background:C.bl,margin:"4px 8px"}} /><MI onClick={()=>sortR(sel.col,true)}>Sort ascending</MI><MI onClick={()=>sortR(sel.col,false)}>Sort descending</MI></>}
        {ctx.type==="row"&&<><MI onClick={()=>{insRow(ctx.index);setCtx(null);}}>Insert row above</MI><MI onClick={()=>{insRow(ctx.index+1);setCtx(null);}}>Insert row below</MI><MI onClick={()=>{delRow(ctx.index);setCtx(null);}}>Delete row</MI></>}
        {ctx.type==="col"&&<><MI onClick={()=>{insCol(ctx.index);setCtx(null);}}>Insert column left</MI><MI onClick={()=>{insCol(ctx.index+1);setCtx(null);}}>Insert column right</MI><MI onClick={()=>{delCol(ctx.index);setCtx(null);}}>Delete column</MI><div style={{height:1,background:C.bl,margin:"4px 8px"}} /><MI onClick={()=>{autoFitCol(ctx.index);setCtx(null);}}>Auto-fit width</MI><MI onClick={()=>sortR(ctx.index,true)}>Sort ascending</MI><MI onClick={()=>sortR(ctx.index,false)}>Sort descending</MI></>}
        {ctx.type==="sheet"&&<><MI onClick={()=>{setEdSN(ctx.index);setSnV(wb.sheets[ctx.index].name);setCtx(null);}}>Rename</MI><MI onClick={()=>{const ns={...JSON.parse(JSON.stringify(wb.sheets[ctx.index])),id:Date.now().toString(36),name:wb.sheets[ctx.index].name+" (copy)"};const sh=[...wb.sheets];sh.splice(ctx.index+1,0,ns);setWb({...wb,sheets:sh});setCtx(null);}}>Duplicate</MI>{wb.sheets.length>1&&<MI onClick={()=>{const sh=wb.sheets.filter((_,i)=>i!==ctx.index);setWb({...wb,sheets:sh});if(asi>=sh.length)setAsi(sh.length-1);setCtx(null);}} danger>Delete</MI>}</>}
      </div>}

      {/* Keyboard shortcuts panel */}
      {showKB&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.3)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowKB(false)}>
        <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:12,boxShadow:"0 8px 32px rgba(0,0,0,0.18)",padding:"24px 28px",maxWidth:480,width:"90%",maxHeight:"80vh",overflow:"auto",fontFamily:F}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}><h3 style={{margin:0,fontSize:16,fontWeight:600}}>Keyboard Shortcuts</h3><button onClick={()=>setShowKB(false)} style={{border:"none",background:"none",fontSize:20,cursor:"pointer",color:C.tm}}>×</button></div>
          {[["Navigation",""],["Arrow keys","Move selection"],["Tab / Shift+Tab","Move right / left"],["Enter","Move down / confirm edit"],["Home / End","Start / end of row"],["Ctrl+Home / End","Go to A1 / last cell"],["",""],["Editing",""],["F2 / typing","Enter edit mode"],["Escape","Cancel edit"],["Delete","Clear cells"],["",""],["Formatting",""],["Ctrl+B","Bold"],["Ctrl+I","Italic"],["",""],["Actions",""],["Ctrl+Z / Ctrl+Y","Undo / redo"],["Ctrl+C / Ctrl+V","Copy / paste"],["Ctrl+A","Select all"],["Ctrl+F","Find & replace"],["Ctrl+/","This panel"],["",""],["Mouse",""],["Drag fill handle","Autofill cells"],["Double-click col edge","Auto-fit column"],["Click row/col header","Select row/column"],["Click top-left corner","Select all"]].map(([k,v],i)=>k===""&&v===""?<div key={i} style={{height:8}} />:v===""?<div key={i} style={{fontSize:12,fontWeight:600,color:C.ac,marginTop:8,marginBottom:4}}>{k}</div>:<div key={i} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",fontSize:13}}><span style={{fontFamily:M,fontSize:12,color:C.tm,background:C.sf,padding:"1px 6px",borderRadius:3}}>{k}</span><span style={{color:C.tx}}>{v}</span></div>)}
        </div>
      </div>}
    </div>);
}