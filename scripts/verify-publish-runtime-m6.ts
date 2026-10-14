import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {humanApprovalMessage} from "../src/policy/humanApprovalProof.js";
import {readApproval} from "../src/policy/approvalPolicy.js";
import {requireCapability} from "../src/security/capabilities.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { InProcessRuntimeClient } from "../src/public/runtimeClient.js";
import { mockPublishEffect,publishMockCapability,inspectMockPublish } from "../src/providers/publishMockProvider.js";
import { getRouterCatalog,validateRoutedAction } from "../src/router/actionRouter.js";

const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-publish-m5-"));
process.env.OWL_RUNTIME_MODE="test";
process.env.OWL_STATE_ROOT=path.join(root,"state");
process.env.OWL_PUBLISH_MOCK_ENABLED="1";
process.env.OWL_APPROVAL_MODE="enforce";
process.env.OWL_HUMAN_APPROVAL_ENFORCE="1";
process.env.OWL_SCOPED_CAPABILITIES="1";
process.env.OWL_SCOPED_ACTION_ALLOWLIST="fs.delete";
const {privateKey,publicKey}=generateKeyPairSync("ed25519");
process.env.OWL_HUMAN_APPROVAL_PUBLIC_KEY_B64=publicKey.export({format:"der",type:"spki"}).toString("base64");
const signedApproval=async (id:string)=>sign(null,
 Buffer.from(humanApprovalMessage(await readApproval(id))),privateKey).toString("base64");

process.env.ALLOWED_DIRECTORIES=root;
process.env.TASK_DIR=path.join(root,"tasks");
process.env.TASK_KEY_PATH=path.join(root,"task.key");
process.env.TASK_STAGING_DIR=path.join(root,"staging");
process.env.TASK_STAGING_EXPOSE_TO_FS="true";
process.env.EPISODIC_INDEX_DIR=path.join(root,"episodes");
process.env.EPISODIC_INDEX_KEY_PATH=path.join(root,"episodes.key");
process.env.SEMANTIC_MEMORY_DIR=path.join(root,"semantic");
process.env.SEMANTIC_MEMORY_KEY_PATH=path.join(root,"semantic.key");

