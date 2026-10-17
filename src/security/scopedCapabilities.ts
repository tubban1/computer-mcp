import {AsyncLocalStorage} from "node:async_hooks";
import type {ApprovalRecord} from "../policy/approvalPolicy.js";
import {approvalFingerprint} from "../policy/approvalPolicy.js";
import {currentExecutionContext} from "../runtime/executionContext.js";

// One-use, task/step/exact-action and short-lived. Never changes process.env.
const flags:Record<string,string>={
 "fs.delete":"ALLOW_DELETE","tx.rollback":"ALLOW_ROLLBACK",
 "shell.exec":"ALLOW_SHELL","shell.start":"ALLOW_SHELL",
 "shell.input":"ALLOW_SHELL","shell.kill":"ALLOW_SHELL",
};
const storage=new AsyncLocalStorage<{
 flag:string;session:string;task?:string;step?:string;expires:number;
}>();
export const scopedActionRequiresApproval=(action:string)=>
 process.env.OWL_SCOPED_CAPABILITIES==="1" && action in flags &&
 (process.env.OWL_SCOPED_ACTION_ALLOWLIST??"").split(",").map(x=>x.trim()).includes(action);
export function scopedCapabilityAllows(flag:string){
 const grant=storage.getStore(),ctx=currentExecutionContext();
 return Boolean(grant && process.env.OWL_SCOPED_CAPABILITIES==="1" &&
  grant.flag===flag && grant.expires>Date.now() && grant.session===ctx.sessionId &&
  grant.task===ctx.taskId && grant.step===ctx.stepId);
}
export async function withApprovedScopedCapability<T>(
 action:string,args:unknown,receipt:ApprovalRecord|null,operation:()=>Promise<T>,
):Promise<T>{
 if(!scopedActionRequiresApproval(action))return operation();
 const allowedActions=(process.env.OWL_SCOPED_ACTION_ALLOWLIST??"").split(",").map(x=>x.trim());
 if(!allowedActions.includes(action))return operation();
 const context=currentExecutionContext();
 if(!receipt || receipt.state!=="consumed" || receipt.humanVerified!==true ||
   receipt.subjectType!=="action" || receipt.subject!==action ||
   receipt.fingerprint!==approvalFingerprint("action",action,args) ||
   receipt.ownerSessionId!==context.sessionId || receipt.ownerTaskId!==context.taskId ||
   receipt.ownerStepId!==context.stepId || Date.parse(receipt.expiresAt)<=Date.now())
  return operation();
 return storage.run({flag:flags[action],session:context.sessionId,task:context.taskId,
   step:context.stepId,expires:Math.min(Date.parse(receipt.expiresAt),Date.now()+60000)},
   operation);
}
