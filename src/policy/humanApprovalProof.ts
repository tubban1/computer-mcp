import {createPublicKey,createHash,verify} from "node:crypto";
import type {ApprovalRecord} from "./approvalPolicy.js";

export const humanApprovalEnforced=()=>process.env.OWL_HUMAN_APPROVAL_ENFORCE==="1"||process.env.OWL_SCOPED_CAPABILITIES==="1";
export function humanApprovalMessage(r:ApprovalRecord){
 return JSON.stringify({domain:"OWL_HUMAN_APPROVAL_V1",id:r.id,fingerprint:r.fingerprint,
  subjectType:r.subjectType,subject:r.subject,session:r.ownerSessionId,
  task:r.ownerTaskId??null,step:r.ownerStepId??null,expiresAt:r.expiresAt});
}
export function verifyHumanApprovalSignature(r:ApprovalRecord,sig:unknown){
 if(typeof sig!=="string"||!/^[A-Za-z0-9+/]{84,88}={0,2}$/.test(sig))return false;
 const b64=process.env.OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64;
 if(!b64)return false;
 try{
  const key=createPublicKey({key:Buffer.from(b64,"base64"),format:"der",type:"spki"});
  return key.asymmetricKeyType==="ed25519"&&verify(null,
   Buffer.from(humanApprovalMessage(r),"utf8"),key,Buffer.from(sig,"base64"));
 }catch{return false;}
}
export function approvalSafeReview(subject:string,value:unknown){
 const args=(value&&typeof value==="object"&&!Array.isArray(value)?value:{}) as Record<string,unknown>;
 const allow=subject==="git.push"?["cwd","remote","branch"]:
  subject==="fs.delete"?["path","cwd","recursive"]:
  subject==="tx.rollback"?["id","transactionId"]:
  subject==="publish.official_upload_test"?
   ["platform","brandId","accountId","targetId","effectKey","mediaPath","mediaSha256",
    "revisionDigest","captionSha256","title","caption","visibility","humanContentApproved",
    "policyMode","maxIncrementalApiCostUsdCents"]:
  subject==="publish.mock_effect"?
   ["brandId","accountId","platform","targetId","visibility","revisionDigest","mediaSha256","effectKey","captionSha256","humanContentApproved","maxIncrementalApiCostUsdCents","policyMode"]:
  ["cwd","workspace_mode"];
 const fields:Record<string,string|number|boolean>={};
 let previewTruncated=false;
 for(const k of allow){
  const v=args[k];
  if(typeof v==="string"){
   if(v.length>220 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)){
    previewTruncated=true;
    fields[k]=v.slice(0,220);
   }else fields[k]=v;
  }else if(typeof v==="number"&&Number.isFinite(v)||typeof v==="boolean")
   fields[k]=v;
  else if(v!==undefined)previewTruncated=true;
 }
 if(subject.startsWith("shell.")&&typeof args.command==="string"){
  fields.commandSha256=createHash("sha256").update(args.command).digest("hex");
  fields.commandLength=args.command.length;
 }
 return {fields,redactedFields:Object.keys(args).filter(k=>!allow.includes(k)),
  complete:!previewTruncated&&Object.keys(args).every(k=>allow.includes(k))};
}