const args={
 brandId:"island",accountId:"youtube-qa",platform:"youtube" as const,
 targetId:"pilot-test",effectKey:"a".repeat(64),revisionDigest:"b".repeat(64),
 mediaSha256:"c".repeat(64),captionSha256:"d".repeat(64),
 visibility:"private" as const,maxIncrementalApiCostUsdCents:0 as const,
 humanContentApproved:true as const,policyMode:"FREE_LEGAL_ONLY" as const,
};
try {
 assert.equal(publishMockCapability().enabled,true);
 const c=getRouterCatalog().find(x=>x.action==="publish.mock_effect");
 assert.ok(c && c.provider==="publish-mock");
 assert.deepEqual(c.contract.sideEffects,["mock_receipt_local_write"]);
 assert.throws(()=>validateRoutedAction("publish.mock_effect",{...args,unexpected:"field"}));
 assert.throws(()=>validateRoutedAction("publish.mock_effect",{...args,maxIncrementalApiCostUsdCents:1}));
 const client=new InProcessRuntimeClient();
 const t=await client.createTask({label:"Publish M5 mock action",
  steps:[{id:"mock",action:"publish.mock_effect",args},
         {id:"inspect",action:"publish.mock_inspect",args:{effectKey:args.effectKey},dependsOn:["mock"]}]});
 const first=await client.runTask({taskId:t.id,expectedRevisionDigest:t.executionRevision.digest});
 assert.equal(first.status,"waiting_approval");
 assert.equal((await inspectMockPublish(args.effectKey)).found,false);
 const approval=(await client.listApprovals("pending")).find((x:any)=>x.ownerTaskId===t.id);
 assert.ok(approval && approval.ownerStepId==="mock" && approval.subject==="publish.mock_effect");
 assert.equal(approval.review?.fields.platform,"youtube");
 assert.equal(approval.review?.fields.visibility,"private");
 await assert.rejects(()=>client.approve(approval.id,true),/HUMAN_APPROVAL_PROOF_REQUIRED/);
 const confirmed=await client.approve(approval.id,true,await signedApproval(approval.id));
 assert.equal(confirmed.approval.humanVerified,true);
 assert.equal(confirmed.resume.resumed,true);
 assert.equal(confirmed.resume.taskId,t.id);
 assert.equal(confirmed.resume.result.status,"completed");
 const receipt=await inspectMockPublish(args.effectKey);
 assert.equal(receipt.found,true);
 assert.equal(receipt.receipt?.kind,"MOCK_ONLY");
 assert.equal(receipt.receipt?.attempts,1);
 assert.equal((await client.getTask(t.id)).status,"completed");
 const disposable=path.join(root,"test-scoped-delete.txt");
 await fs.writeFile(disposable,"test only");
 process.env.ALLOW_DELETE="false";
 assert.throws(()=>requireCapability("ALLOW_DELETE",false),/ALLOW_DELETE is disabled/);
 const delTask=await client.createTask({label:"M6 sandbox-only delete permission",
   steps:[{id:"delete",action:"fs.delete",args:{path:disposable}}]});
 const delRun=await client.runTask({taskId:delTask.id,expectedRevisionDigest:delTask.executionRevision.digest});
 assert.equal(delRun.status,"waiting_approval");
 const delApproval=(await client.listApprovals("pending")).find(x=>x.ownerTaskId===delTask.id);
 assert.ok(delApproval);
 assert.equal(delApproval.review?.fields.path,disposable);
 await assert.rejects(()=>client.approve(delApproval.id,true,"bad"),/HUMAN_APPROVAL_PROOF_REQUIRED/);
 await client.approve(delApproval.id,true,await signedApproval(delApproval.id));
 await assert.rejects(()=>fs.access(disposable));
 assert.throws(()=>requireCapability("ALLOW_DELETE",false),/ALLOW_DELETE is disabled/);
 const replay=await Promise.all(Array.from({length:12},()=>mockPublishEffect(args)));
 assert.equal(replay.filter(x=>x.replayed).length,12);
 await assert.rejects(()=>mockPublishEffect({...args,accountId:"another"}),/REPLAY_CONFLICT/);
 const deniedArgs={...args,effectKey:"e".repeat(64),targetId:"explicit-denial"};
 const deniedTask=await client.createTask({label:"Publish M5 denied mock effect",
   steps:[{id:"mock-denied",action:"publish.mock_effect",args:deniedArgs}]});
 const deniedRun=await client.runTask({
   taskId:deniedTask.id,expectedRevisionDigest:deniedTask.executionRevision.digest});
 assert.equal(deniedRun.status,"waiting_approval");
 const pending=(await client.listApprovals("pending")).find((x:any)=>x.ownerTaskId===deniedTask.id);
 assert.ok(pending);
 const denied=await client.deny(pending.id,true);
 assert.equal(denied.task.status,"failed");
 assert.equal((await inspectMockPublish(deniedArgs.effectKey)).found,false);
 process.env.OWL_APPROVAL_MODE="compat";
 await assert.rejects(()=>mockPublishEffect({...args,effectKey:"e".repeat(64)}),/PUBLISH_MOCK_DISABLED/);
 process.env.OWL_APPROVAL_MODE="enforce";process.env.OWL_RUNTIME_MODE="production";
 await assert.rejects(()=>mockPublishEffect({...args,effectKey:"f".repeat(64)}),/PUBLISH_MOCK_DISABLED/);
 console.log(JSON.stringify({ok:true,firstStatus:first.status,afterApproval:"completed",sameTaskId:t.id,
    receiptKind:"MOCK_ONLY",duplicateEffects:0,replayRequests:12,denialPreventsEffect:true,humanSignatureVerified:true,scopeWasTemporary:true,productionPublishingEnabled:false},null,2));
}finally{await fs.rm(root,{recursive:true,force:true});}
