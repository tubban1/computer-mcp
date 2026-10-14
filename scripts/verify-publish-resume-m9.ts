import assert from "node:assert/strict";
import {interpretYoutubeUploadStatus,probeYoutubeUploadStatus} from "../src/providers/publishYoutubeResume.js";
const total=13_149_040;
assert.deepEqual(interpretYoutubeUploadStatus({status:308},total),{state:"RESUME_REQUIRED",nextByte:0});
assert.deepEqual(interpretYoutubeUploadStatus({status:308,headers:{Range:"bytes=0-999"}},total),
 {state:"RESUME_REQUIRED",nextByte:1000});
assert.deepEqual(interpretYoutubeUploadStatus({status:201,json:{id:"private_video_1"}},total),
 {state:"COMPLETED_UNVERIFIED",videoId:"private_video_1"});
assert.deepEqual(interpretYoutubeUploadStatus({status:503},total),
 {state:"UNKNOWN",reason:"HTTP_503"});
for(const h of ["bytes=1-100","bytes=0-13149040","bytes=0-NaN","bytes=0-999,1000-2000"])
 assert.throws(()=>interpretYoutubeUploadStatus({status:308,headers:{range:h}},total),/YT_RANGE/);
const session="https://www.googleapis.com/upload/youtube/v3/videos?upload_id=synthetic";
let requested=0;
const probe=await probeYoutubeUploadStatus({
 sessionUrl:session,mediaSize:total,accessToken:"TEST_ONLY_NOT_REAL",
 request:async r=>{
  requested++;
  assert.equal(r.url,session);
  assert.equal(r.method,"PUT");
  assert.equal(r.headers["Content-Range"],"bytes */"+total);
  assert.equal(r.headers["Content-Length"],"0");
  assert.equal(r.body,undefined);
  return {status:308,headers:{range:"bytes=0-999"}};
 },
});
assert.deepEqual(probe,{state:"RESUME_REQUIRED",nextByte:1000});
assert.equal(requested,1);
for(const url of ["https://attacker.example/upload/youtube/v3/videos",
 "https://www.googleapis.com/youtube/v3/videos?upload_id=x"])
 await assert.rejects(()=>probeYoutubeUploadStatus({
  sessionUrl:url,mediaSize:total,accessToken:"NOT_REAL",
  request:async()=>{throw Error("DANGEROUS_NETWORK_CALL");},
 }),/DENIED/);
console.log(JSON.stringify({ok:true,safeOffset:true,probeHasNoFileBody:true,
 unexpectedRangeBlocked:true,completionRequiresFurtherPrivacyCheck:true}));
