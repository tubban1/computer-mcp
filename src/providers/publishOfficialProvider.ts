/** M7 real official request shape; test-only injected ports, never live connections. */
import fs from "node:fs/promises";
import {createHash,randomUUID} from "node:crypto";
import path from "node:path";
import {assertAllowedExistingPath} from "../security/pathGuard.js";
import {runtimeMode,runtimeStatePath} from "../runtime/runtimePaths.js";

export type OfficialIntent={
 platform:"youtube"|"instagram";brandId:string;accountId:string;targetId:string;
 effectKey:string;mediaPath:string;mediaSha256:string;revisionDigest:string;captionSha256:string;
 title:string;caption:string;visibility:"private"|"public";
 humanContentApproved:true;policyMode:"FREE_LEGAL_ONLY";maxIncrementalApiCostUsdCents:0;
};
type Request={method:"POST"|"PUT"|"GET";url:string;headers:Record<string,string>;body?:string|Uint8Array};
type Response={status:number;headers?:Record<string,string>;json?:unknown};
export type OfficialPorts={
 request:(request:Request)=>Promise<Response>;
 token:(platform:OfficialIntent["platform"],accountId:string)=>Promise<{accessToken:string;accountId:string;scopes:string[]}>;
 budget:(brandId:string,yyyyMm:string,cents:0)=>Promise<{approved:boolean;remainingUsdCents:number}>;
};
type Stage="BEGIN_REQUESTED"|"SESSION"|"UPLOAD_REQUESTED"|"PROCESSING"|"READY_TO_PUBLISH"|"VERIFIED"|"UNCERTAIN";
type Journal={kind:"OFFICIAL_PROTOCOL_TEST";digest:string;platform:string;stage:Stage;remoteId?:string;session?:string;reason?:string};
const hex=/^[a-f0-9]{64}$/;const id=/^[a-zA-Z0-9_.-]{1,100}$/;
const unsafe=(value:unknown)=>!value||typeof value!=="object"||Array.isArray(value);
const record=(key:string)=>{if(!hex.test(key))throw Error("PUBLISH_EFFECT_KEY_INVALID");return path.join(runtimeStatePath("publish-official-test"),key+".json");};
function https(raw:string,hosts:string[]){
 let uri:URL;try{uri=new URL(raw);}catch{throw Error("PUBLISH_URL_INVALID");}
 if(uri.protocol!=="https:"||!hosts.includes(uri.hostname)||uri.username||uri.password||uri.port||uri.hash||raw.length>4096)
  throw Error("PUBLISH_URL_DENIED");
 return uri.toString();
}
function body(r:Response):Record<string,any>{
 if(r.status<200||r.status>=300||unsafe(r.json))throw Error("PUBLISH_HTTP_"+r.status);
 return r.json as Record<string,any>;
}
function remoteId(value:unknown){
 if(typeof value!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))throw Error("PUBLISH_REMOTE_ID_INVALID");
 return value;
}
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value && typeof value==="object")
  return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
   .map(([k,v])=>[k,canonical(v)]));
 return value;
}
function digest(value:unknown){return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");}
let testPorts:OfficialPorts|null=null;
export function officialPilotCapability(){
 return {id:"publish-official-test",enabled:runtimeMode()==="test"&&process.env.OWL_OFFICIAL_PILOT_TEST==="1"&&!!testPorts,
  productionEnabled:false,liveConnected:false,platforms:["youtube","instagram"]};
}
export function bindOfficialTestPorts(ports:OfficialPorts|null){
 if(runtimeMode()!=="test"||process.env.OWL_OFFICIAL_PILOT_TEST!=="1")throw Error("PUBLISH_PORT_INJECTION_DENIED");
 testPorts=ports;
}
async function read(key:string):Promise<Journal|null>{
 try{
  const target=record(key),st=await fs.lstat(target);
  if(!st.isFile()||st.isSymbolicLink())throw Error("PUBLISH_JOURNAL_UNSAFE");
  return JSON.parse(await fs.readFile(target,"utf8")) as Journal;
 }
 catch(e){if((e as NodeJS.ErrnoException).code==="ENOENT")return null;throw e;}
}
async function write(key:string,value:Journal,first=false){
 const file=record(key);await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const tmp=file+"."+randomUUID()+".tmp";
 const handle=await fs.open(tmp,"wx",0o600);
 try{await handle.writeFile(JSON.stringify(value)+"\n");await handle.sync();}
 finally{await handle.close();}
 try{if(first)await fs.link(tmp,file);else await fs.rename(tmp,file);}
 finally{await fs.rm(tmp,{force:true});}
 const dir=await fs.open(path.dirname(file),"r");
 try{await dir.sync();}finally{await dir.close();}
}
async function http(ports:OfficialPorts,req:Request,hosts:string[]){
 return ports.request({...req,url:https(req.url,hosts)});
}
function validate(intent:OfficialIntent){
 if(![intent.brandId,intent.accountId,intent.targetId].every(v=>id.test(v))||
    ![intent.effectKey,intent.mediaSha256,intent.revisionDigest,intent.captionSha256].every(v=>hex.test(v)))
  throw Error("PUBLISH_IDENTITY_INVALID");
 if(intent.humanContentApproved!==true||intent.policyMode!=="FREE_LEGAL_ONLY"||
    intent.maxIncrementalApiCostUsdCents!==0)throw Error("PUBLISH_COST_POLICY_DENIED");
 if(intent.title.length>100||intent.caption.length>2200)throw Error("PUBLISH_TEXT_INVALID");
 if(intent.platform==="youtube"&&intent.visibility!=="private")throw Error("PUBLISH_YOUTUBE_PILOT_PRIVATE_ONLY");
 if(intent.platform==="instagram"&&intent.visibility!=="public")throw Error("PUBLISH_IG_REQUIRES_PUBLIC_INTENT");
}
async function media(intent:OfficialIntent){
 const file=await assertAllowedExistingPath(intent.mediaPath),st=await fs.lstat(file);
 const allowedFormat=intent.platform==="youtube"?/\.(mov|mp4)$/i.test(file):/\.mp4$/i.test(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size<1||st.size>64*1024*1024||!allowedFormat)
  throw Error("PUBLISH_MEDIA_UNSAFE_FOR_M7_PILOT");
 const bytes=await fs.readFile(file);
 if(createHash("sha256").update(bytes).digest("hex")!==intent.mediaSha256)throw Error("PUBLISH_MEDIA_DIGEST_MISMATCH");
 return bytes;
}
export async function officialUploadPilot(intent:OfficialIntent){
 validate(intent);
 if(!officialPilotCapability().enabled||!testPorts)throw Error("PUBLISH_OFFICIAL_PORT_UNCONNECTED");
 const ports=testPorts,fp=digest(intent),old=await read(intent.effectKey);
 if(old){if(old.digest!==fp)throw Error("PUBLISH_EFFECT_CONFLICT");return {...old,replayed:true,needsAttention:old.stage!=="VERIFIED"};}
 const bytes=await media(intent);
 const b=await ports.budget(intent.brandId,new Date().toISOString().slice(0,7),0);
 if(!b.approved||b.remainingUsdCents<0||b.remainingUsdCents>100)throw Error("PUBLISH_BUDGET_DENIED");
 const identity=await ports.token(intent.platform,intent.accountId);
 const scope=intent.platform==="youtube"?"https://www.googleapis.com/auth/youtube.upload":"instagram_content_publish";
 if(identity.accountId!==intent.accountId||identity.accessToken.length<6||
   !identity.scopes.includes(scope))
  throw Error("PUBLISH_OAUTH_SCOPE_OR_ACCOUNT_DENIED");
 let j:Journal={kind:"OFFICIAL_PROTOCOL_TEST",digest:fp,platform:intent.platform,stage:"BEGIN_REQUESTED"};
 await write(intent.effectKey,j,true);
 const advance=async(stage:Stage,extra:Partial<Journal>={})=>{j={...j,...extra,stage};await write(intent.effectKey,j);};
 const bearer={Authorization:"Bearer "+identity.accessToken};
 const mime=intent.mediaPath.toLowerCase().endsWith(".mov")?"video/quicktime":"video/mp4";
 try{
  if(intent.platform==="youtube"){
   const start=await http(ports,{method:"POST",
     url:"https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
     headers:{...bearer,"Content-Type":"application/json; charset=UTF-8","X-Upload-Content-Length":String(bytes.length),"X-Upload-Content-Type":mime},
     body:JSON.stringify({snippet:{title:intent.title,description:intent.caption},
       status:{privacyStatus:"private",selfDeclaredMadeForKids:false}})},["www.googleapis.com"]);
   if(start.status!==200&&start.status!==201)throw Error("PUBLISH_YT_START_"+start.status);
   const uri=https(Object.entries(start.headers??{}).find(([k])=>k.toLowerCase()==="location")?.[1]??"",["www.googleapis.com"]);
   await advance("SESSION",{session:uri});await advance("UPLOAD_REQUESTED");
   const complete=await http(ports,{method:"PUT",url:uri,headers:{...bearer,
     "Content-Type":mime,"Content-Length":String(bytes.length),
     "Content-Range":"bytes 0-"+(bytes.length-1)+"/"+bytes.length},body:bytes},["www.googleapis.com"]);
   if(complete.status===308){await advance("UNCERTAIN",{reason:"YOUTUBE_308_NEEDS_RANGE_RECOVERY"});return {...j,needsAttention:true};}
   const video=remoteId(body(complete).id);
   await advance("PROCESSING",{remoteId:video});
   const result=body(await http(ports,{method:"GET",url:"https://www.googleapis.com/youtube/v3/videos?part=status&id="+video,headers:bearer},["www.googleapis.com"]));
   if(!Array.isArray(result.items)||result.items[0]?.status?.privacyStatus!=="private")throw Error("PUBLISH_PRIVACY_NOT_VERIFIED");
   await advance("VERIFIED",{reason:"PRIVATE_VERIFIED"});return {...j,needsAttention:false};
  }
  const v="v24.0";
  const q=new URLSearchParams({media_type:"REELS",upload_type:"resumable",caption:intent.caption});
  const created=body(await http(ports,{method:"POST",url:"https://graph.facebook.com/"+v+"/"+intent.targetId+"/media",
    headers:{...bearer,"Content-Type":"application/x-www-form-urlencoded"},body:q.toString()},["graph.facebook.com"]));
  const container=remoteId(created.id),uri=https(String(created.uri??""),["rupload.facebook.com"]);
  await advance("SESSION",{session:uri,remoteId:container});await advance("UPLOAD_REQUESTED");
  body(await http(ports,{method:"POST",url:uri,headers:{Authorization:"OAuth "+identity.accessToken,
    offset:"0",file_size:String(bytes.length),"Content-Type":"application/octet-stream"},body:bytes},["rupload.facebook.com"]));
  await advance("PROCESSING");
  const status=body(await http(ports,{method:"GET",url:"https://graph.facebook.com/"+v+"/"+container+"?fields=status_code",
    headers:bearer},["graph.facebook.com"])).status_code;
  if(status==="FINISHED")await advance("READY_TO_PUBLISH",{reason:"PUBLISH_SEPARATE_APPROVAL_REQUIRED"});
  return {...j,needsAttention:true}; // NEVER calls media_publish in upload stage.
 }catch(e){await advance("UNCERTAIN",{reason:String(e instanceof Error?e.message:e).slice(0,80)});throw e;}
}
export async function inspectOfficialPilot(effectKey:string){
 return {record:await read(effectKey),testOnly:true,published:false};
}
