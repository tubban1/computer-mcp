import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync,sign} from "node:crypto";
import {InProcessRuntimeClient} from "../src/public/runtimeClient.js";
import {bindOfficialTestPorts,officialUploadPilot,inspectOfficialPilot} from "../src/providers/publishOfficialProvider.js";
import {readApproval} from "../src/policy/approvalPolicy.js";
import {humanApprovalMessage} from "../src/policy/humanApprovalProof.js";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-m7-"));
const env={OWL_RUNTIME_MODE:"test",OWL_STATE_ROOT:path.join(root,"state"),ALLOWED_DIRECTORIES:root,
 TASK_DIR:path.join(root,"tasks"),TASK_KEY_PATH:path.join(root,"task.key"),
 TASK_STAGING_DIR:path.join(root,"staging"),TASK_STAGING_EXPOSE_TO_FS:"true",
 EPISODIC_INDEX_DIR:path.join(root,"episodes"),EPISODIC_INDEX_KEY_PATH:path.join(root,"episodes.key"),
 SEMANTIC_MEMORY_DIR:path.join(root,"semantic"),SEMANTIC_MEMORY_KEY_PATH:path.join(root,"semantic.key"),
 OWL_APPROVAL_MODE:"enforce",OWL_HUMAN_APPROVAL_ENFORCE:"1",OWL_OFFICIAL_PILOT_TEST:"1"};
for(const [k,v] of Object.entries(env))process.env[k]=v;
const sha=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");
const bytes=Buffer.from("test fixture no real video"),file=path.join(root,"sample.mp4");
await fs.writeFile(file,bytes);
const pair=generateKeyPairSync("ed25519");
process.env.OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64=pair.publicKey.export({format:"der",type:"spki"}).toString("base64");
const sig=async(id:string)=>sign(null,Buffer.from(humanApprovalMessage(await readApproval(id))),pair.privateKey).toString("base64");
const intent={platform:"youtube" as const,brandId:"island",accountId:"owner-yt",targetId:"channel-test",
 effectKey:sha("youtube-1"),mediaPath:file,mediaSha256:sha(bytes),revisionDigest:sha("rev"),
 captionSha256:sha("No public post"),title:"Private test",caption:"No public post",
 visibility:"private" as const,humanContentApproved:true as const,policyMode:"FREE_LEGAL_ONLY" as const,
 maxIncrementalApiCostUsdCents:0 as const};
const ig={...intent,platform:"instagram" as const,brandId:"flower",accountId:"owner-ig",
 targetId:"ig-test",effectKey:sha("instagram-1"),visibility:"public" as const};
