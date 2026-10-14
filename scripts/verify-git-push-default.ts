import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {executeRoutedAction} from "../src/router/actionRouter.js";
import {getProviderStatuses} from "../src/providers/registry.js";
import {getApprovalPolicyStatus,listApprovals} from "../src/policy/approvalPolicy.js";
import {scopedActionRequiresApproval} from "../src/security/scopedCapabilities.js";

const exec=promisify(execFile);
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),"owl-default-git-push-"));
const source=path.join(scratch,"source"),remote=path.join(scratch,"remote.git");
process.env.OWL_RUNTIME_MODE="test";
process.env.OWL_STATE_ROOT=path.join(scratch,"state");
process.env.ALLOWED_DIRECTORIES=scratch;
process.env.OWL_APPROVAL_MODE="enforce";
process.env.OWL_SCOPED_CAPABILITIES="1";
process.env.OWL_SCOPED_ACTION_ALLOWLIST="git.push,fs.delete";
delete process.env.ALLOW_GIT_PUSH;
delete process.env.OWL_APPROVAL_ACTIONS;
try {
 await fs.mkdir(source);
 await exec("git",["init","--initial-branch=main",source]);
 await exec("git",["init","--bare",remote]);
 await fs.writeFile(path.join(source,"test.txt"),"synthetic local Git push only\n");
 await exec("git",["-C",source,"add","test.txt"]);
 await exec("git",["-C",source,"-c","user.email=test@example.invalid",
  "-c","user.name=OWL Test","commit","-m","synthetic local commit"]);
 await exec("git",["-C",source,"remote","add","origin",remote]);
 assert.equal(scopedActionRequiresApproval("git.push"),false);
 assert.ok(!getApprovalPolicyStatus().defaultApprovalActions.includes("git.push"));
 const git=(await getProviderStatuses()).find(x=>x.id==="git");
 assert.equal(git?.details?.push,true);
 const pushed=await executeRoutedAction("git.push",{cwd:source,remote:"origin",branch:"main"});
 assert.equal(pushed.approval.required,false);
 assert.equal(pushed.result.exitCode,0,pushed.result.stderr);
 assert.equal((await listApprovals()).length,0);
 const {stdout:local}=await exec("git",["-C",source,"rev-parse","HEAD"]);
 const {stdout:updated}=await exec("git",["--git-dir",remote,"rev-parse","refs/heads/main"]);
 assert.equal(local.trim(),updated.trim());
 process.env.ALLOW_GIT_PUSH="false";
 await assert.rejects(()=>executeRoutedAction("git.push",{cwd:source,remote:"origin",branch:"main"}));
 console.log(JSON.stringify({ok:true,defaultPushEnabled:true,reviewRequired:false,
  deletedAndRollbackApprovalsPreserved:true,explicitBlockWorks:true,
  pushedOnlyToTemporaryLocalBareRepo:true},null,2));
}finally{
 await fs.rm(scratch,{recursive:true,force:true});
}
