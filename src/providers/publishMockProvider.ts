/** M5 LOCAL OFFLINE ONLY. No HTTP/OAuth/Browser/upload. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runtimeMode, runtimeStatePath } from "../runtime/runtimePaths.js";

export type PublishMockInput = {
  brandId:string; accountId:string; platform:"youtube"|"instagram";
  targetId:string; effectKey:string; revisionDigest:string;
  mediaSha256:string; captionSha256:string; visibility:"private"|"public";
  maxIncrementalApiCostUsdCents:0; humanContentApproved:boolean;
  policyMode:"FREE_LEGAL_ONLY";
};
const hex=/^[0-9a-f]{64}$/;
const slug=/^[A-Za-z0-9_.-]{1,100}$/;
export function publishMockCapability(){
 const available=runtimeMode()==="test";
 return {id:"publish-mock",version:1,enabled:available &&
   process.env.OWL_PUBLISH_MOCK_ENABLED==="1" &&
   process.env.OWL_APPROVAL_MODE==="enforce",
   available,transport:"none",livePublishingEnabled:false,
   actions:["publish.mock_effect","publish.mock_inspect"]};
}
function requireMock(){
 if(!publishMockCapability().enabled)
  throw new Error("PUBLISH_MOCK_DISABLED: test mode + feature gate + enforced approval required");
}
export function validatePublishMock(input:PublishMockInput){
 if(![input.brandId,input.accountId,input.targetId].every(s=>slug.test(s)))
   throw new Error("PUBLISH_INVALID_ID");
 if(![input.effectKey,input.revisionDigest,input.mediaSha256,input.captionSha256]
   .every(v=>hex.test(v)))throw new Error("PUBLISH_INVALID_DIGEST");
 if(input.humanContentApproved!==true||input.policyMode!=="FREE_LEGAL_ONLY"||
   input.maxIncrementalApiCostUsdCents!==0)
   throw new Error("PUBLISH_CONTENT_OR_COST_POLICY_DENIED");
 if(!["youtube","instagram"].includes(input.platform))
   throw new Error("PUBLISH_PLATFORM_DENIED");
 if(!["private","public"].includes(input.visibility))
   throw new Error("PUBLISH_VISIBILITY_INVALID");
 return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
function receiptPath(key:string){
 if(!hex.test(key))throw new Error("PUBLISH_INVALID_EFFECT_ID");
 return path.join(runtimeStatePath("publish-mock"),key+".json");
}
type Receipt={kind:"MOCK_ONLY";effectKey:string;intentDigest:string;brandId:string;accountId:string;
 platform:string;targetId:string;visibility:string;status:"MOCK_NOT_PUBLIC";
 livePublishingEnabled:false;attempts:1};
export async function mockPublishEffect(input:PublishMockInput){
 requireMock();
 const fingerprint=validatePublishMock(input);
 const file=receiptPath(input.effectKey);
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const receipt:Receipt={kind:"MOCK_ONLY",effectKey:input.effectKey,intentDigest:fingerprint,
  brandId:input.brandId,accountId:input.accountId,platform:input.platform,
  targetId:input.targetId,visibility:input.visibility,status:"MOCK_NOT_PUBLIC",
  livePublishingEnabled:false,attempts:1};
 const temp=file+"."+randomUUID()+".tmp";
 try{
  const fd=await fs.open(temp,"wx",0o600);
  try{
   await fd.writeFile(JSON.stringify(receipt)+"\n","utf8");
   await fd.sync();
  }finally{
   await fd.close();
  }
  try{
   // Atomic create-if-absent. Concurrent readers cannot see partial JSON.
   await fs.link(temp,file);
   return {...receipt,replayed:false};
  }catch(error){
   if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
   const stat=await fs.lstat(file);
   if(!stat.isFile()||stat.isSymbolicLink())
    throw new Error("PUBLISH_RECEIPT_UNSAFE_FILE");
   const existing=JSON.parse(await fs.readFile(file,"utf8")) as Receipt;
   if(existing.kind!=="MOCK_ONLY"||existing.livePublishingEnabled!==false||
     existing.intentDigest!==fingerprint)throw new Error("PUBLISH_EFFECT_REPLAY_CONFLICT");
   return {...existing,replayed:true};
  }
 }finally{
  await fs.rm(temp,{force:true});
 }
}

export async function inspectMockPublish(effectKey:string){
 requireMock();
 try{
  const receipt=JSON.parse(await fs.readFile(receiptPath(effectKey),"utf8")) as Receipt;
  if(receipt.kind!=="MOCK_ONLY"||receipt.effectKey!==effectKey||receipt.livePublishingEnabled!==false)
   throw new Error("PUBLISH_RECEIPT_TAMPERED");
  return {found:true,receipt,livePublishingEnabled:false};
 }catch(e){
  if((e as NodeJS.ErrnoException).code==="ENOENT")
    return {found:false,receipt:null,livePublishingEnabled:false};
  throw e;
 }
}