const calls:string[]=[];
const ports={
 request:async(r:{method:string;url:string;headers:Record<string,string>})=>{
  const u=new URL(r.url);calls.push(r.method+" "+u.hostname+u.pathname);
  if(u.hostname==="www.googleapis.com"&&r.method==="POST"){
   assert.ok(["video/mp4","video/quicktime"].includes(r.headers["X-Upload-Content-Type"]));
   return {status:200,headers:{location:"https://www.googleapis.com/upload/youtube/v3/videos?upload_id=x"}};}
  if(u.searchParams.get("upload_id")==="x"&&r.method==="PUT")return {status:200,json:{id:"video_1"}};
  if(u.hostname==="www.googleapis.com"&&r.method==="GET")
   return {status:200,json:{items:[{id:"video_1",snippet:{channelId:"channel-test"},status:{privacyStatus:"private"}}]}};
  if(u.pathname.endsWith("/media")&&r.method==="POST")
   return {status:200,json:{id:"ig_1",uri:"https://rupload.facebook.com/ig-api-upload/v24.0/ig_1"}};
  if(u.hostname==="rupload.facebook.com")return {status:200,json:{success:true}};
  if(u.hostname==="graph.facebook.com"&&r.method==="GET")
   return {status:200,json:{status_code:"FINISHED"}};
  throw Error("UNEXPECTED_REQUEST:"+r.url);
 },
 token:async(platform:"youtube"|"instagram",accountId:string)=>({accountId,ownerTargetId:platform==="youtube"?"channel-test":"ig-test",accessToken:"fake-token-123456",
  scopes:platform==="youtube"?["https://www.googleapis.com/auth/youtube.upload"]:["instagram_content_publish"]}),
 budget:async()=>({approved:true,remainingUsdCents:100}),
};
try{
 bindOfficialTestPorts(ports);
 const client=new InProcessRuntimeClient();
 const run=async(args:typeof intent|typeof ig)=>{
  const t=await client.createTask({label:"M7 offline official protocol "+args.platform,
   steps:[{id:"official",action:"publish.official_upload_test",args}]});
  assert.equal((await client.runTask({taskId:t.id,expectedRevisionDigest:t.executionRevision.digest})).status,"waiting_approval");
  const a=(await client.listApprovals("pending")).find(x=>x.ownerTaskId===t.id);assert.ok(a);
  assert.equal(a.review?.complete,true);
  await assert.rejects(()=>client.approve(a.id,true),/HUMAN_APPROVAL_PROOF/);
  assert.equal((await client.approve(a.id,true,await sig(a.id))).resume.result.status,"completed");
 };
 await run(intent);
 assert.equal((await inspectOfficialPilot(intent.effectKey)).record?.stage,"VERIFIED");
 const movFile=path.join(root,"pilot.mov");
 await fs.copyFile(file,movFile);
 await run({...intent,mediaPath:movFile,effectKey:sha("youtube-mov")});
 assert.equal((await inspectOfficialPilot(sha("youtube-mov"))).record?.stage,"VERIFIED");
 const count=calls.length;assert.equal((await officialUploadPilot(intent)).replayed,true);
 assert.equal(count,calls.length);
 await assert.rejects(()=>officialUploadPilot({...intent,visibility:"public",effectKey:sha("public")}),/PRIVATE_ONLY/);
 await assert.rejects(()=>officialUploadPilot({...intent,title:"different"}),/PUBLISH_EFFECT_CONFLICT/);
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("caption-changed"),caption:"different"}),/PUBLISH_CAPTION_DIGEST_MISMATCH/);
 await run(ig);
 assert.equal((await inspectOfficialPilot(ig.effectKey)).record?.stage,"READY_TO_PUBLISH");
 assert.ok(!calls.some(s=>s.includes("media_publish")));
 bindOfficialTestPorts({...ports,request:async()=>({status:200,json:{id:"bad",uri:"https://attacker.example/evil"}})});
 await assert.rejects(()=>officialUploadPilot({...ig,effectKey:sha("ssrf")}),/PUBLISH_URL_DENIED/);
 assert.equal((await inspectOfficialPilot(sha("ssrf"))).record?.stage,"UNCERTAIN");
 bindOfficialTestPorts({...ports,budget:async()=>({approved:false,remainingUsdCents:0})});
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("budget-denied")}),/PUBLISH_BUDGET_DENIED/);
 assert.equal((await inspectOfficialPilot(sha("budget-denied"))).record,null);
 bindOfficialTestPorts({...ports,token:async()=>({accountId:"different",accessToken:"fake-test-only",
  ownerTargetId:"channel-test",scopes:["https://www.googleapis.com/auth/youtube.upload"]})});
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("wrong-account")}),/OAUTH_SCOPE_OR_ACCOUNT_DENIED/);
 bindOfficialTestPorts({...ports,token:async(platform,accountId)=>({
  accountId,ownerTargetId:"wrong-channel",accessToken:"fake-test-only",
  scopes:platform==="youtube"?["https://www.googleapis.com/auth/youtube.upload"]:["instagram_content_publish"],
 })});
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("wrong-target")}),/OAUTH_SCOPE_OR_ACCOUNT_DENIED/);
 bindOfficialTestPorts({...ports,request:async r=>{
  if(r.method==="GET"&&r.url.includes("youtube/v3/videos"))return {status:200,json:{items:[{
   id:"video_1",snippet:{channelId:"wrong-channel"},status:{privacyStatus:"private"}}]}};
  return ports.request(r);
 }});
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("wrong-readback")}),/PUBLISH_PRIVACY_OR_CHANNEL_NOT_VERIFIED/);
 bindOfficialTestPorts({...ports,request:async r=>{
  if(r.method==="GET"&&r.url.includes("youtube/v3/videos"))return {status:200,json:{items:[{status:{privacyStatus:"public"}}]}};
  return ports.request(r);
 }});
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("wrong-privacy")}),/PUBLISH_PRIVACY_OR_CHANNEL_NOT_VERIFIED/);
 assert.equal((await inspectOfficialPilot(sha("wrong-privacy"))).record?.stage,"UNCERTAIN");
 bindOfficialTestPorts(null);
 await assert.rejects(()=>officialUploadPilot({...intent,effectKey:sha("unbound")}),/PORT_UNCONNECTED/);
 console.log(JSON.stringify({ok:true,ytPrivateVerified:true,igReadyNotPublished:true,
  noDuplicate:true,ssrfBlocked:true,realRuntimeApproval:true,network:false,httpCalls:count},null,2));
}finally{bindOfficialTestPorts(null);await fs.rm(root,{recursive:true,force:true});}
