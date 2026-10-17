import assert from "node:assert/strict";
import {requireCapability} from "../src/security/capabilities.js";

const keys=["ALLOW_SHELL","OWL_APPROVAL_MODE","OWL_APPROVAL_ACTIONS",
 "OWL_SCOPED_CAPABILITIES","OWL_SCOPED_ACTION_ALLOWLIST"];
const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
try{
 process.env.ALLOW_SHELL="true";
 process.env.OWL_APPROVAL_MODE="enforce";
 process.env.OWL_SCOPED_CAPABILITIES="0";
 process.env.OWL_APPROVAL_ACTIONS="fs.delete";
 assert.throws(()=>requireCapability("ALLOW_SHELL"),
  /OWL_SHELL_DELETE_REVIEW_CONFLICT/);
 delete process.env.OWL_APPROVAL_ACTIONS;
 assert.throws(()=>requireCapability("ALLOW_SHELL"),
  /OWL_SHELL_DELETE_REVIEW_CONFLICT/,
  "legacy default fs.delete approval must not leave a shell bypass");
 process.env.OWL_APPROVAL_ACTIONS=
  "fs.delete,shell.exec,shell.start,shell.input,shell.kill";
 assert.doesNotThrow(()=>requireCapability("ALLOW_SHELL"),
  "paired review policy must not reject reviewed Shell at capability check");
 process.env.ALLOW_SHELL="false";
 assert.throws(()=>requireCapability("ALLOW_SHELL"),/ALLOW_SHELL is disabled/);
 process.env.ALLOW_SHELL="true";
 process.env.OWL_APPROVAL_ACTIONS="__none__";
 assert.doesNotThrow(()=>requireCapability("ALLOW_SHELL"));
 process.env.OWL_APPROVAL_MODE="compat";
 process.env.OWL_APPROVAL_ACTIONS="fs.delete";
 assert.doesNotThrow(()=>requireCapability("ALLOW_SHELL"));
 console.log(JSON.stringify({ok:true,deleteAskShellOnBlocked:true,
  defaultDeletePolicyBlocked:true,pairedReviewSupported:true,
  explicitShellOffStillDenied:true,deleteOnShellOnPreserved:true}));
}finally{
 for(const k of keys){if(prior[k]===undefined)delete process.env[k];
  else process.env[k]=prior[k];}
}
