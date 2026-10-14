/** M8 media prep is local-only and honors OWL filesystem grants. */
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import fs from "node:fs/promises";
import {constants,createReadStream} from "node:fs";
import path from "node:path";
import {createHash,randomUUID} from "node:crypto";
import {assertAllowedExistingPath,assertAllowedTargetPath} from "../security/pathGuard.js";
const run=promisify(execFile);
export type PilotMediaProfile={source:string;name:string;sizeBytes:number;sha256:string;
 durationSeconds:number;width:number;height:number;videoCodec:string;audioCodec:string|null;
 youtubeSourceAccepted:boolean;instagramMp4Ready:boolean};
async function digest(file:string){
 const sum=createHash("sha256");
 for await(const piece of createReadStream(file))sum.update(piece as Buffer);
 return sum.digest("hex");
}
export async function inspectPilotMedia(input:string):Promise<PilotMediaProfile>{
 const file=await assertAllowedExistingPath(input);
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>20*1024*1024*1024||
    !/\.(mov|mp4)$/i.test(file))throw Error("PUBLISH_PILOT_SOURCE_INVALID");
 const {stdout}=await run("ffprobe",["-v","error","-show_entries",
   "format=duration:stream=codec_type,codec_name,width,height","-of","json",file],
   {timeout:20_000,maxBuffer:1024*1024});
 const parsed=JSON.parse(stdout) as {format?:{duration?:string};streams?:Array<{
  codec_type:string;codec_name:string;width?:number;height?:number}>};
 const video=parsed.streams?.find(s=>s.codec_type==="video");
 const audio=parsed.streams?.find(s=>s.codec_type==="audio");
 const duration=Number(parsed.format?.duration);
 if(!video?.width||!video.height||!video.codec_name||!Number.isFinite(duration)||
   duration<=0||duration>4*3600)throw Error("PUBLISH_PILOT_NO_VALID_VIDEO");
 return {source:file,name:path.basename(file),sizeBytes:stat.size,sha256:await digest(file),
  durationSeconds:duration,width:video.width,height:video.height,
  videoCodec:video.codec_name,audioCodec:audio?.codec_name??null,
  youtubeSourceAccepted:true,
  instagramMp4Ready:path.extname(file).toLowerCase()===".mp4"&&video.codec_name==="h264"&&
   (!audio||audio.codec_name==="aac")};
}
/** Converts into a *new* authorized target. Original never overwritten. */
export async function prepareInstagramPilotCopy(source:string,target:string){
 const original=await inspectPilotMedia(source);
 const out=await assertAllowedTargetPath(target);
 if(!out.toLowerCase().endsWith(".mp4")||out===original.source)
  throw Error("PUBLISH_IG_OUTPUT_MUST_BE_DISTINCT_MP4");
 const temp=path.join(path.dirname(out),".owl-publish-"+randomUUID()+".mp4");
 const mode=original.instagramMp4Ready?"copy":
  original.videoCodec==="h264"&&(!original.audioCodec||original.audioCodec==="aac")?"remux":"transcode";
 try{
  if(mode==="copy")await fs.copyFile(original.source,temp,constants.COPYFILE_EXCL);
  else{
   const args=["-nostdin","-loglevel","error","-i",original.source,"-map","0:v:0",
    "-map","0:a:0?","-movflags","+faststart"];
   if(mode==="remux")args.push("-c","copy");
   else args.push("-vf","scale=1080:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,format=yuv420p",
     "-c:v","libx264","-crf","20","-c:a","aac","-b:a","160k");
   args.push("-y",temp);
   await run("ffmpeg",args,{timeout:Math.min(3_600_000,Math.max(60_000,original.durationSeconds*20_000)),maxBuffer:1024*1024});
  }
  const converted=await inspectPilotMedia(temp);
  if(!converted.instagramMp4Ready||converted.sizeBytes>1024*1024*1024)
   throw Error("PUBLISH_IG_OUTPUT_MEDIA_INVALID");
  await fs.link(temp,out); // O_EXCL equivalent: never clobber a prior output
  return {original,prepared:{...converted,source:out,name:path.basename(out)},mode};
 }finally{await fs.rm(temp,{force:true});}
}
