import assert from "node:assert/strict";
import {approvalSafeReview} from "../src/policy/humanApprovalProof.js";
import {createOfficialHttpsPort,publicOfficialIpv4,officialUrl} from "../src/providers/publishHttpsTransport.js";
const url="https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";
let calls=0;
const port=createOfficialHttpsPort({
 resolve:async h=>{assert.equal(h,"www.googleapis.com");return ["127.0.0.1","8.8.8.8"];},
 dial:async (r,ip)=>{calls++;assert.equal(ip,"8.8.8.8");assert.equal(r.method,"POST");return {status:200,headers:{location:url},json:{id:"yt_test"}};},
});
assert.equal((await port({method:"POST",url,headers:{Authorization:"Bearer FAKE"},body:"{}"})).status,200);
for(const bad of ["http://www.googleapis.com/youtube/v3/videos",
 "https://www.googleapis.com.evil.example/youtube/v3/videos",
 "https://www.googleapis.com:444/youtube/v3/videos",
 "https://graph.facebook.com/v24.0/me/debug_token",
 "https://rupload.facebook.com/steal",
 "https://me@www.googleapis.com/youtube/v3/videos"])
 await assert.rejects(()=>port({method:"GET",url:bad,headers:{}}),/DENIED/);
assert.equal(calls,1);
officialUrl("https://graph.facebook.com/v24.0/ig123/media");
officialUrl("https://rupload.facebook.com/ig-api-upload/v24.0/ig123");
for(const ip of ["127.0.0.1","10.1.1.1","169.254.169.254","172.18.1.1",
 "192.168.1.1","198.19.0.1","203.0.113.1","224.0.0.1"])assert.equal(publicOfficialIpv4(ip),false);
assert.equal(publicOfficialIpv4("8.8.8.8"),true);
await assert.rejects(()=>createOfficialHttpsPort({resolve:async()=>["10.0.0.5"],
 dial:async()=>{throw Error("DIAL_MUST_NOT_RUN");}})({method:"GET",url,headers:{}}),/DNS_NOT_PUBLIC/);
for(const headers of [{Host:"evil"},{Cookie:"x=y"},{Authorization:"a\r\nHost:evil"},{"Content-Length":"44"}])
 await assert.rejects(()=>port({method:"POST",url,headers,body:"{}"}),/HEADER_DENIED|LENGTH_MISMATCH/);
assert.equal(calls,1);
await assert.rejects(()=>createOfficialHttpsPort({resolve:async()=>["8.8.8.8"],
 dial:async()=>({status:302,headers:{location:"https://evil.example"}})})({method:"GET",url,headers:{}}),/REDIRECT_DENIED/);
const preview=approvalSafeReview("publish.official_upload_test",{caption:"safe",title:"Pilot"});
assert.equal(preview.complete,true);
assert.equal(approvalSafeReview("publish.official_upload_test",{caption:"X".repeat(250)}).complete,false);
assert.equal(approvalSafeReview("publish.official_upload_test",{caption:"hi\u0000hijack"}).complete,false);
assert.equal(approvalSafeReview("shell.exec",{cwd:"/tmp",command:"git push"}).complete,false);
console.log(JSON.stringify({ok:true,network:false,privateDnsBlocked:true,redirectBlocked:true,
 approvalTruncationBlocked:true,requestCount:calls}));
