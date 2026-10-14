import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {inspectPilotMedia,prepareInstagramPilotCopy} from "../src/providers/publishMediaPrep.js";
const run=promisify(execFile);
const root=await fs.mkdtemp(path.join(os.tmpdir(),"owl-publish-media-"));
process.env.ALLOWED_DIRECTORIES=root;
process.env.TASK_STAGING_DIR=path.join(root,"staging");
const mov=path.join(root,"Bloomroom_MantaAI_fixture.mov");
const mp4=path.join(root,"bloomroom-instagram-fixture.mp4");
try{
 await run("ffmpeg",["-nostdin","-loglevel","error","-f","lavfi",
   "-i","testsrc2=size=320x240:rate=15","-f","lavfi","-i","sine=frequency=440",
   "-t","1","-c:v","mpeg4","-c:a","pcm_s16le","-y",mov],{timeout:15000});
 const original=await inspectPilotMedia(mov);
 assert.equal(original.youtubeSourceAccepted,true);
 assert.equal(original.instagramMp4Ready,false);
 assert.equal(original.videoCodec,"mpeg4");
 const converted=await prepareInstagramPilotCopy(mov,mp4);
 assert.equal(converted.mode,"transcode");
 assert.equal(converted.prepared.instagramMp4Ready,true);
 assert.equal(converted.prepared.videoCodec,"h264");
 assert.equal(converted.prepared.audioCodec,"aac");
 assert.equal(converted.original.sha256,(await inspectPilotMedia(mov)).sha256);
 await assert.rejects(()=>prepareInstagramPilotCopy(mov,mp4),/EEXIST/);
 await assert.rejects(()=>inspectPilotMedia("/Users/wahaha/Movies/10月12日/Bloomroom_MantaAI.mov"),/Access denied/);
 console.log(JSON.stringify({ok:true,movPreserved:true,youtubeDirectMov:true,
  instagramCompatibleMp4:true,restrictedDirectoryDenied:true,
  mp4SizeBytes:converted.prepared.sizeBytes},null,2));
}finally{await fs.rm(root,{recursive:true,force:true});}
